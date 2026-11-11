import { InvoiceDepartment, PaymentMethod, Prisma, Role } from "@prisma/client";
import { randomUUID } from "crypto";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@common/errors/AppError";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { writeAuditLog } from "@common/utils/auditLog";
import { generateDepartmentInvoiceNumber } from "@common/utils/sequenceGenerators";
import { roundMoney } from "@common/utils/money";
import { deductStockFefo } from "@modules/pharmacy/pharmacy.service";
import { assertDoctorOwns } from "@common/utils/recordAuthorization";
import { bedRentAccrualDates } from "./ipdBilling.utils";

const IPD_CHARGE_ROLES: Role[] = ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"];
const PAYMENT_ROLES: Role[] = ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"];
function assertAllowed(role: Role, allowed: Role[], action: string) {
  if (!allowed.includes(role)) throw new ForbiddenError(`You are not authorized to ${action}.`);
}

export async function getBedRentCutoffTimeInTransaction(tx: Prisma.TransactionClient, admissionCutoff?: string) {
  const configured = await tx.setting.findUnique({ where: { key: "ipd.bedRentCutoffTime" } });
  const cutoff = admissionCutoff ?? configured?.value ?? "12:00";
  if (typeof cutoff !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) {
    throw new BadRequestError("The IPD bed-rent cut-off time setting is invalid; use 24-hour HH:mm.");
  }
  return cutoff;
}

async function readCutoff(tx: Prisma.TransactionClient, admissionCutoff?: string | null) {
  const cutoff = await getBedRentCutoffTimeInTransaction(tx, admissionCutoff ?? undefined);
  const profile = await tx.hospitalProfile.findFirst({ select: { timezone: true } });
  return { cutoff, timezone: profile?.timezone || "Asia/Karachi" };
}

export async function createIpdInvoiceInTransaction(
  tx: Prisma.TransactionClient,
  admission: { id: string; patientId: string; createdBy: string; admissionDate: Date },
) {
  const existing = await tx.invoice.findUnique({ where: { admissionId: admission.id } });
  if (existing) {
    if (existing.department !== "IPD") throw new ConflictError("Admission is linked to a non-IPD invoice.");
    return existing;
  }
  const invoiceNumber = await generateDepartmentInvoiceNumber(tx, "IPD", admission.admissionDate);
  return tx.invoice.create({
    data: {
      invoiceNumber,
      patientId: admission.patientId,
      admissionId: admission.id,
      createdBy: admission.createdBy,
      department: "IPD",
      status: "UNPAID",
      subtotal: 0,
      grandTotal: 0,
      paidAmount: 0,
      balanceAmount: 0,
    },
  });
}

export async function updateIpdInvoiceTotals(tx: Prisma.TransactionClient, invoiceId: string, statusOverride?: "FINALIZED") {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { items: { select: { subtotal: true } } },
  });
  if (invoice.status === "VOID") throw new ConflictError("Cannot add or reverse charges on a voided IPD invoice.");
  const grandTotal = roundMoney(invoice.items.reduce((sum, item) => sum.plus(item.subtotal), new Prisma.Decimal(0)));
  const balanceAmount = roundMoney(grandTotal.minus(invoice.paidAmount)).gt(0)
    ? roundMoney(grandTotal.minus(invoice.paidAmount))
    : roundMoney(0);
  const status = statusOverride ?? (balanceAmount.isZero() ? "PAID" : invoice.paidAmount.isZero() ? "UNPAID" : "PARTIAL");
  return tx.invoice.update({
    where: { id: invoiceId },
    data: { subtotal: grandTotal, grandTotal, balanceAmount, status },
  });
}
export const updateInvoiceTotals = updateIpdInvoiceTotals;

