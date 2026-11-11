import { InvoiceDepartment, InvoiceStatus, PaymentMethod, Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { generateDepartmentInvoiceNumber } from "@common/utils/sequenceGenerators";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { assertPatientAccess } from "@common/utils/recordAuthorization";
import { roundMoney, aggregatePaymentTotals } from "@common/utils/money";
import { appendLabLedgerEntry, postLabInvoicePayment } from "@modules/lab/labLedger.service";

export { aggregatePaymentTotals, type PaymentAggregationItem } from "@common/utils/money";

interface InvoiceItemInput {
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  discountType?: "FLAT" | "PERCENTAGE";
  sourceType?: string;
  sourceId?: string;
  sourceDepartment?: InvoiceDepartment;
}

export function calculateInvoiceItems(items: InvoiceItemInput[]) {
  return items.map((item) => {
    const unitPrice = roundMoney(item.unitPrice);
    const lineAmount = roundMoney(new Prisma.Decimal(item.quantity).mul(unitPrice));
    const discountValue = item.discountType === "PERCENTAGE"
      ? new Prisma.Decimal(item.discount)
      : roundMoney(item.discount);
    const discount = item.discountType === "PERCENTAGE"
      ? roundMoney(lineAmount.mul(discountValue).div(100))
      : discountValue;
    if (unitPrice.lte(0)) throw new BadRequestError("Unit price must be greater than zero");
    if (item.discountType === "PERCENTAGE" && discountValue.gt(100)) throw new BadRequestError("Percentage discount cannot exceed 100%");
    if (discount.gt(lineAmount)) throw new BadRequestError("Discount cannot exceed the line amount");

    return {
      ...item,
      unitPrice,
      discount,
      subtotal: roundMoney(lineAmount.minus(discount)),
    };
  });
}

export function calculateInvoiceAmounts(
  items: ReturnType<typeof calculateInvoiceItems>,
  invoiceDiscountAmount: Prisma.Decimal.Value = 0,
  taxAmountInput: Prisma.Decimal.Value = 0,
) {
  const subtotal = roundMoney(items.reduce(
    (sum, item) => sum.plus(new Prisma.Decimal(item.quantity).mul(item.unitPrice)),
    new Prisma.Decimal(0),
  ));
  const lineDiscountAmount = roundMoney(items.reduce(
    (sum, item) => sum.plus(item.discount),
    new Prisma.Decimal(0),
  ));
  const discountAmount = roundMoney(lineDiscountAmount.plus(invoiceDiscountAmount));
  if (discountAmount.gt(subtotal)) {
    throw new BadRequestError("Total discounts cannot exceed invoice subtotal");
  }

  const taxAmount = roundMoney(taxAmountInput);
  const grandTotal = roundMoney(subtotal.minus(discountAmount).plus(taxAmount));
  return { subtotal, discountAmount, taxAmount, grandTotal };
}

export async function createLabInvoiceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    patientId: string;
    description?: string;
    unitPrice?: number;
    items?: Array<{ description: string; unitPrice: number; quantity?: number; sourceType?: string; sourceId?: string }>;
    discountPercent: number;
    discountReason?: string;
    discountAppliedBy?: string;
    discountApprovedBy?: string;
    labPackageId?: string;
    createdBy: string;
  },
) {
  const lineInputs: InvoiceItemInput[] = (input.items && input.items.length > 0)
    ? input.items.map((i) => ({
        itemType: "LAB",
        description: i.description,
        quantity: i.quantity ?? 1,
        unitPrice: i.unitPrice,
        discount: input.discountPercent,
        discountType: "PERCENTAGE",
        sourceType: i.sourceType,
        sourceId: i.sourceId,
      }))
    : [{
        itemType: "LAB",
        description: input.description ?? "Lab test",
        quantity: 1,
        unitPrice: input.unitPrice ?? 0,
        discount: input.discountPercent,
        discountType: "PERCENTAGE",
      }];

  const calculatedItems = calculateInvoiceItems(lineInputs);
  const { subtotal, discountAmount, grandTotal } = calculateInvoiceAmounts(calculatedItems);
  const invoiceNumber = await generateDepartmentInvoiceNumber(tx, "LAB");
  return tx.invoice.create({
    data: {
      invoiceNumber,
      patientId: input.patientId,
      createdBy: input.createdBy,
      department: "LAB",
      status: grandTotal.isZero() ? "PAID" : "UNPAID",
      subtotal,
      discountAmount,
      discountType: input.discountPercent > 0 ? "PERCENTAGE" : undefined,
      discountReason: input.discountReason,
      discountAppliedBy: input.discountPercent > 0 ? input.discountAppliedBy : undefined,
      discountApprovedBy: input.discountApprovedBy,
      grandTotal,
      paidAmount: 0,
      balanceAmount: grandTotal,
      labPackageId: input.labPackageId,
      items: {
        create: calculatedItems.map((item) => ({
          itemType: "LAB",
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          subtotal: item.subtotal,
          sourceType: item.sourceType ?? (input.labPackageId ? "LAB_PACKAGE" : "LAB_TEST"),
          sourceId: item.sourceId ?? input.labPackageId,
          sourceDepartment: "LAB",
        })),
      },
    },
    include: {
      items: true,
      payments: true,
    },
  });
}

