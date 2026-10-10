import { PaymentMethod, Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { generateInvoiceNumber } from "@common/utils/sequenceGenerators";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { assertPatientAccess } from "@common/utils/recordAuthorization";
import { appendLabLedgerEntry, postLabInvoicePayment } from "@modules/lab/labLedger.service";

interface InvoiceItemInput {
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  discountType?: "FLAT" | "PERCENTAGE";
}

function roundPkr(amount: number): number {
  return Math.round(amount);
}

export function calculateInvoiceItems(items: InvoiceItemInput[]) {
  return items.map((item) => {
    const unitPrice = roundPkr(item.unitPrice);
    const lineAmount = roundPkr(item.quantity * unitPrice);
    const discountValue = item.discountType === "PERCENTAGE" ? item.discount : roundPkr(item.discount);
    const discount = item.discountType === "PERCENTAGE"
      ? roundPkr(lineAmount * discountValue / 100)
      : discountValue;
    if (unitPrice <= 0) throw new BadRequestError("Unit price must be greater than zero");
    if (item.discountType === "PERCENTAGE" && discountValue > 100) throw new BadRequestError("Percentage discount cannot exceed 100%");
    if (discount > lineAmount) throw new BadRequestError("Discount cannot exceed the line amount");

    return {
      ...item,
      unitPrice,
      discount,
      subtotal: roundPkr(lineAmount - discount),
    };
  });
}

export async function createLabInvoiceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    patientId: string;
    description: string;
    unitPrice: number;
    discountPercent: number;
    discountReason?: string;
    discountAppliedBy?: string;
    discountApprovedBy?: string;
    labPackageId?: string;
    createdBy: string;
  },
) {
  const [item] = calculateInvoiceItems([{
    itemType: "LAB",
    description: input.description,
    quantity: 1,
    unitPrice: input.unitPrice,
    discount: input.discountPercent,
    discountType: "PERCENTAGE",
  }]);
  const subtotal = roundPkr(item.unitPrice);
  const grandTotal = item.subtotal;
  const invoiceNumber = await generateInvoiceNumber(tx);
  return tx.invoice.create({
    data: {
      invoiceNumber,
      patientId: input.patientId,
      createdBy: input.createdBy,
      status: grandTotal === 0 ? "PAID" : "UNPAID",
      subtotal,
      discountAmount: item.discount,
      discountType: input.discountPercent > 0 ? "PERCENTAGE" : undefined,
      discountReason: input.discountReason,
      discountAppliedBy: input.discountPercent > 0 ? input.discountAppliedBy : undefined,
      discountApprovedBy: input.discountApprovedBy,
      grandTotal,
      paidAmount: 0,
      balanceAmount: grandTotal,
      labPackageId: input.labPackageId,
      items: {
        create: {
          itemType: "LAB",
          description: input.description,
          quantity: 1,
          unitPrice: item.unitPrice,
          discount: item.discount,
          subtotal: item.subtotal,
        },
      },
    },
  });
}

export function canVoidLabInvoice(role: string, isLabInvoice: boolean): boolean {
  return !isLabInvoice || role === "ADMIN";
}