export async function addIpdChargeInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    admissionId: string;
    itemType: "LAB" | "ULTRASOUND" | "OT" | "OTHER";
    description: string;
    amount: Prisma.Decimal.Value;
    discount?: Prisma.Decimal.Value;
    sourceType: string;
    sourceId: string;
    sourceDepartment: "LAB" | "ULTRASOUND" | "IPD";
    createdBy: string;
    serviceCategory?: string;
  },
) {
  const admission = await tx.admission.findUnique({ where: { id: input.admissionId } });
  if (!admission) throw new NotFoundError("Admission not found.");
  if (admission.status !== "ACTIVE") throw new ConflictError("New charges can only be posted to an active admission.");
  const invoice = await tx.invoice.findUnique({ where: { admissionId: admission.id } });
  if (!invoice) throw new ConflictError("This admission has no IPD invoice. Legacy admissions are not backfilled automatically.");
  if (invoice.status === "FINALIZED" || invoice.status === "VOID") {
    throw new ConflictError("Cannot post OT charges to a settled, closed, or voided IPD invoice.");
  }
  const amount = roundMoney(input.amount);
  const discount = roundMoney(input.discount ?? 0);
  if (amount.lt(0) || discount.lt(0) || discount.gt(amount)) throw new BadRequestError("IPD charge amount or discount is invalid.");
  const item = await tx.invoiceItem.create({
    data: {
      invoiceId: invoice.id,
      admissionId: admission.id,
      itemType: input.itemType,
      description: input.description,
      quantity: 1,
      unitPrice: amount,
      subtotal: roundMoney(amount.minus(discount)),
      discount,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceDepartment: input.sourceDepartment as InvoiceDepartment,
      serviceCategory: input.serviceCategory ?? "TESTS",
    },
  });
  await writeAuditLog({
    userId: input.createdBy,
    action: "CREATE",
    module: "billing",
    entityType: "InvoiceItem",
    entityId: item.id,
    newValues: { admissionId: input.admissionId, sourceType: input.sourceType, sourceId: input.sourceId, sourceDepartment: input.sourceDepartment },
  }, tx);
  await updateIpdInvoiceTotals(tx, invoice.id);
  return item;
}

async function getRateAt(
  tx: Prisma.TransactionClient,
  bedId: string,
  at: Date,
  initialAdmissionRate: Prisma.Decimal | null,
  initialBedId: string,
) {
  const history = await tx.bedRateHistory.findFirst({
    where: { bedId, effectiveAt: { lte: at } },
    orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
    select: { dailyRate: true },
  });
  if (history) return history.dailyRate;
  if (bedId === initialBedId && initialAdmissionRate) return initialAdmissionRate;
  return (await tx.bed.findUniqueOrThrow({ where: { id: bedId }, select: { dailyRate: true } })).dailyRate;
}

export async function ensureBedRentLinesInTransaction(
  tx: Prisma.TransactionClient,
  admissionId: string,
  upTo = new Date(),
) {
  await tx.$queryRaw`SELECT "id" FROM "admissions" WHERE "id" = ${admissionId} FOR UPDATE`;
  const admission = await tx.admission.findUnique({
    where: { id: admissionId },
    include: { transfers: { orderBy: { transferDate: "asc" } } },
  });
  if (!admission) throw new NotFoundError("Admission not found.");
  const end = admission.dischargeDate && admission.dischargeDate < upTo ? admission.dischargeDate : upTo;
  const { cutoff, timezone } = await readCutoff(tx, admission.bedRentCutoffTime);
  const dates = bedRentAccrualDates(admission.admissionDate, end, cutoff, timezone);
  const invoice = await tx.invoice.findUnique({ where: { admissionId } });
  if (!invoice) throw new ConflictError("This admission has no IPD invoice. Historical admissions are not automatically backfilled.");
  if (invoice.department !== "IPD") throw new ConflictError("Admission is linked to a non-IPD invoice.");
  if (invoice.status === "VOID") throw new ConflictError("Bed rent cannot be posted to a voided invoice.");
  const existing = await tx.invoiceItem.findMany({
    where: { admissionId, dayIndex: { not: null } },
    select: { dayIndex: true },
  });
  const existingDays = new Set(existing.map((item) => item.dayIndex));
  let added = 0;

  for (const date of dates) {
    if (existingDays.has(date.dayIndex)) continue;
    let bedId = admission.bedId;
    for (const transfer of admission.transfers) {
      if (transfer.transferDate <= date.accruedAt) bedId = transfer.toBedId;
      else break;
    }
    const rate = await getRateAt(tx, bedId, date.accruedAt, admission.dailyRate, admission.bedId);
    if (rate.lt(0)) throw new ConflictError("A bed has an invalid negative daily rate.");
    const bed = await tx.bed.findUnique({ where: { id: bedId }, select: { bedNumber: true } });
    if (!bed) throw new NotFoundError("Bed for a rent day no longer exists.");
    const rentLine = await tx.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        admissionId,
        bedId,
        dayIndex: date.dayIndex,
        serviceDate: new Date(`${date.serviceDate}T00:00:00.000Z`),
        itemType: "WARD",
        description: `Bed rent Day ${date.dayIndex} · ${bed.bedNumber} · ${date.serviceDate}`,
        quantity: 1,
        unitPrice: rate,
        discount: 0,
        subtotal: rate,
        sourceType: "BED_RENT",
        sourceId: bedId,
        sourceDepartment: "IPD",
        serviceCategory: "BED",
      },
    });
    await writeAuditLog({
      action: "CREATE",
      module: "billing",
      entityType: "InvoiceItem",
      entityId: rentLine.id,
      newValues: { admissionId, dayIndex: date.dayIndex, bedId, dailyRate: rate, serviceDate: date.serviceDate },
    }, tx);
    existingDays.add(date.dayIndex);
    added += 1;
  }
  if (added) await updateInvoiceTotals(tx, invoice.id);
  return { invoiceId: invoice.id, added, billedDays: existingDays.size };
}