export function canVoidLabInvoice(role: string, isLabInvoice: boolean): boolean {
  return !isLabInvoice || role === "ADMIN" || role === "BILLING_MANAGER";
}

function isLabInvoice(invoice: { labPackageId: string | null; labOrders: unknown[]; items: Array<{ itemType: string }> }) {
  return Boolean(invoice.labPackageId || invoice.labOrders.length || invoice.items.some((item) => item.itemType === "LAB"));
}

function isPharmacyInvoice(invoice: { pharmacySale: unknown; pharmacyLedgerEntries: unknown[]; items: Array<{ itemType: string }> }) {
  return Boolean(invoice.pharmacySale || invoice.pharmacyLedgerEntries.length || invoice.items.some((item) => item.itemType === "MEDICINE"));
}

function isUltrasoundInvoice(invoice: { ultrasoundOrder: unknown; items: Array<{ itemType: string }> }) {
  return Boolean(invoice.ultrasoundOrder || invoice.items.some((item) => item.itemType === "ULTRASOUND"));
}

export function canRecordInvoicePayment(
  role: string,
  invoice: {
    labPackageId: string | null;
    labOrders: unknown[];
    pharmacySale: unknown;
    pharmacyLedgerEntries: unknown[];
    ultrasoundOrder: unknown;
    items: Array<{ itemType: string }>;
  },
): boolean {
  if (role === "ADMIN" || role === "BILLING_MANAGER") return true;
  const labInvoice = isLabInvoice(invoice);
  const pharmacyInvoice = isPharmacyInvoice(invoice);
  const ultrasoundInvoice = isUltrasoundInvoice(invoice);
  if (role === "LAB_TECHNICIAN") return labInvoice && !pharmacyInvoice && !ultrasoundInvoice;
  if (role === "PHARMACIST") return pharmacyInvoice && !labInvoice && !ultrasoundInvoice;
  if (role === "ULTRASOUND_TECH" || role === "ULTRASOUND_TECHNICIAN") {
    return ultrasoundInvoice && !labInvoice && !pharmacyInvoice;
  }
  if (role === "RECEPTIONIST") return !invoice.items.some((item) => item.itemType === "WARD");
  return false;
}

const billingDepartmentsByRole: Partial<Record<string, InvoiceDepartment[]>> = {
  RECEPTIONIST: ["RECEPTION", "LAB", "PHARMACY", "ULTRASOUND"],
  LAB_TECHNICIAN: ["LAB"],
  PHARMACIST: ["PHARMACY"],
  ULTRASOUND_TECH: ["ULTRASOUND"],
  ULTRASOUND_TECHNICIAN: ["ULTRASOUND"],
};

const billingRoles = new Set([
  "ADMIN",
  "BILLING_MANAGER",
  "RECEPTIONIST",
  "LAB_TECHNICIAN",
  "PHARMACIST",
  "ULTRASOUND_TECH",
  "ULTRASOUND_TECHNICIAN",
]);

function requireBillingAccess(role: string) {
  if (!billingRoles.has(role)) {
    throw new ForbiddenError("You are not authorized to access billing");
  }
}