export const billingService = {
  async list(actor: AccessTokenPayload, params: PageParams & { patientId?: string; status?: string; search?: string; itemType?: string }) {
    if (params.patientId) await assertPatientAccess(actor, params.patientId);
    const where: Prisma.InvoiceWhereInput = {
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.itemType ? { items: { some: { itemType: params.itemType as never } } } : {}),
      ...(params.search ? {
        OR: [
          { invoiceNumber: { contains: params.search, mode: "insensitive" } },
          { patient: { is: { mrNumber: { contains: params.search, mode: "insensitive" } } } },
          { patient: { is: { firstName: { contains: params.search, mode: "insensitive" } } } },
          { patient: { is: { lastName: { contains: params.search, mode: "insensitive" } } } },
        ],
      } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({ where, skip: params.skip, take: params.limit, include: { patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } }, items: true, payments: true }, orderBy: { createdAt: "desc" } }),
      prisma.invoice.count({ where }),
    ]);
    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } }, items: true, payments: { where: { deletedAt: null } } } });
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.patientId) await assertPatientAccess(actor, invoice.patientId);
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set([...invoice.payments.map((payment) => payment.createdBy), ...(invoice.voidedBy ? [invoice.voidedBy] : [])])] } },
      select: { id: true, name: true },
    });
    const namesById = new Map(users.map((user) => [user.id, user.name]));
    return {
      ...invoice,
      voidedByName: invoice.voidedBy ? namesById.get(invoice.voidedBy) ?? "Unknown" : null,
      payments: invoice.payments.map((payment) => ({
        ...payment,
        receivedBy: namesById.get(payment.createdBy) ?? "Unknown",
      })),
    };
  },

  async create(
    actor: AccessTokenPayload,
    input: { patientId: string; items: InvoiceItemInput[]; discountAmount?: number; discountType?: string; discountReason?: string; taxAmount?: number },
    req?: Request
  ) {
    const patient = await prisma.patient.findFirst({ where: { id: input.patientId, deletedAt: null } });
    if (!patient) throw new NotFoundError("Patient not found");

    const itemsWithSubtotal = calculateInvoiceItems(input.items);
    const subtotal = roundPkr(itemsWithSubtotal.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
    const lineDiscountAmount = roundPkr(itemsWithSubtotal.reduce((sum, item) => sum + item.discount, 0));
    const discountAmount = roundPkr(lineDiscountAmount + (input.discountAmount ?? 0));
    const taxAmount = roundPkr(input.taxAmount ?? 0);
    const grandTotal = roundPkr(subtotal - discountAmount + taxAmount);

    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await generateInvoiceNumber(tx);
      return tx.invoice.create({
        data: {
          invoiceNumber,
          patientId: input.patientId,
          createdBy: actor.sub,
          status: "FINALIZED",
          subtotal,
          discountAmount,
          discountType: input.discountType,
          discountReason: input.discountReason,
          taxAmount,
          grandTotal,
          paidAmount: 0,
          balanceAmount: grandTotal,
          items: { create: itemsWithSubtotal.map((i) => ({ itemType: i.itemType as never, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount, subtotal: i.subtotal })) },
        },
        include: { items: true },
      });
    });

    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "billing", entityType: "Invoice", entityId: invoice.id, newValues: invoice, req });
    return invoice;
  },

  /** Records a payment; recalculates paidAmount/balanceAmount/status atomically. Overpayment is rejected. */
  async recordPayment(actor: AccessTokenPayload, invoiceId: string, input: { paymentMethod: string; amount: number; referenceNumber?: string; notes?: string }, req?: Request) {
    const idempotencyKey = req?.get("Idempotency-Key");
    if (idempotencyKey) {
      const previous = await prisma.payment.findUnique({ where: { idempotencyKey }, include: { invoice: true } });
      if (previous) {
        if (previous.invoice.patientId) await assertPatientAccess(actor, previous.invoice.patientId);
        return previous.invoice;
      }
    }
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.patientId) await assertPatientAccess(actor, invoice.patientId);
    if (invoice.status === "VOID") throw new ConflictError("Cannot record payment on a voided invoice");
    if (invoice.status === "PAID") throw new ConflictError("Invoice is already fully paid");

    const balance = Number(invoice.balanceAmount);
    if (input.amount > balance) {
      throw new BadRequestError(`Payment of ${input.amount} exceeds remaining balance of ${balance}`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId,
          paymentMethod: input.paymentMethod as never,
          amount: input.amount,
          referenceNumber: input.referenceNumber,
          notes: input.notes,
          createdBy: actor.sub,
          idempotencyKey,
        },
      });

      const newPaidAmount = roundPkr(Number(invoice.paidAmount) + input.amount);
      const newBalance = roundPkr(Number(invoice.grandTotal) - newPaidAmount);
      const newStatus = newBalance <= 0 ? "PAID" : "PARTIAL";

      const inv = await tx.invoice.update({
        where: { id: invoiceId },
        data: { paidAmount: newPaidAmount, balanceAmount: Math.max(newBalance, 0), status: newStatus },
      });

      await postLabInvoicePayment(tx, invoiceId, input.amount, input.paymentMethod as PaymentMethod, actor.sub);
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "billing", entityType: "Payment", entityId: payment.id, newValues: payment, req }, tx);
      return inv;
    });

    return updated;
  },

  /** Void reverses all payments logically (invoice + payments marked, balance not owed). No hard delete. */
  async voidInvoice(actor: AccessTokenPayload, id: string, reason: string, req?: Request) {
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { payments: true, items: true, labOrders: { select: { id: true } } } });
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.patientId) await assertPatientAccess(actor, invoice.patientId);
    if (invoice.status === "VOID") throw new ConflictError("Invoice already void");
    const isLabInvoice = Boolean(invoice.labPackageId || invoice.labOrders.length || invoice.items.some((item) => item.itemType === "LAB"));
    if (!canVoidLabInvoice(actor.role, isLabInvoice)) {
      throw new ForbiddenError("Only an Admin may approve cancellation of a Lab invoice.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { invoiceId: id, deletedAt: null }, data: { deletedAt: new Date() } });
      const inv = await tx.invoice.update({
        where: { id },
        data: { status: "VOID", voidedAt: new Date(), voidReason: reason, voidedBy: actor.sub },
      });
      const labLedgerCharge = await tx.labLedgerEntry.findFirst({ where: { invoiceId: id, type: "INVOICE_CHARGE" } });
      if (labLedgerCharge && Number(invoice.balanceAmount) > 0) {
        await appendLabLedgerEntry(tx, {
          accountId: labLedgerCharge.accountId,
          type: "ADJUSTMENT",
          amount: -Number(invoice.balanceAmount),
          notes: `Outstanding balance reversed for voided invoice ${invoice.invoiceNumber}: ${reason}`,
          createdBy: actor.sub,
        });
      }
      await writeAuditLog({ userId: actor.sub, action: "VOID", module: "billing", entityType: "Invoice", entityId: id, oldValues: { status: invoice.status }, newValues: { status: "VOID", reason }, req }, tx);
      return inv;
    });

    return updated;
  },

  async listPatientInvoices(patientId: string) {
    return prisma.invoice.findMany({ where: { patientId }, include: { items: true, payments: { where: { deletedAt: null } } }, orderBy: { createdAt: "desc" } });
  },
};