export async function ensureBedRentLines(admissionId: string, upTo = new Date()) {
  return prisma.$transaction((tx) => ensureBedRentLinesInTransaction(tx, admissionId, upTo));
}

export async function reverseIpdLineInTransaction(
  tx: Prisma.TransactionClient,
  itemId: string,
  reason: string,
  actorId: string,
  req?: Request,
) {
  const original = await tx.invoiceItem.findUnique({ where: { id: itemId } });
  if (!original) throw new NotFoundError("IPD invoice line not found.");
  if (original.reversedAt) throw new ConflictError("This IPD invoice line was already reversed.");
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new BadRequestError("A reason is required to reverse an IPD line.");
  const reversal = await tx.invoiceItem.create({
    data: {
      invoiceId: original.invoiceId,
      admissionId: original.admissionId,
      itemType: original.itemType,
      description: `Credit: ${original.description} — ${normalizedReason}`,
      quantity: 1,
      unitPrice: original.subtotal.negated(),
      discount: 0,
      subtotal: original.subtotal.negated(),
      sourceType: "IPD_CREDIT",
      sourceId: original.id,
      sourceDepartment: original.sourceDepartment,
      serviceCategory: original.serviceCategory,
      reversesItemId: original.id,
      reversalReason: normalizedReason,
      reversedBy: actorId,
    },
  });
  await tx.invoiceItem.update({
    where: { id: original.id },
    data: { reversedAt: new Date(), reversalReason: normalizedReason, reversedBy: actorId },
  });
  await updateIpdInvoiceTotals(tx, original.invoiceId);
  await writeAuditLog({
    userId: actorId,
    action: "UPDATE",
    module: "billing",
    entityType: "InvoiceItem",
    entityId: reversal.id,
    oldValues: original,
    newValues: reversal,
    reason: normalizedReason,
    req,
  }, tx);
  return reversal;
}