function canAccessDepartment(role: string, department: InvoiceDepartment) {
  return role === "ADMIN" || role === "BILLING_MANAGER" || billingDepartmentsByRole[role]?.includes(department) === true;
}

function canCreateDepartmentInvoice(role: string, department: InvoiceDepartment) {
  if (role === "RECEPTIONIST") return department === "RECEPTION";
  return canAccessDepartment(role, department);
}

function requireDepartmentAccess(role: string, department: InvoiceDepartment) {
  if (!canAccessDepartment(role, department)) {
    throw new ForbiddenError("You are not authorized to access billing for this department");
  }
}

function invoiceDepartment(invoice: { department: InvoiceDepartment | null }) {
  return invoice.department ?? "RECEPTION";
}

function dateRange(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined {
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000+05:00`) } : {}),
    ...(dateTo ? { lt: new Date(new Date(`${dateTo}T00:00:00.000+05:00`).getTime() + 86400000) } : {}),
  };
}

export const billingService = {
  async list(actor: AccessTokenPayload, params: PageParams & {
    patientId?: string;
    status?: string;
    search?: string;
    itemType?: string;
    department?: InvoiceDepartment;
    departments?: InvoiceDepartment[];
    dateFrom?: string;
    dateTo?: string;
    createdBy?: string;
  }) {
    requireBillingAccess(actor.role);
    if (params.patientId) await assertPatientAccess(actor, params.patientId);
    if (params.department) requireDepartmentAccess(actor.role, params.department);
    params.departments?.forEach((department) => requireDepartmentAccess(actor.role, department));
    const allowedDepartments = billingDepartmentsByRole[actor.role];
    const createdAt = dateRange(params.dateFrom, params.dateTo);
    const where: Prisma.InvoiceWhereInput = {
      ...(allowedDepartments ? { department: { in: allowedDepartments } } : {}),
      ...(params.department ? { department: params.department } : {}),
      ...(!params.department && params.departments ? { department: { in: params.departments } } : {}),
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.createdBy ? { createdBy: params.createdBy } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(params.status ? {
        status: params.status === "OUTSTANDING"
          ? { in: ["UNPAID", "FINALIZED", "DRAFT", "PARTIAL"] }
          : params.status === "UNPAID"
            ? { in: ["UNPAID", "FINALIZED", "DRAFT"] }
            : params.status as never,
      } : {}),
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

  async listStaff(actor: AccessTokenPayload, department?: InvoiceDepartment) {
    requireBillingAccess(actor.role);
    if (department) requireDepartmentAccess(actor.role, department);
    const allowedDepartments = billingDepartmentsByRole[actor.role];
    const invoices = await prisma.invoice.findMany({
      where: {
        ...(allowedDepartments ? { department: { in: allowedDepartments } } : {}),
        ...(department ? { department } : {}),
      },
      distinct: ["createdBy"],
      select: { createdBy: true },
    });
    const users = await prisma.user.findMany({
      where: { id: { in: invoices.map((invoice) => invoice.createdBy) } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return users;
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } }, items: true, payments: { orderBy: { paymentDate: "asc" } } } });
    if (!invoice) throw new NotFoundError("Invoice not found");
    requireDepartmentAccess(actor.role, invoiceDepartment(invoice));
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
        reversed: invoice.status === "VOID" || payment.deletedAt !== null,
        receivedBy: namesById.get(payment.createdBy) ?? "Unknown",
      })),
    };
  },

  async create(
    actor: AccessTokenPayload,
    input: {
      patientId: string;
      department: InvoiceDepartment;
      appointmentId?: string;
      admissionId?: string;
      items: InvoiceItemInput[];
      discountAmount?: number;
      discountType?: string;
      discountReason?: string;
      taxAmount?: number;
    },
    req?: Request
  ) {
    requireBillingAccess(actor.role);
    if (!canCreateDepartmentInvoice(actor.role, input.department)) {
      throw new ForbiddenError("You are not authorized to create invoices for this department");
    }
    const patient = await prisma.patient.findFirst({ where: { id: input.patientId, deletedAt: null } });
    if (!patient) throw new NotFoundError("Patient not found");
    if (input.items.some((item) => item.itemType === "MEDICINE")) {
      throw new ConflictError("Pharmacy medicines must be billed through the pharmacy module.");
    }

    const itemsWithSubtotal = calculateInvoiceItems(input.items);
    const { subtotal, discountAmount, taxAmount, grandTotal } = calculateInvoiceAmounts(
      itemsWithSubtotal,
      input.discountAmount ?? 0,
      input.taxAmount ?? 0,
    );

    return prisma.$transaction(async (tx) => {
      const invoiceNumber = await generateDepartmentInvoiceNumber(tx, input.department);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          patientId: input.patientId,
          department: input.department,
          appointmentId: input.appointmentId,
          admissionId: input.admissionId,
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
          items: { create: itemsWithSubtotal.map((i) => ({
            itemType: i.itemType as never,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discount: i.discount,
            subtotal: i.subtotal,
            sourceType: i.sourceType ?? (input.appointmentId ? "APPOINTMENT" : undefined),
            sourceId: i.sourceId ?? input.appointmentId,
            sourceDepartment: i.sourceDepartment ?? input.department,
          })) },
        },
        include: { items: true },
      });
      await writeAuditLog({
        userId: actor.sub,
        action: "CREATE",
        module: "billing",
        entityType: "Invoice",
        entityId: invoice.id,
        newValues: invoice,
        req,
      }, tx);
      return invoice;
    });
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
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          pharmacySale: { select: { id: true } },
          pharmacyLedgerEntries: { select: { id: true }, take: 1 },
          labOrders: { select: { id: true } },
          ultrasoundOrder: { select: { id: true } },
          items: { select: { itemType: true } },
        },
      });
      if (!invoice) throw new NotFoundError("Invoice not found");
      if (invoice.patientId) await assertPatientAccess(actor, invoice.patientId);
      requireDepartmentAccess(actor.role, invoiceDepartment(invoice));
      if (!invoice.department && !canRecordInvoicePayment(actor.role, invoice)) {
        throw new ForbiddenError("You are not authorized to record payments for this invoice");
      }
      if (invoice.status === "VOID") throw new ConflictError("Cannot record payment on a voided invoice");
      if (invoice.status === "PAID") throw new ConflictError("Invoice is already fully paid");

      const amount = roundMoney(input.amount);
      const balance = roundMoney(invoice.balanceAmount);
      if (amount.gt(balance)) {
        throw new BadRequestError(`Payment of ${amount} exceeds remaining balance of ${balance}`);
      }

      const payment = await tx.payment.create({
        data: {
          invoiceId,
          paymentMethod: input.paymentMethod as never,
          amount,
          type: "PAYMENT",
          referenceNumber: input.referenceNumber,
          notes: input.notes,
          createdBy: actor.sub,
          idempotencyKey,
        },
      });

      const newPaidAmount = roundMoney(invoice.paidAmount.plus(amount));
      const newBalance = roundMoney(invoice.grandTotal.minus(newPaidAmount));
      const newStatus = newBalance.lte(0) ? "PAID" : "PARTIAL";

      const inv = await tx.invoice.update({
        where: { id: invoiceId },
        data: { paidAmount: newPaidAmount, balanceAmount: newBalance.gt(0) ? newBalance : roundMoney(0), status: newStatus },
      });

      if (isPharmacyInvoice(invoice)) {
        const creditEntry = await tx.pharmacyLedgerEntry.findFirst({
          where: { invoiceId, type: "SALE_ON_CREDIT" },
          select: { accountId: true },
        });
        if (creditEntry) {
          const currentLedger = await tx.pharmacyLedgerEntry.aggregate({
            where: { accountId: creditEntry.accountId },
            _sum: { amount: true },
          });
          const ledgerEntry = await tx.pharmacyLedgerEntry.create({
            data: {
              accountId: creditEntry.accountId,
              invoiceId,
              type: "PAYMENT_RECEIVED",
              amount: amount.negated(),
              balanceAfter: roundMoney(new Prisma.Decimal(currentLedger._sum.amount ?? 0).minus(amount)),
              paymentMethod: input.paymentMethod as PaymentMethod,
              notes: input.notes ?? "Pharmacy invoice payment",
              createdBy: actor.sub,
            },
          });
          await writeAuditLog({
            userId: actor.sub,
            action: "CREATE",
            module: "pharmacy",
            entityType: "PharmacyLedgerEntry",
            entityId: ledgerEntry.id,
            newValues: ledgerEntry,
            req,
          }, tx);
        }
      }

      await postLabInvoicePayment(tx, invoiceId, amount, input.paymentMethod as PaymentMethod, actor.sub);
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "billing", entityType: "Payment", entityId: payment.id, newValues: payment, req }, tx);
      return inv;
    });
  },

  async refund(
    actor: AccessTokenPayload,
    invoiceId: string,
    input: { paymentMethod: string; amount: number; reason: string; referenceNumber?: string; notes?: string },
    req?: Request,
  ) {
    if (actor.role !== "ADMIN" && actor.role !== "BILLING_MANAGER") {
      throw new ForbiddenError("Only Admin or Billing Manager may refund an invoice.");
    }
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestError("A reason is required to refund an invoice.");
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new NotFoundError("Invoice not found");
      if (invoice.patientId) await assertPatientAccess(actor, invoice.patientId);
      if (invoice.status === "VOID") throw new ConflictError("Cannot refund a voided invoice.");

      const priorPayments = await tx.payment.aggregate({
        where: { invoiceId, deletedAt: null, type: "PAYMENT" },
        _sum: { amount: true },
      });
      const priorRefunds = await tx.payment.aggregate({
        where: { invoiceId, deletedAt: null, type: "REFUND" },
        _sum: { amount: true },
      });
      const netPaid = roundMoney(
        new Prisma.Decimal(priorPayments._sum.amount ?? 0).minus(priorRefunds._sum.amount ?? 0),
      );
      const amount = roundMoney(input.amount);
      if (amount.gt(netPaid)) {
        throw new BadRequestError(`Refund of ${amount} exceeds amount actually paid of ${netPaid}`);
      }

      const refund = await tx.payment.create({
        data: {
          invoiceId,
          type: "REFUND",
          paymentMethod: input.paymentMethod as PaymentMethod,
          amount,
          reason,
          referenceNumber: input.referenceNumber,
          notes: input.notes,
          createdBy: actor.sub,
        },
      });
      const newPaidAmount = roundMoney(netPaid.minus(amount));
      const newBalance = roundMoney(invoice.grandTotal.minus(newPaidAmount));
      const newStatus: InvoiceStatus = newPaidAmount.isZero()
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaidAmount,
          balanceAmount: newBalance.gt(0) ? newBalance : roundMoney(0),
          status: newStatus,
        },
      });
      await writeAuditLog({
        userId: actor.sub,
        action: "UPDATE",
        reason,
        module: "billing",
        entityType: "Payment",
        entityId: refund.id,
        oldValues: { paidAmount: invoice.paidAmount, status: invoice.status },
        newValues: { refund, paidAmount: newPaidAmount, status: newStatus, reason },
        req,
      }, tx);
      return updated;
    });
  },

  /** Void reverses all payments logically (invoice + payments marked, balance not owed). No hard delete. */
  async voidInvoice(actor: AccessTokenPayload, id: string, reason: string, req?: Request) {
    if (actor.role !== "ADMIN" && actor.role !== "BILLING_MANAGER") {
      throw new ForbiddenError("Only Admin or Billing Manager may void an invoice.");
    }
    if (!reason.trim()) throw new BadRequestError("A reason is required to void an invoice.");
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        payments: true,
        items: true,
        labOrders: { select: { id: true } },
        pharmacySale: { select: { id: true } },
        ultrasoundOrder: { select: { id: true } },
        pharmacyLedgerEntries: { select: { id: true }, take: 1 },
      },
    });
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.patientId) await assertPatientAccess(actor, invoice.patientId);
    if (invoice.status === "VOID") throw new ConflictError("Invoice already void");
    if (invoice.pharmacySale || invoice.items.some((item) => item.itemType === "MEDICINE")) {
      throw new ConflictError("Pharmacy invoices must be voided through the pharmacy sale workflow.");
    }
    if (!canVoidLabInvoice(actor.role, isLabInvoice(invoice))) {
      throw new ForbiddenError("Only Admin or Billing Manager may approve cancellation of a Lab invoice.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id },
        data: { status: "VOID", voidedAt: new Date(), voidReason: reason, voidedBy: actor.sub },
      });
      const labLedgerCharge = await tx.labLedgerEntry.findFirst({ where: { invoiceId: id, type: "INVOICE_CHARGE" } });
      if (labLedgerCharge && roundMoney(invoice.balanceAmount).gt(0)) {
        await appendLabLedgerEntry(tx, {
          accountId: labLedgerCharge.accountId,
          type: "ADJUSTMENT",
          amount: roundMoney(invoice.balanceAmount).negated(),
          notes: `Outstanding balance reversed for voided invoice ${invoice.invoiceNumber}: ${reason}`,
          createdBy: actor.sub,
        });
      }
      await writeAuditLog({ userId: actor.sub, action: "VOID", module: "billing", entityType: "Invoice", entityId: id, oldValues: { status: invoice.status }, newValues: { status: "VOID", reason: reason.trim() }, reason: reason.trim(), req }, tx);
      return inv;
    });

    return updated;
  },

  async listPatientInvoices(patientId: string) {
    return prisma.invoice.findMany({ where: { patientId }, include: { items: true, payments: { where: { deletedAt: null } } }, orderBy: { createdAt: "desc" } });
  },

  async summary(actor: AccessTokenPayload, params: { dateFrom?: string; dateTo?: string }) {
    if (actor.role !== "ADMIN" && actor.role !== "BILLING_MANAGER") {
      throw new ForbiddenError("Only Admin or Billing Manager may view the all-department billing summary.");
    }
    const invoiceDates = dateRange(params.dateFrom, params.dateTo);
    const paymentDates = params.dateFrom || params.dateTo
      ? {
          ...(params.dateFrom ? { gte: new Date(`${params.dateFrom}T00:00:00.000+05:00`) } : {}),
          ...(params.dateTo ? { lt: new Date(new Date(`${params.dateTo}T00:00:00.000+05:00`).getTime() + 86400000) } : {}),
        }
      : undefined;
    const departments: InvoiceDepartment[] = ["RECEPTION", "LAB", "PHARMACY", "ULTRASOUND", "IPD"];
    const [invoices, payments, ipdItems] = await Promise.all([
      prisma.invoice.findMany({
        where: { ...(invoiceDates ? { createdAt: invoiceDates } : {}), status: { not: "VOID" } },
        select: { department: true, grandTotal: true, balanceAmount: true },
      }),
      prisma.payment.findMany({
        where: {
          ...(paymentDates ? { paymentDate: paymentDates } : {}),
          deletedAt: null,
          invoice: { status: { not: "VOID" } },
        },
        select: { type: true, amount: true, invoice: { select: { department: true } } },
      }),
      prisma.invoiceItem.groupBy({
        by: ["sourceDepartment"],
        where: {
          invoice: { department: "IPD", ...(invoiceDates ? { createdAt: invoiceDates } : {}) },
          sourceDepartment: { not: null },
        },
        _sum: { subtotal: true },
      }),
    ]);
    const result = departments.map((department) => {
      const departmentInvoices = invoices.filter((invoice) => (invoice.department ?? "RECEPTION") === department);
      const departmentPayments = payments.filter((payment) => (payment.invoice.department ?? "RECEPTION") === department);
      const totals = aggregatePaymentTotals(departmentPayments);
      return {
        department,
        invoiced: departmentInvoices.reduce((sum, invoice) => sum.plus(invoice.grandTotal), new Prisma.Decimal(0)),
        collected: totals.gross,
        refunded: totals.refunds,
        netCollected: totals.net,
        outstanding: departmentInvoices.reduce((sum, invoice) => sum.plus(invoice.balanceAmount), new Prisma.Decimal(0)),
      };
    });
    return {
      departments: result,
      billedViaIpd: ipdItems.map((item) => ({ sourceDepartment: item.sourceDepartment, amount: item._sum.subtotal ?? new Prisma.Decimal(0) })),
    };
  },

  async history(actor: AccessTokenPayload, params: PageParams) {
    if (actor.role !== "ADMIN" && actor.role !== "BILLING_MANAGER") {
      throw new ForbiddenError("Only Admin or Billing Manager may view billing history.");
    }
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        skip: params.skip,
        take: params.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
          items: true,
          payments: { orderBy: { paymentDate: "desc" } },
        },
      }),
      prisma.invoice.count(),
    ]);
    return { items, total };
  },
};
