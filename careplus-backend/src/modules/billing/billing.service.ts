import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { generateInvoiceNumber } from "@common/utils/sequenceGenerators";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { assertPatientAccess } from "@common/utils/recordAuthorization";

interface InvoiceItemInput {
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const billingService = {
  async list(actor: AccessTokenPayload, params: PageParams & { patientId?: string; status?: string }) {
    if (params.patientId) await assertPatientAccess(actor, params.patientId);
    const where: Prisma.InvoiceWhereInput = {
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({ where, skip: params.skip, take: params.limit, include: { items: true, payments: true }, orderBy: { createdAt: "desc" } }),
      prisma.invoice.count({ where }),
    ]);
    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true, payments: { where: { deletedAt: null } } } });
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.patientId) await assertPatientAccess(actor, invoice.patientId);
    return invoice;
  },

  async create(
    actor: AccessTokenPayload,
    input: { patientId: string; items: InvoiceItemInput[]; discountAmount?: number; discountType?: string; discountReason?: string; taxAmount?: number },
    req?: Request
  ) {
    const patient = await prisma.patient.findFirst({ where: { id: input.patientId, deletedAt: null } });
    if (!patient) throw new NotFoundError("Patient not found");

    const itemsWithSubtotal = input.items.map((i) => ({
      ...i,
      subtotal: round2(i.quantity * i.unitPrice - i.discount),
    }));
    const subtotal = round2(itemsWithSubtotal.reduce((sum, i) => sum + i.subtotal, 0));
    const discountAmount = input.discountAmount ?? 0;
    const taxAmount = input.taxAmount ?? 0;
    const grandTotal = round2(subtotal - discountAmount + taxAmount);

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

      const newPaidAmount = round2(Number(invoice.paidAmount) + input.amount);
      const newBalance = round2(Number(invoice.grandTotal) - newPaidAmount);
      const newStatus = newBalance <= 0 ? "PAID" : "PARTIAL";

      const inv = await tx.invoice.update({
        where: { id: invoiceId },
        data: { paidAmount: newPaidAmount, balanceAmount: Math.max(newBalance, 0), status: newStatus },
      });

      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "billing", entityType: "Payment", entityId: payment.id, newValues: payment, req }, tx);
      return inv;
    });

    return updated;
  },

  /** Void reverses all payments logically (invoice + payments marked, balance not owed). No hard delete. */
  async voidInvoice(actor: AccessTokenPayload, id: string, reason: string, req?: Request) {
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.patientId) await assertPatientAccess(actor, invoice.patientId);
    if (invoice.status === "VOID") throw new ConflictError("Invoice already void");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { invoiceId: id, deletedAt: null }, data: { deletedAt: new Date() } });
      const inv = await tx.invoice.update({
        where: { id },
        data: { status: "VOID", voidedAt: new Date(), voidReason: reason },
      });
      await writeAuditLog({ userId: actor.sub, action: "VOID", module: "billing", entityType: "Invoice", entityId: id, oldValues: { status: invoice.status }, newValues: { status: "VOID", reason }, req }, tx);
      return inv;
    });

    return updated;
  },

  async listPatientInvoices(patientId: string) {
    return prisma.invoice.findMany({ where: { patientId }, include: { items: true, payments: { where: { deletedAt: null } } }, orderBy: { createdAt: "desc" } });
  },
};