export const ipdBillingService = {
  async getRunningBill(actor: AccessTokenPayload, admissionId: string, req?: Request) {
    assertAllowed(actor.role, ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"], "view an IPD running bill");
    const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError("Admission not found.");
    if (actor.role === "DOCTOR") await assertDoctorOwns(actor, admission.attendingDoctorId);
    await ensureBedRentLines(admissionId);
    const invoice = await prisma.invoice.findUnique({
      where: { admissionId },
      include: { items: { orderBy: { serviceDate: "asc" } }, payments: { orderBy: { paymentDate: "asc" } } },
    });
    if (!invoice) throw new ConflictError("This admission has no IPD invoice.");
    const categories = {
      bed: invoice.items.filter((item) => item.serviceCategory === "BED"),
      medicines: invoice.items.filter((item) => item.serviceCategory === "MEDICINE"),
      services: invoice.items.filter((item) => item.serviceCategory === "SERVICES"),
      tests: invoice.items.filter((item) => item.serviceCategory === "TESTS"),
    };
    const paid = invoice.payments.filter((payment) => payment.deletedAt === null).reduce(
      (sum, payment) => sum.plus(payment.type === "REFUND" ? payment.amount.negated() : payment.amount),
      new Prisma.Decimal(0),
    );
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "billing", entityType: "Invoice", entityId: invoice.id, newValues: { admissionId }, req });
    return {
      admissionId,
      invoice,
      categories,
      totals: { charged: invoice.grandTotal, paid, balance: invoice.balanceAmount },
    };
  },

  async listInvoices(actor: AccessTokenPayload, params: {
    skip: number;
    limit: number;
    dateFrom?: string;
    dateTo?: string;
    patientId?: string;
    createdBy?: string;
    search?: string;
    status?: string;
  }) {
    assertAllowed(actor.role, ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"], "view IPD invoices");
    const createdAt: Prisma.DateTimeFilter | undefined = params.dateFrom || params.dateTo
      ? {
        ...(params.dateFrom ? { gte: new Date(`${params.dateFrom}T00:00:00.000+05:00`) } : {}),
        ...(params.dateTo ? { lt: new Date(new Date(`${params.dateTo}T00:00:00.000+05:00`).getTime() + 86400000) } : {}),
      }
      : undefined;
    const where: Prisma.InvoiceWhereInput = {
      department: "IPD",
      ...(params.status ? { status: params.status as Prisma.EnumInvoiceStatusFilter<"Invoice"> } : {}),
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.createdBy ? { createdBy: params.createdBy } : {}),
      ...(createdAt ? { createdAt } : {}),
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
      prisma.invoice.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        include: { patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } }, payments: true, items: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.invoice.count({ where }),
    ]);
    return { items, total };
  },

  async listServiceCharges(actor: AccessTokenPayload) {
    assertAllowed(actor.role, IPD_CHARGE_ROLES, "view IPD service charges");
    return prisma.serviceCharge.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  },

  async createServiceCharge(actor: AccessTokenPayload, input: { name: string; category: string; defaultPrice: number }, req?: Request) {
    if (actor.role !== "ADMIN") throw new ForbiddenError("Only Admin may manage the IPD service catalog.");
    return prisma.$transaction(async (tx) => {
      const charge = await tx.serviceCharge.create({
        data: { name: input.name.trim(), category: input.category.trim(), defaultPrice: roundMoney(input.defaultPrice), createdBy: actor.sub },
      });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "billing", entityType: "ServiceCharge", entityId: charge.id, newValues: charge, req }, tx);
      return charge;
    });
  },

  async addServiceCharge(actor: AccessTokenPayload, admissionId: string, input: { serviceChargeId: string; amount?: number; quantity?: number }, req?: Request) {
    assertAllowed(actor.role, IPD_CHARGE_ROLES, "add a service charge");
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admission.findUnique({ where: { id: admissionId } });
      if (!admission) throw new NotFoundError("Admission not found.");
      if (admission.status !== "ACTIVE") throw new ConflictError("Service charges can only be added to an active admission.");
      if (actor.role === "DOCTOR") await assertDoctorOwns(actor, admission.attendingDoctorId);
      const charge = await tx.serviceCharge.findFirst({ where: { id: input.serviceChargeId, isActive: true } });
      if (!charge) throw new NotFoundError("Active service charge not found.");
      const invoice = await tx.invoice.findUnique({ where: { admissionId } });
      if (!invoice) throw new ConflictError("This admission has no IPD invoice.");
      const quantity = input.quantity ?? 1;
      const unitPrice = roundMoney(input.amount ?? charge.defaultPrice);
      if (unitPrice.lt(0)) throw new BadRequestError("Service line price cannot be negative.");
      const subtotal = roundMoney(unitPrice.mul(quantity));
      const line = await tx.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          admissionId,
          itemType: charge.category.toUpperCase() === "OT" ? "OT" : "OTHER",
          description: charge.name,
          quantity,
          unitPrice,
          discount: 0,
          subtotal,
          sourceType: "IPD_SERVICE",
          sourceId: charge.id,
          sourceDepartment: "IPD",
          serviceCategory: "SERVICES",
        },
      });
      await updateInvoiceTotals(tx, invoice.id);
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "billing", entityType: "InvoiceItem", entityId: line.id, newValues: { admissionId, category: charge.category, amount: subtotal }, req }, tx);
      return line;
    });
  },

  async reverseLine(actor: AccessTokenPayload, admissionId: string, itemId: string, reason: string, req?: Request) {
    if (actor.role !== "ADMIN" && actor.role !== "BILLING_MANAGER") throw new ForbiddenError("Only Admin or Billing Manager may reverse an IPD charge.");
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new BadRequestError("A reason is required to reverse an IPD line.");
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admission.findUnique({ where: { id: admissionId } });
      if (!admission) throw new NotFoundError("Admission not found.");
      const invoice = await tx.invoice.findUnique({ where: { admissionId } });
      if (!invoice) throw new ConflictError("This admission has no IPD invoice.");
      const original = await tx.invoiceItem.findFirst({ where: { id: itemId, invoiceId: invoice.id, admissionId } });
      if (!original) throw new NotFoundError("IPD invoice line not found.");
      return reverseIpdLineInTransaction(tx, original.id, normalizedReason, actor.sub, req);
    });
  },

  async recordPayment(actor: AccessTokenPayload, admissionId: string, input: { amount: number; paymentMethod: PaymentMethod; purpose: "DEPOSIT" | "PAYMENT"; notes?: string; referenceNumber?: string }, req?: Request) {
    assertAllowed(actor.role, PAYMENT_ROLES, "record an IPD payment");
    const amount = roundMoney(input.amount);
    if (amount.lte(0)) throw new BadRequestError("Payment amount must be greater than zero.");
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admission.findUnique({ where: { id: admissionId } });
      if (!admission) throw new NotFoundError("Admission not found.");
      const invoice = await tx.invoice.findUnique({ where: { admissionId } });
      if (!invoice) throw new ConflictError("This admission has no IPD invoice.");
      if (invoice.status === "VOID") throw new ConflictError("Cannot pay a voided IPD invoice.");
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${invoice.id} FOR UPDATE`;
      const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      if (input.purpose === "PAYMENT" && amount.gt(current.balanceAmount)) {
        throw new BadRequestError("Payment exceeds the outstanding IPD balance.");
      }
      if (input.purpose === "PAYMENT" && current.status === "FINALIZED" && admission.status !== "DISCHARGED") {
        throw new ConflictError("Only a discharged IPD invoice can be settled as a final payment.");
      }
      const payment = await tx.payment.create({
        data: {
          invoiceId: current.id,
          amount,
          paymentMethod: input.paymentMethod,
          purpose: input.purpose,
          referenceNumber: input.referenceNumber,
          notes: input.notes,
          createdBy: actor.sub,
        },
      });
      if (input.purpose === "DEPOSIT") {
        await tx.admission.update({ where: { id: admissionId }, data: { depositAmount: { increment: amount }, depositStatus: "PAID" } });
        await tx.patientLedgerEntry.create({
          data: {
            patientId: admission.patientId,
            admissionId,
            type: "ADVANCE_DEPOSIT",
            amount,
            paymentMethod: input.paymentMethod,
            notes: input.notes?.trim() || "IPD advance deposit",
            createdBy: actor.sub,
            invoiceId: current.id,
            paymentId: payment.id,
          },
        });
      }
      const paidAmount = roundMoney(current.paidAmount.plus(amount));
      const balanceAmount = roundMoney(current.grandTotal.minus(paidAmount)).gt(0)
        ? roundMoney(current.grandTotal.minus(paidAmount))
        : roundMoney(0);
      await tx.invoice.update({
        where: { id: current.id },
        data: {
          paidAmount,
          balanceAmount,
          status: admission.status === "DISCHARGED"
            ? "FINALIZED"
            : balanceAmount.isZero() ? "PAID" : paidAmount.isZero() ? "UNPAID" : "PARTIAL",
        },
      });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "billing", entityType: "Payment", entityId: payment.id, newValues: payment, req }, tx);
      return payment;
    });
  },

  async settle(actor: AccessTokenPayload, admissionId: string, input: { paymentMethod: PaymentMethod; refundReason?: string }, req?: Request) {
    assertAllowed(actor.role, PAYMENT_ROLES, "settle an IPD invoice");
    await ensureBedRentLines(admissionId);
    return prisma.$transaction(async (tx) => {
      const admission = await tx.admission.findUnique({ where: { id: admissionId } });
      if (!admission) throw new NotFoundError("Admission not found.");
      if (admission.status !== "DISCHARGED") throw new ConflictError("The admission must be discharged before final settlement.");
      const invoice = await tx.invoice.findUnique({ where: { admissionId } });
      if (!invoice) throw new ConflictError("This admission has no IPD invoice.");
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${invoice.id} FOR UPDATE`;
      const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: { where: { deletedAt: null } } } });
      const paymentNet = current.payments.reduce(
        (sum, payment) => sum.plus(payment.type === "REFUND" ? payment.amount.negated() : payment.amount),
        new Prisma.Decimal(0),
      );
      const balance = roundMoney(current.grandTotal.minus(paymentNet));
      if (balance.gt(0)) {
        const payment = await tx.payment.create({
          data: { invoiceId: invoice.id, amount: balance, paymentMethod: input.paymentMethod, purpose: "PAYMENT", notes: "IPD final settlement", createdBy: actor.sub },
        });
        await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: current.paidAmount.plus(balance), balanceAmount: 0, status: "FINALIZED" } });
        await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "billing", entityType: "Payment", entityId: payment.id, newValues: payment, req }, tx);
        return { invoiceId: invoice.id, settled: true, payment, refund: null };
      }
      if (balance.lt(0)) {
        if (actor.role !== "ADMIN" && actor.role !== "BILLING_MANAGER") {
          throw new ForbiddenError("Only Admin or Billing Manager may refund excess IPD deposit.");
        }
        const reason = input.refundReason?.trim();
        if (!reason) throw new BadRequestError("A reason is required to refund the excess deposit.");
        const refundAmount = balance.abs();
        const refund = await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: refundAmount,
            paymentMethod: input.paymentMethod,
            type: "REFUND",
            purpose: "DEPOSIT",
            reason,
            notes: "Refund of excess IPD deposit",
            createdBy: actor.sub,
          },
        });
        const paidAmount = roundMoney(current.paidAmount.minus(refundAmount));
        await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount, balanceAmount: 0, status: "FINALIZED" } });
        await tx.admission.update({ where: { id: admissionId }, data: { depositAmount: { decrement: refundAmount }, depositStatus: admission.depositAmount.lte(refundAmount) ? "PENDING" : "PAID" } });
        await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "billing", entityType: "Payment", entityId: refund.id, oldValues: { paymentNet }, newValues: refund, reason, req }, tx);
        return { invoiceId: invoice.id, settled: true, payment: null, refund };
      }
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: "FINALIZED", balanceAmount: 0 } });
      return { invoiceId: invoice.id, settled: true, payment: null, refund: null };
    });
  },

  async reverseBedRentDay(actor: AccessTokenPayload, admissionId: string, dayIndex: number, reason: string, req?: Request) {
    return this.reverseLine(actor, admissionId, (await prisma.invoiceItem.findFirstOrThrow({
      where: { admissionId, dayIndex },
      select: { id: true },
    })).id, reason, req);
  },

  async runDailyBedRentJob() {
    const lockKey = "careplus:ipd:bed-rent-job";
    const token = randomUUID();
    if (await redis.set(lockKey, token, "EX", 23 * 60 * 60, "NX") !== "OK") return { acquired: false, processed: 0 };
    let processed = 0;
    let completed = false;
    try {
      const admissions = await prisma.admission.findMany({
        where: { status: "ACTIVE", invoices: { some: { department: "IPD" } } },
        select: { id: true },
      });
      for (const admission of admissions) {
        await ensureBedRentLines(admission.id);
        processed += 1;
      }
      completed = true;
      return { acquired: true, processed };
    } finally {
      if (!completed) {
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lockKey,
          token,
        );
      }
    }
  },
};

export async function issueWardMedicineOrder(
  actor: AccessTokenPayload,
  admissionId: string,
  orderId: string,
  req?: Request,
) {
  if (actor.role !== "ADMIN" && actor.role !== "PHARMACIST") {
    throw new ForbiddenError("Only Pharmacy staff or Admin may issue ward medicines.");
  }
  return prisma.$transaction(async (tx) => {
    const admission = await tx.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError("Admission not found.");
    if (admission.status !== "ACTIVE") throw new ConflictError("Medicines can only be issued to an active admission.");
    const order = await tx.wardMedicineOrder.findFirst({
      where: { id: orderId, admissionId, issuedAt: null },
      include: { items: { include: { medicine: true } } },
    });
    if (!order) throw new NotFoundError("Open ward medicine order not found.");
    const invoice = await tx.invoice.findUnique({ where: { admissionId } });
    if (!invoice) throw new ConflictError("This admission has no IPD invoice.");
    const issuedLines = [];
    for (const orderItem of order.items) {
      const movements = await deductStockFefo(tx, orderItem.medicineId, orderItem.quantity, "ipd_ward_issue", orderItem.id, actor.sub);
      const amount = roundMoney(movements.reduce((sum, movement) => sum.plus(new Prisma.Decimal(movement.qty).mul(movement.unitPrice)), new Prisma.Decimal(0)));
      const unitPrice = roundMoney(amount.div(orderItem.quantity));
      const invoiceItem = await tx.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          admissionId,
          itemType: "MEDICINE",
          description: orderItem.medicine.name,
          quantity: orderItem.quantity,
          unitPrice,
          discount: 0,
          subtotal: amount,
          sourceType: "WARD_MEDICINE_ORDER",
          sourceId: orderItem.id,
          sourceDepartment: "PHARMACY",
          serviceCategory: "MEDICINE",
        },
      });
      await tx.wardMedicineOrderItem.update({
        where: { id: orderItem.id },
        data: { issuedQuantity: orderItem.quantity, unitPrice, invoiceItemId: invoiceItem.id },
      });
      issuedLines.push({ orderItemId: orderItem.id, invoiceItemId: invoiceItem.id, movements });
    }
    await tx.wardMedicineOrder.update({ where: { id: order.id }, data: { issuedAt: new Date() } });
    await updateInvoiceTotals(tx, invoice.id);
    await writeAuditLog({ userId: actor.sub, action: "DISPENSE", module: "pharmacy", entityType: "WardMedicineOrder", entityId: order.id, newValues: { admissionId, issuedLines }, req }, tx);
    return { orderId: order.id, invoiceId: invoice.id, issuedLines };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function returnWardMedicine(
  actor: AccessTokenPayload,
  admissionId: string,
  orderItemId: string,
  input: { quantity: number; reason: string },
  req?: Request,
) {
  if (actor.role !== "ADMIN" && actor.role !== "PHARMACIST") {
    throw new ForbiddenError("Only Pharmacy staff or Admin may return ward medicines.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new BadRequestError("A reason is required to return ward medicine.");
  return prisma.$transaction(async (tx) => {
    const admission = await tx.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError("Admission not found.");
    const orderItem = await tx.wardMedicineOrderItem.findFirst({
      where: { id: orderItemId, order: { admissionId } },
      include: { medicine: true },
    });
    if (!orderItem || !orderItem.invoiceItemId || !orderItem.unitPrice) throw new NotFoundError("Issued ward medicine item not found.");
    const remaining = orderItem.issuedQuantity - orderItem.returnedQuantity;
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > remaining) {
      throw new BadRequestError("Return quantity must be within the unreturned issued quantity.");
    }
    await tx.invoiceItem.findUniqueOrThrow({ where: { id: orderItem.invoiceItemId } });
    const creditAmount = roundMoney(orderItem.unitPrice.mul(input.quantity));
    const invoice = await tx.invoice.findUnique({ where: { admissionId } });
    if (!invoice) throw new ConflictError("This admission has no IPD invoice.");
    const credit = await tx.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        admissionId,
        itemType: "MEDICINE",
        description: `Returned ${input.quantity} × ${orderItem.medicine.name} — ${reason}`,
        quantity: 1,
        unitPrice: creditAmount.negated(),
        discount: 0,
        subtotal: creditAmount.negated(),
        sourceType: "WARD_MEDICINE_RETURN",
        sourceId: orderItem.id,
        sourceDepartment: "PHARMACY",
        serviceCategory: "MEDICINE",
        reversalReason: reason,
        reversedBy: actor.sub,
      },
    });
    const batchMovements = await tx.stockMovement.findMany({
      where: { referenceType: "ipd_ward_issue", referenceId: orderItem.id, movementType: "OUT" },
      orderBy: { createdAt: "asc" },
    });
    const previousReturns = await tx.stockMovement.findMany({
      where: { referenceType: "ipd_ward_return", referenceId: orderItem.id, movementType: "RETURN" },
      select: { batchId: true, quantity: true },
    });
    const returnedByBatch = new Map<string, number>();
    for (const movement of previousReturns) {
      returnedByBatch.set(movement.batchId, (returnedByBatch.get(movement.batchId) ?? 0) + movement.quantity);
    }
    let quantityToReturn = input.quantity;
    for (const movement of batchMovements) {
      if (quantityToReturn <= 0) break;
      const available = movement.quantity - (returnedByBatch.get(movement.batchId) ?? 0);
      if (available <= 0) continue;
      const returned = Math.min(available, quantityToReturn);
      await tx.medicineBatch.update({ where: { id: movement.batchId }, data: { stockQuantity: { increment: returned } } });
      await tx.stockMovement.create({
        data: { batchId: movement.batchId, movementType: "RETURN", quantity: returned, referenceType: "ipd_ward_return", referenceId: orderItem.id, reason, createdBy: actor.sub },
      });
      quantityToReturn -= returned;
    }
    if (quantityToReturn > 0) throw new ConflictError("Could not match the requested return to issued stock movements.");
    await tx.wardMedicineOrderItem.update({ where: { id: orderItem.id }, data: { returnedQuantity: { increment: input.quantity } } });
    await tx.wardMedicineOrder.update({ where: { id: orderItem.orderId }, data: { returnedAt: new Date() } });
    await updateInvoiceTotals(tx, invoice.id);
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "InvoiceItem", entityId: credit.id, oldValues: { orderItemId, quantity: orderItem.returnedQuantity }, newValues: { quantity: input.quantity, creditAmount }, reason, req }, tx);
    return credit;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createWardMedicineOrder(
  actor: AccessTokenPayload,
  admissionId: string,
  input: { orderNote: string; items: Array<{ medicineId: string; quantity: number }> },
  req?: Request,
) {
  if (actor.role !== "DOCTOR" && actor.role !== "NURSE") {
    throw new ForbiddenError("Only a Doctor or Nurse may place a ward medicine order.");
  }
  return prisma.$transaction(async (tx) => {
    const admission = await tx.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError("Admission not found.");
    if (admission.status !== "ACTIVE") throw new ConflictError("Medicine orders can only be placed for active admissions.");
    if (actor.role === "DOCTOR") await assertDoctorOwns(actor, admission.attendingDoctorId);
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new BadRequestError("Medicine quantities must be positive whole numbers.");
      const medicine = await tx.medicine.findFirst({ where: { id: item.medicineId, isActive: true }, select: { id: true } });
      if (!medicine) throw new NotFoundError("Active medicine not found.");
    }
    const order = await tx.wardMedicineOrder.create({
      data: {
        admissionId,
        orderedBy: actor.sub,
        orderNote: input.orderNote.trim(),
        items: { create: input.items.map((item) => ({ medicineId: item.medicineId, quantity: item.quantity })) },
      },
      include: { items: { include: { medicine: true } } },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "WardMedicineOrder", entityId: order.id, newValues: order, req }, tx);
    return order;
  });
}

export async function listWardMedicineOrders(actor: AccessTokenPayload, admissionId: string) {
  if (actor.role !== "ADMIN" && actor.role !== "PHARMACIST") {
    throw new ForbiddenError("Only Pharmacy staff or Admin may view ward medicine orders.");
  }
  const admission = await prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true } });
  if (!admission) throw new NotFoundError("Admission not found.");
  const orders = await prisma.wardMedicineOrder.findMany({
    where: { admissionId },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          medicine: { select: { id: true, name: true, strength: true, form: true } },
        },
      },
    },
  });
  const itemIds = orders.flatMap((order) => order.items.map((item) => item.id));
  const movements = itemIds.length
    ? await prisma.stockMovement.findMany({
      where: { referenceType: "ipd_ward_issue", referenceId: { in: itemIds }, movementType: "OUT" },
      include: { batch: { select: { batchNumber: true, expiryDate: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    : [];
  const movementsByItem = new Map<string, typeof movements>();
  for (const movement of movements) {
    if (!movement.referenceId) continue;
    const current = movementsByItem.get(movement.referenceId) ?? [];
    current.push(movement);
    movementsByItem.set(movement.referenceId, current);
  }
  return orders.map((order) => ({
    ...order,
    items: order.items.map((item) => ({
      ...item,
      fefoBatches: (movementsByItem.get(item.id) ?? []).map((movement) => ({
        batchNumber: movement.batch.batchNumber,
        expiryDate: movement.batch.expiryDate,
        quantity: movement.quantity,
      })),
    })),
  }));
}

export async function listActiveWardAdmissions(actor: AccessTokenPayload) {
  if (actor.role !== "ADMIN" && actor.role !== "PHARMACIST") {
    throw new ForbiddenError("Only Pharmacy staff or Admin may select a ward admission.");
  }
  return prisma.admission.findMany({
    where: { status: "ACTIVE", invoices: { some: { department: "IPD" } } },
    orderBy: { admissionDate: "desc" },
    select: {
      id: true,
      admissionDate: true,
      patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
      bed: { select: { bedNumber: true, room: { select: { roomNumber: true, ward: { select: { wardName: true } } } } } },
    },
  });
}

export async function recordIpdRefund(
  actor: AccessTokenPayload,
  admissionId: string,
  input: { amount: number; paymentMethod: PaymentMethod; reason: string },
  req?: Request,
) {
  if (actor.role !== "ADMIN" && actor.role !== "BILLING_MANAGER") throw new ForbiddenError("Only Admin or Billing Manager may refund IPD payments.");
  const reason = input.reason.trim();
  if (!reason) throw new BadRequestError("A reason is required to refund an IPD payment.");
  const amount = roundMoney(input.amount);
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { admissionId } });
    if (!invoice) throw new ConflictError("This admission has no IPD invoice.");
    await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${invoice.id} FOR UPDATE`;
    const payments = await tx.payment.findMany({ where: { invoiceId: invoice.id, deletedAt: null } });
    const available = roundMoney(payments.reduce(
      (sum, payment) => sum.plus(payment.type === "PAYMENT" ? payment.amount : payment.amount.negated()),
      new Prisma.Decimal(0),
    ));
    if (amount.lte(0) || amount.gt(available)) throw new BadRequestError("Refund exceeds the amount actually paid.");
    const refund = await tx.payment.create({
      data: { invoiceId: invoice.id, type: "REFUND", purpose: "PAYMENT", paymentMethod: input.paymentMethod, amount, reason, createdBy: actor.sub },
    });
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const paidAmount = roundMoney(current.paidAmount.minus(amount));
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount,
        balanceAmount: roundMoney(current.grandTotal.minus(paidAmount)).gt(0) ? roundMoney(current.grandTotal.minus(paidAmount)) : 0,
        status: paidAmount.isZero() ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "billing", entityType: "Payment", entityId: refund.id, newValues: refund, reason, req }, tx);
    return refund;
  });
}
