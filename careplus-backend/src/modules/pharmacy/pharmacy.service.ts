import { Prisma } from "@prisma/client";
import { Request } from "express";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@config/prisma";
import { env } from "@config/env";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { notifyRoles } from "@common/utils/notify";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { generateInvoiceNumber } from "@common/utils/sequenceGenerators";
import { isAccessTokenBlacklisted } from "@modules/auth/token.utils";

const NEAR_EXPIRY_DAYS = 60;
const roundPkr = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function pharmacyDateFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000+05:00`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000+05:00`).getTime() + 86400000) } : {}),
  };
}

type PharmacyReportPeriod = "today" | "yesterday" | "week" | "month" | "all" | "custom";

function pharmacyDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addPharmacyCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getPharmacyReportRange(period: PharmacyReportPeriod, from?: string, to?: string, now = new Date()) {
  if (period === "all") return { from: undefined, to: undefined };
  if (period === "custom") return { from, to };
  const today = pharmacyDateKey(now);
  if (period === "today") return { from: today, to: today };
  if (period === "yesterday") {
    const yesterday = addPharmacyCalendarDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (period === "week") {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    return { from: addPharmacyCalendarDays(today, mondayOffset), to: today };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function reportSaleDateSql(createdAt?: { gte?: Date; lt?: Date }) {
  return Prisma.sql`
    ${createdAt?.gte ? Prisma.sql`AND ps.created_at >= ${createdAt.gte}` : Prisma.empty}
    ${createdAt?.lt ? Prisma.sql`AND ps.created_at < ${createdAt.lt}` : Prisma.empty}
  `;
}

function reportPage(page: number, limit: number, total: number) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

async function appendPharmacyLedgerEntry(
  tx: Prisma.TransactionClient,
  input: {
    accountId: string;
    type: "SALE_ON_CREDIT" | "PAYMENT_RECEIVED" | "PAYMENT_MADE" | "ADJUSTMENT";
    amount: number;
    createdBy: string;
    invoiceId?: string;
    paymentMethod?: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET";
    notes?: string;
  }
) {
  const balance = await tx.pharmacyLedgerEntry.aggregate({
    where: { accountId: input.accountId },
    _sum: { amount: true },
  });
  const balanceAfter = roundPkr(Number(balance._sum.amount ?? 0) + input.amount);
  return tx.pharmacyLedgerEntry.create({
    data: {
      ...input,
      balanceAfter,
      paymentMethod: input.paymentMethod,
    },
  });
}

async function deductStockFefo(
  tx: Prisma.TransactionClient,
  medicineId: string,
  quantity: number,
  referenceType: string,
  referenceId: string,
  createdBy: string
) {
  const expiryCutoff = new Date(`${pharmacyDateKey(new Date())}T00:00:00.000Z`);
  const batches = await tx.medicineBatch.findMany({
    where: { medicineId, isActive: true, expiryDate: { gte: expiryCutoff }, stockQuantity: { gt: 0 } },
    orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
  });
  let remaining = quantity;
  const movements: { batchId: string; batchNumber: string; qty: number; unitPrice: number; costPrice: number }[] = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.stockQuantity, remaining);
    await tx.medicineBatch.update({ where: { id: batch.id }, data: { stockQuantity: { decrement: take } } });
    await tx.stockMovement.create({ data: { batchId: batch.id, movementType: "OUT", quantity: take, referenceType, referenceId, createdBy } });
    movements.push({ batchId: batch.id, batchNumber: batch.batchNumber, qty: take, unitPrice: Number(batch.sellingPrice), costPrice: Number(batch.purchasePrice) });
    remaining -= take;
  }
  if (remaining > 0) throw new ConflictError(`Insufficient non-expired stock for medicine — short by ${remaining} unit(s). No stock was deducted.`);
  return movements;
}

export async function getCashierDiscountLimit(tx: Prisma.TransactionClient): Promise<number> {
  const setting = await tx.setting.findUnique({ where: { key: "cashierMaxDiscountPercent" } });
  const value = setting?.value ?? 10;
  const limit = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(limit) || limit < 0 || limit > 100) {
    throw new BadRequestError("The cashier discount limit setting must be a number from 0 to 100.");
  }
  return limit;
}

type PharmacySettings = {
  name: string;
  address: string;
  phone: string;
  currency: "PKR";
  defaultReceiptFormat: "a4" | "receipt";
  cashierMaxDiscountPercent: number;
  lossAlertThreshold: number;
  defaultLowStockLevel: number;
};

const pharmacySettingDefaults: PharmacySettings = {
  name: "Pharmacy",
  address: "",
  phone: "",
  currency: "PKR",
  defaultReceiptFormat: "a4",
  cashierMaxDiscountPercent: 10,
  lossAlertThreshold: 0,
  defaultLowStockLevel: 10,
};

const pharmacySettingKeys = Object.keys(pharmacySettingDefaults) as (keyof PharmacySettings)[];

function pharmacySettingStorageKey(key: keyof PharmacySettings) {
  return key === "cashierMaxDiscountPercent" ? key : `pharmacy${key[0].toUpperCase()}${key.slice(1)}`;
}

async function readPharmacySettings(tx: Prisma.TransactionClient | typeof prisma) {
  const storageKeys = pharmacySettingKeys.map(pharmacySettingStorageKey);
  const values = await tx.setting.findMany({ where: { key: { in: storageKeys } } });
  const mapped = new Map(values.map((setting) => [setting.key, setting.value]));
  const settings = Object.fromEntries(pharmacySettingKeys.map((key) => [
    key,
    mapped.has(pharmacySettingStorageKey(key)) ? mapped.get(pharmacySettingStorageKey(key)) : pharmacySettingDefaults[key],
  ]));
  if (
    typeof settings.name !== "string" || typeof settings.address !== "string" || typeof settings.phone !== "string" ||
    settings.currency !== "PKR" || !["a4", "receipt"].includes(String(settings.defaultReceiptFormat)) ||
    !Number.isFinite(Number(settings.cashierMaxDiscountPercent)) || Number(settings.cashierMaxDiscountPercent) < 0 ||
    Number(settings.cashierMaxDiscountPercent) > 100 || !Number.isFinite(Number(settings.lossAlertThreshold)) ||
    Number(settings.lossAlertThreshold) < 0 || !Number.isInteger(Number(settings.defaultLowStockLevel)) ||
    Number(settings.defaultLowStockLevel) < 0
  ) throw new BadRequestError("Pharmacy settings contain an invalid stored value.");
  return {
    name: settings.name,
    address: settings.address,
    phone: settings.phone,
    currency: settings.currency,
    defaultReceiptFormat: settings.defaultReceiptFormat as PharmacySettings["defaultReceiptFormat"],
    cashierMaxDiscountPercent: Number(settings.cashierMaxDiscountPercent),
    lossAlertThreshold: Number(settings.lossAlertThreshold),
    defaultLowStockLevel: Number(settings.defaultLowStockLevel),
  };
}

async function verifyPharmacyPin(pin: string): Promise<string> {
  const security = await prisma.pharmacySecurity.findUnique({ where: { id: "default" } });
  if (!security) throw new ForbiddenError("An Admin PIN has not been configured.");
  const valid = await argon2.verify(security.pinHash, pin);
  if (!valid) throw new ForbiddenError("The Admin PIN is incorrect.");
  const admin = await prisma.user.findFirst({
    where: { id: security.pinAdminId, role: "ADMIN", isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!admin) throw new ForbiddenError("The Admin account associated with this PIN is no longer active.");
  return admin.id;
}

export function assertDiscountLimit(discountPercent: number, limitPercent: number, hasAdminApproval: boolean): void {
  if (discountPercent > limitPercent && !hasAdminApproval) {
    throw new ForbiddenError("Discount exceeds the cashier limit and requires Admin approval.");
  }
}

export async function getApprovingAdminId(token: string | undefined, pin?: string): Promise<string> {
  if (!token && pin) return verifyPharmacyPin(pin);
  if (!token) throw new ForbiddenError("Admin login confirmation or Admin PIN is required for discounts above the cashier limit.");
  let payload: { sub?: string; role?: string };
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub?: string; role?: string };
  } catch {
    throw new UnauthorizedError("Admin approval login is invalid or expired.");
  }
  if (await isAccessTokenBlacklisted(token)) throw new UnauthorizedError("Admin approval login is invalid or expired.");
  if (payload.role !== "ADMIN" || !payload.sub) throw new ForbiddenError("Discount approval must be confirmed by an Admin.");
  const admin = await prisma.user.findFirst({
    where: { id: payload.sub, role: "ADMIN", isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!admin) throw new ForbiddenError("The approving Admin account is no longer active.");
  return admin.id;
}

export const pharmacyService = {
  async listMedicineCategories() {
    return prisma.medicineCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  },

  async getPharmacySettings(actor: AccessTokenPayload, req?: Request) {
    const [settings, security, backup] = await Promise.all([
      readPharmacySettings(prisma),
      prisma.pharmacySecurity.findUnique({ where: { id: "default" }, select: { id: true } }),
      actor.role === "ADMIN"
        ? prisma.backup.findFirst({ where: { status: "SUCCESS" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
        : Promise.resolve(null),
    ]);
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "pharmacy", entityType: "PharmacySettings", req });
    return { ...settings, logoUrl: (await prisma.setting.findUnique({ where: { key: "pharmacyLogoUrl" }, select: { value: true } }))?.value ?? null, adminPinConfigured: Boolean(security), lastBackupAt: backup?.createdAt ?? null };
  },

  async updatePharmacySettings(
    actor: AccessTokenPayload,
    input: {
      name: string; address: string; phone: string; currency: "PKR"; defaultReceiptFormat: "a4" | "receipt";
      cashierMaxDiscountPercent: number; lossAlertThreshold: number; defaultLowStockLevel: number;
    },
    req?: Request
  ) {
    return prisma.$transaction(async (tx) => {
      const changes = Object.entries(input) as [keyof PharmacySettings, PharmacySettings[keyof PharmacySettings]][];
      for (const [key, value] of changes) {
        const settingKey = pharmacySettingStorageKey(key);
        const existing = await tx.setting.findUnique({ where: { key: settingKey } });
        const oldValue = existing?.value ?? pharmacySettingDefaults[key];
        if (JSON.stringify(oldValue) === JSON.stringify(value)) continue;
        await tx.setting.upsert({ where: { key: settingKey }, create: { key: settingKey, value }, update: { value } });
        await writeAuditLog({
          userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "PharmacySetting", entityId: settingKey,
          oldValues: { value: oldValue }, newValues: { value }, req,
        }, tx);
      }
      return readPharmacySettings(tx);
    });
  },

  async updatePharmacyAdminPin(actor: AccessTokenPayload, input: { currentPin?: string; newPin: string }, req?: Request) {
    const existing = await prisma.pharmacySecurity.findUnique({ where: { id: "default" } });
    if (existing) {
      if (!input.currentPin) throw new BadRequestError("Current Admin PIN is required to change the PIN.");
      if (!(await argon2.verify(existing.pinHash, input.currentPin))) throw new ForbiddenError("The current Admin PIN is incorrect.");
    } else if (input.currentPin) {
      throw new BadRequestError("No Admin PIN is configured; leave the current PIN blank for initial setup.");
    }
    const pinHash = await argon2.hash(input.newPin);
    await prisma.$transaction(async (tx) => {
      await tx.pharmacySecurity.upsert({
        where: { id: "default" },
        create: { id: "default", pinHash, pinAdminId: actor.sub },
        update: { pinHash, pinAdminId: actor.sub },
      });
      await writeAuditLog({
        userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "PharmacySecurity", entityId: "default",
        oldValues: { adminPinConfigured: Boolean(existing) }, newValues: { adminPinConfigured: true }, req,
      }, tx);
    });
    return { adminPinConfigured: true };
  },

  async uploadPharmacyLogo(actor: AccessTokenPayload, file: Express.Multer.File | undefined, req?: Request) {
    if (!file) throw new BadRequestError("A logo image is required.");
    const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg" };
    if (file.size > 2 * 1024 * 1024 || !extensions[file.mimetype]) {
      throw new BadRequestError("Pharmacy logo must be a PNG, JPEG, or SVG file no larger than 2 MB.");
    }
    const relativePath = path.join("pharmacy-profile", `${randomUUID()}${extensions[file.mimetype]}`);
    const absolutePath = path.join(path.resolve(env.UPLOAD_DIR), relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
    await writeFile(absolutePath, file.buffer, { mode: 0o600, flag: "wx" });
    await chmod(absolutePath, 0o600);
    const logoUrl = `/api/v1/files/${relativePath.replace(/\\/g, "/")}`;
    const key = "pharmacyLogoUrl";
    const existing = await prisma.setting.findUnique({ where: { key } });
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key }, create: { key, value: logoUrl }, update: { value: logoUrl } });
      await writeAuditLog({
        userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "PharmacySetting", entityId: key,
        oldValues: { value: existing?.value ?? null }, newValues: { value: logoUrl }, req,
      }, tx);
    });
    return { logoUrl };
  },

  async listPharmacyLedgerAccounts(
    actor: AccessTokenPayload,
    params: PageParams & { search?: string; type?: "RECEIVABLE" | "PAYABLE"; patientId?: string },
    req?: Request
  ) {
    const where: Prisma.PharmacyLedgerAccountWhereInput = {
      ...(params.type ? { type: params.type } : {}),
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.search ? {
        OR: [
          { customerName: { contains: params.search, mode: "insensitive" } },
          { customerPhone: { contains: params.search, mode: "insensitive" } },
          { patient: { is: { mrNumber: { contains: params.search, mode: "insensitive" } } } },
          { patient: { is: { firstName: { contains: params.search, mode: "insensitive" } } } },
          { patient: { is: { lastName: { contains: params.search, mode: "insensitive" } } } },
          { patient: { is: { phone: { contains: params.search, mode: "insensitive" } } } },
        ],
      } : {}),
    };
    const [accounts, total, balances, allAccountTypes] = await Promise.all([
      prisma.pharmacyLedgerAccount.findMany({
        where,
        include: {
          patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true, phone: true } },
          entries: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: [{ updatedAt: "desc" }, { customerName: "asc" }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.pharmacyLedgerAccount.count({ where }),
      prisma.pharmacyLedgerEntry.groupBy({ by: ["accountId"], _sum: { amount: true } }),
      prisma.pharmacyLedgerAccount.findMany({ select: { id: true, type: true } }),
    ]);
    const balanceByAccount = new Map(balances.map((entry) => [entry.accountId, Number(entry._sum.amount ?? 0)]));
    const typeByAccount = new Map(allAccountTypes.map((account) => [account.id, account.type]));
    const summary = balances.reduce((totals, entry) => {
      const type = typeByAccount.get(entry.accountId);
      if (type === "RECEIVABLE") totals.receivable += Number(entry._sum.amount ?? 0);
      if (type === "PAYABLE") totals.payable += Number(entry._sum.amount ?? 0);
      return totals;
    }, { receivable: 0, payable: 0 });
    const result = {
      items: accounts.map(({ entries, ...account }) => ({
        ...account,
        balance: roundPkr(balanceByAccount.get(account.id) ?? 0),
        lastActivity: entries[0] ?? null,
      })),
      pagination: reportPage(params.page, params.limit, total),
      summary: { receivable: roundPkr(summary.receivable), payable: roundPkr(summary.payable) },
    };
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "pharmacy", entityType: "PharmacyLedgerAccount", entityId: "list", newValues: { ...params }, req });
    return result;
  },

  async createPharmacyLedgerAccount(
    actor: AccessTokenPayload,
    input: { type: "RECEIVABLE" | "PAYABLE"; patientId?: string; customerName?: string; customerPhone?: string },
    req?: Request
  ) {
    if (input.patientId && input.type !== "RECEIVABLE") {
      throw new BadRequestError("Only customer receivable accounts can be linked to a patient.");
    }
    if (!input.patientId && !input.customerName?.trim()) {
      throw new BadRequestError("A customer or party name is required.");
    }
    const patient = input.patientId
      ? await prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, firstName: true, lastName: true, phone: true } })
      : null;
    if (input.patientId && !patient) throw new NotFoundError("Patient not found.");
    if (patient) {
      const existing = await prisma.pharmacyLedgerAccount.findUnique({ where: { patientId: patient.id } });
      if (existing) throw new ConflictError("This patient already has a pharmacy Khata account.");
    }
    const account = await prisma.pharmacyLedgerAccount.create({
      data: {
        type: input.type,
        patientId: patient?.id,
        customerName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : input.customerName!.trim(),
        customerPhone: input.customerPhone?.trim() || patient?.phone,
        createdBy: actor.sub,
      },
      include: { patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true, phone: true } } },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "PharmacyLedgerAccount", entityId: account.id, newValues: account, req });
    return { ...account, balance: 0, lastActivity: null };
  },

  async getPharmacyLedger(
    actor: AccessTokenPayload,
    accountId: string,
    params: PageParams,
    req?: Request
  ) {
    const account = await prisma.pharmacyLedgerAccount.findUnique({
      where: { id: accountId },
      include: { patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true, phone: true } } },
    });
    if (!account) throw new NotFoundError("Pharmacy Khata account not found.");
    const [entries, total, balance] = await Promise.all([
      prisma.pharmacyLedgerEntry.findMany({
        where: { accountId },
        include: { creator: { select: { id: true, name: true } }, invoice: { select: { id: true, invoiceNumber: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.pharmacyLedgerEntry.count({ where: { accountId } }),
      prisma.pharmacyLedgerEntry.aggregate({ where: { accountId }, _sum: { amount: true } }),
    ]);
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "pharmacy", entityType: "PharmacyLedgerAccount", entityId: accountId, req });
    return {
      account,
      balance: roundPkr(Number(balance._sum.amount ?? 0)),
      entries,
      pagination: reportPage(params.page, params.limit, total),
    };
  },

  async recordPharmacyLedgerPayment(
    actor: AccessTokenPayload,
    accountId: string,
    input: { amount: number; paymentMethod: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET"; notes?: string },
    req?: Request
  ) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.pharmacyLedgerAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundError("Pharmacy Khata account not found.");
      const current = await tx.pharmacyLedgerEntry.aggregate({ where: { accountId }, _sum: { amount: true } });
      const currentBalance = roundPkr(Number(current._sum.amount ?? 0));
      if (input.amount > currentBalance) throw new BadRequestError("Payment exceeds the outstanding balance.");

      if (account.type === "RECEIVABLE") {
        let amountToAllocate = input.amount;
        const creditEntries = await tx.pharmacyLedgerEntry.findMany({
          where: {
            accountId,
            type: "SALE_ON_CREDIT",
            invoiceId: { not: null },
            invoice: { status: { not: "VOID" }, balanceAmount: { gt: 0 } },
          },
          include: { invoice: true },
          orderBy: { createdAt: "asc" },
        });
        for (const creditEntry of creditEntries) {
          if (amountToAllocate <= 0 || !creditEntry.invoice) break;
          const applied = Math.min(amountToAllocate, Number(creditEntry.invoice.balanceAmount));
          const remaining = roundPkr(Number(creditEntry.invoice.balanceAmount) - applied);
          await tx.payment.create({
            data: { invoiceId: creditEntry.invoiceId!, paymentMethod: input.paymentMethod, amount: applied, createdBy: actor.sub, notes: input.notes ?? "Pharmacy Khata payment" },
          });
          await tx.invoice.update({
            where: { id: creditEntry.invoiceId! },
            data: {
              paidAmount: { increment: applied },
              balanceAmount: remaining,
              status: remaining === 0 ? "PAID" : "PARTIAL",
            },
          });
          amountToAllocate = roundPkr(amountToAllocate - applied);
        }
      }

      const entry = await appendPharmacyLedgerEntry(tx, {
        accountId,
        type: account.type === "RECEIVABLE" ? "PAYMENT_RECEIVED" : "PAYMENT_MADE",
        amount: -input.amount,
        paymentMethod: input.paymentMethod,
        notes: input.notes?.trim() || (account.type === "RECEIVABLE" ? "Customer payment received" : "Supplier payment made"),
        createdBy: actor.sub,
      });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "PharmacyLedgerEntry", entityId: entry.id, newValues: entry, req }, tx);
      return { entry, balance: roundPkr(currentBalance - input.amount) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async adjustPharmacyLedger(
    actor: AccessTokenPayload,
    accountId: string,
    input: { amount: number; notes: string },
    req?: Request
  ) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.pharmacyLedgerAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundError("Pharmacy Khata account not found.");
      const current = await tx.pharmacyLedgerEntry.aggregate({ where: { accountId }, _sum: { amount: true } });
      const balance = roundPkr(Number(current._sum.amount ?? 0));
      if (balance + input.amount < 0) throw new BadRequestError("Adjustment cannot reduce the ledger below zero.");
      const entry = await appendPharmacyLedgerEntry(tx, {
        accountId,
        type: "ADJUSTMENT",
        amount: input.amount,
        notes: input.notes.trim(),
        createdBy: actor.sub,
      });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "PharmacyLedgerEntry", entityId: entry.id, newValues: entry, req }, tx);
      return { entry, balance: roundPkr(balance + input.amount) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async pharmacyOverview(actor: AccessTokenPayload, req?: Request) {
    const today = pharmacyDateKey(new Date());
    const todayRange = pharmacyDateFilter(today, today)!;
    const todaySalesWhere: Prisma.PharmacySaleWhereInput = {
      createdAt: todayRange,
      invoice: { status: { not: "VOID" } },
    };
    const expiryStart = new Date(`${addPharmacyCalendarDays(today, 1)}T00:00:00.000+05:00`);
    const expiryEnd = new Date(`${addPharmacyCalendarDays(today, 31)}T00:00:00.000+05:00`);
    const lowStockWhere: Prisma.MedicineBatchWhereInput = {
      isActive: true,
      stockQuantity: { lte: prisma.medicineBatch.fields.reorderLevel },
    };
    const expiringWhere: Prisma.MedicineBatchWhereInput = {
      isActive: true,
      stockQuantity: { gt: 0 },
      expiryDate: { gte: expiryStart, lt: expiryEnd },
    };
    const expiredWhere: Prisma.MedicineBatchWhereInput = {
      isActive: true,
      stockQuantity: { gt: 0 },
      expiryDate: { lt: expiryStart },
    };
    const [
      sales,
      returns,
      lowStockCount,
      lowStockItems,
      expiringCount,
      expiredCount,
      inventoryValue,
      recentSales,
    ] = await Promise.all([
      prisma.pharmacySale.aggregate({ where: todaySalesWhere, _sum: { totalAmount: true } }),
      prisma.pharmacySaleAdjustment.aggregate({
        where: { type: "RETURN", createdAt: todayRange, sale: { createdAt: todayRange }, invoice: { status: { not: "VOID" } } },
        _sum: { refundAmount: true },
      }),
      prisma.medicineBatch.count({ where: lowStockWhere }),
      prisma.medicineBatch.findMany({
        where: lowStockWhere,
        take: 5,
        orderBy: [{ stockQuantity: "asc" }, { expiryDate: "asc" }],
        include: { medicine: { select: { id: true, name: true, genericName: true } } },
      }),
      prisma.medicineBatch.count({ where: expiringWhere }),
      prisma.medicineBatch.count({ where: expiredWhere }),
      prisma.medicineBatch.aggregate({
        where: { isActive: true, stockQuantity: { gt: 0 }, expiryDate: { gte: expiryStart } },
        _sum: {
          stockQuantity: true,
        },
      }),
      prisma.pharmacySale.findMany({
        where: { invoice: { status: { not: "VOID" } } },
        take: 5,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          createdAt: true,
          paymentMethod: true,
          totalAmount: true,
          items: { select: { medicineId: true } },
          invoice: { select: { id: true, invoiceNumber: true, status: true } },
        },
      }),
    ]);
    const [costValue, sellingValue] = await Promise.all([
      prisma.$queryRaw<Array<{ value: Prisma.Decimal }>>(Prisma.sql`
        SELECT COALESCE(SUM(stock_quantity * purchase_price), 0)::numeric AS value
        FROM medicine_batches
        WHERE is_active = TRUE AND stock_quantity > 0 AND expiry_date >= ${expiryStart}
      `),
      prisma.$queryRaw<Array<{ value: Prisma.Decimal }>>(Prisma.sql`
        SELECT COALESCE(SUM(stock_quantity * selling_price), 0)::numeric AS value
        FROM medicine_batches
        WHERE is_active = TRUE AND stock_quantity > 0 AND expiry_date >= ${expiryStart}
      `),
    ]);
    const result = {
      today: {
        date: today,
        sales: Number(sales._sum.totalAmount ?? 0) - Number(returns._sum.refundAmount ?? 0),
        transactions: await prisma.pharmacySale.count({ where: todaySalesWhere }),
      },
      lowStock: {
        count: lowStockCount,
        items: lowStockItems.map((batch) => ({
          medicineId: batch.medicine.id,
          medicineName: batch.medicine.name,
          genericName: batch.medicine.genericName,
          batchNumber: batch.batchNumber,
          stockQuantity: batch.stockQuantity,
          reorderLevel: batch.reorderLevel,
        })),
      },
      expiring: { count: expiringCount },
      expired: { count: expiredCount },
      inventoryValue: {
        cost: Number(costValue[0]?.value ?? 0),
        selling: Number(sellingValue[0]?.value ?? 0),
        units: Number(inventoryValue._sum.stockQuantity ?? 0),
      },
      recentSales: recentSales.map((sale) => ({
        id: sale.id,
        invoiceId: sale.invoice.id,
        invoiceNumber: sale.invoice.invoiceNumber,
        createdAt: sale.createdAt,
        itemCount: new Set(sale.items.map((item) => item.medicineId)).size,
        paymentMethod: sale.paymentMethod,
        amount: Number(sale.totalAmount),
      })),
    };
    await writeAuditLog({
      userId: actor.sub,
      action: "VIEW",
      module: "pharmacy",
      entityType: "PharmacyOverview",
      req,
    });
    return result;
  },

  async listMedicines(params: PageParams & { search?: string; lowStock?: string; nearExpiry?: string; categoryId?: string }) {
    const where: Prisma.MedicineWhereInput = {
      isActive: true,
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.search ? {
        OR: [
          { name: { contains: params.search, mode: "insensitive" } },
          { genericName: { contains: params.search, mode: "insensitive" } },
          { barcode: { contains: params.search, mode: "insensitive" } },
          { strength: { contains: params.search, mode: "insensitive" } },
          { form: { contains: params.search, mode: "insensitive" } },
        ],
      } : {}),
    };

    const medicines = await prisma.medicine.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      include: { category: true, batches: { where: { isActive: true }, orderBy: [{ expiryDate: "asc" }, { id: "asc" }], include: { supplier: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const total = await prisma.medicine.count({ where });

    let items = medicines;
    if (params.lowStock === "true") {
      items = items.filter((m) => m.batches.some((b) => b.stockQuantity <= b.reorderLevel));
    }
    if (params.nearExpiry === "true") {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() + NEAR_EXPIRY_DAYS);
      items = items.filter((m) => m.batches.some((b) => b.expiryDate <= threshold));
    }

    return { items, total };
  },

  async createMedicine(
    actor: AccessTokenPayload,
    input: {
      name: string;
      genericName?: string;
      barcode?: string | null;
      strength?: string;
      form?: string;
      unitType?: "TABLET" | "CAPSULE" | "SYRUP" | "INJECTION" | "STRIP";
      manufacturer?: string;
      categoryId?: string;
      initialBatch?: { batchNumber: string; expiryDate: string; purchasePrice: number; sellingPrice: number; stockQuantity: number; reorderLevel?: number };
    },
    req?: Request
  ) {
    const { initialBatch, ...medicineInput } = input;
    if (initialBatch && new Date(initialBatch.expiryDate) < new Date(`${pharmacyDateKey(new Date())}T00:00:00.000Z`)) {
      throw new BadRequestError("Cannot create a batch that is already expired.");
    }
    const created = await prisma.$transaction(async (tx) => {
      const medicine = await tx.medicine.create({ data: medicineInput });
      const batch = initialBatch
        ? await tx.medicineBatch.create({
            data: {
              medicineId: medicine.id,
              batchNumber: initialBatch.batchNumber,
              expiryDate: new Date(initialBatch.expiryDate),
              purchasePrice: initialBatch.purchasePrice,
              sellingPrice: initialBatch.sellingPrice,
              stockQuantity: initialBatch.stockQuantity,
              reorderLevel: initialBatch.reorderLevel ?? Number((await tx.setting.findUnique({ where: { key: "pharmacyDefaultLowStockLevel" } }))?.value ?? 10),
            },
          })
        : null;
      if (batch && initialBatch && initialBatch.stockQuantity > 0) {
        await tx.stockMovement.create({
          data: { batchId: batch.id, movementType: "IN", quantity: initialBatch.stockQuantity, referenceType: "batch_created", createdBy: actor.sub },
        });
      }
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "Medicine", entityId: medicine.id, newValues: medicine, req }, tx);
      if (batch) {
        await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "MedicineBatch", entityId: batch.id, newValues: batch, req }, tx);
      }
      return { medicine, batch };
    });
    if (created.batch) await this.checkLowStockAlert(created.batch.id);
    return { ...created.medicine, batches: created.batch ? [created.batch] : [] };
  },

  async updateMedicine(actor: AccessTokenPayload, id: string, input: { name: string; genericName?: string; barcode?: string | null; strength?: string; form?: string; unitType?: "TABLET" | "CAPSULE" | "SYRUP" | "INJECTION" | "STRIP"; manufacturer?: string; categoryId?: string }, req?: Request) {
    const medicine = await prisma.medicine.update({ where: { id }, data: input }).catch((error: unknown) => { if ((error as { code?: string }).code === "P2025") throw new NotFoundError("Medicine not found"); throw error; });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "Medicine", entityId: medicine.id, newValues: medicine, req });
    return medicine;
  },

  async archiveMedicine(actor: AccessTokenPayload, id: string, req?: Request) {
    return prisma.$transaction(async (tx) => {
      const medicine = await tx.medicine.findUnique({
        where: { id },
        include: { batches: { select: { id: true } } },
      });
      if (!medicine || !medicine.isActive) throw new NotFoundError("Active medicine not found");
      const movementCount = await tx.stockMovement.count({ where: { batchId: { in: medicine.batches.map((batch) => batch.id) } } });
      if (movementCount > 0) throw new ConflictError("Medicine cannot be archived because stock movement history exists.");
      const archived = await tx.medicine.update({ where: { id }, data: { isActive: false } });
      await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "Medicine", entityId: id, newValues: { isActive: false }, req }, tx);
      return archived;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async addBatch(
    actor: AccessTokenPayload,
    input: { medicineId: string; batchNumber: string; expiryDate: string; purchasePrice: number; sellingPrice: number; stockQuantity: number; reorderLevel?: number; supplierId?: string },
    req?: Request
  ) {
    const medicine = await prisma.medicine.findUnique({ where: { id: input.medicineId, isActive: true } });
    if (!medicine) throw new NotFoundError("Medicine not found");
    if (new Date(input.expiryDate) < new Date(`${pharmacyDateKey(new Date())}T00:00:00.000Z`)) {
      throw new BadRequestError("Cannot create a batch that is already expired.");
    }

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.medicineBatch.create({
        data: {
          medicineId: input.medicineId,
          batchNumber: input.batchNumber,
          expiryDate: new Date(input.expiryDate),
          purchasePrice: input.purchasePrice,
          sellingPrice: input.sellingPrice,
          stockQuantity: input.stockQuantity,
          reorderLevel: input.reorderLevel ?? Number((await tx.setting.findUnique({ where: { key: "pharmacyDefaultLowStockLevel" } }))?.value ?? 10),
          supplierId: input.supplierId,
        },
      });
      await tx.stockMovement.create({
        data: { batchId: created.id, movementType: "IN", quantity: input.stockQuantity, referenceType: "batch_created", createdBy: actor.sub },
      });
      return created;
    });

    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "MedicineBatch", entityId: batch.id, newValues: batch, req });
    return batch;
  },

  async stockIn(
    actor: AccessTokenPayload,
    input:
      | { batchId: string; quantity: number; purchasePrice?: number; sellingPrice?: number; supplierName?: string; invoiceReference?: string }
      | { medicineId: string; batchNumber: string; expiryDate: string; quantity: number; purchasePrice: number; sellingPrice: number; reorderLevel?: number; supplierName?: string; invoiceReference?: string },
    req?: Request
  ) {
    const updated = await prisma.$transaction(async (tx) => {
      const expiryCutoff = new Date(`${pharmacyDateKey(new Date())}T00:00:00.000Z`);
      let batch: { id: string; medicineId: string; batchNumber: string; expiryDate: Date; purchasePrice: Prisma.Decimal; sellingPrice: Prisma.Decimal; stockQuantity: number; reorderLevel: number; supplierId: string | null; isActive: boolean; createdAt: Date; updatedAt: Date };
      if ("batchId" in input) {
        const existing = await tx.medicineBatch.findUnique({ where: { id: input.batchId } });
        if (!existing || !existing.isActive) throw new NotFoundError("Active batch not found");
        if (existing.expiryDate < expiryCutoff) throw new BadRequestError("Cannot receive stock into an expired batch.");
        let supplierId: string | undefined;
        if (input.supplierName?.trim()) {
          const supplier = await tx.supplier.findFirst({
            where: { name: { equals: input.supplierName.trim(), mode: "insensitive" } },
            select: { id: true },
          }) ?? await tx.supplier.create({ data: { name: input.supplierName.trim() }, select: { id: true } });
          supplierId = supplier.id;
        }
        batch = await tx.medicineBatch.update({
          where: { id: input.batchId },
          data: {
            stockQuantity: { increment: input.quantity },
            ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice } : {}),
            ...(input.sellingPrice !== undefined ? { sellingPrice: input.sellingPrice } : {}),
            ...(supplierId ? { supplierId } : {}),
          },
        });
      } else {
        const medicine = await tx.medicine.findUnique({ where: { id: input.medicineId, isActive: true }, select: { id: true } });
        if (!medicine) throw new NotFoundError("Active medicine not found");
        if (new Date(input.expiryDate) < expiryCutoff) throw new BadRequestError("Cannot receive stock into an expired batch.");
        let supplierId: string | undefined;
        if (input.supplierName?.trim()) {
          const supplier = await tx.supplier.findFirst({
            where: { name: { equals: input.supplierName.trim(), mode: "insensitive" } },
            select: { id: true },
          }) ?? await tx.supplier.create({ data: { name: input.supplierName.trim() }, select: { id: true } });
          supplierId = supplier.id;
        }
        const existing = await tx.medicineBatch.findFirst({
          where: { medicineId: input.medicineId, batchNumber: input.batchNumber, isActive: true },
          orderBy: { id: "asc" },
        });
        if (existing && existing.expiryDate.getTime() !== new Date(input.expiryDate).getTime()) {
          throw new ConflictError("The batch number already exists with a different expiry date.");
        }
        batch = existing
          ? await tx.medicineBatch.update({
              where: { id: existing.id },
              data: {
                stockQuantity: { increment: input.quantity },
                purchasePrice: input.purchasePrice,
                sellingPrice: input.sellingPrice,
                reorderLevel: input.reorderLevel ?? existing.reorderLevel,
                ...(supplierId ? { supplierId } : {}),
              },
            })
          : await tx.medicineBatch.create({
              data: {
                medicineId: input.medicineId,
                batchNumber: input.batchNumber,
                expiryDate: new Date(input.expiryDate),
                purchasePrice: input.purchasePrice,
                sellingPrice: input.sellingPrice,
                stockQuantity: input.quantity,
                reorderLevel: input.reorderLevel ?? Number((await tx.setting.findUnique({ where: { key: "pharmacyDefaultLowStockLevel" } }))?.value ?? 10),
                supplierId,
              },
            });
      }
      await tx.stockMovement.create({
        data: {
          batchId: batch.id,
          movementType: "IN",
          quantity: input.quantity,
          referenceType: "stock_in",
          invoiceReference: input.invoiceReference?.trim() || null,
          createdBy: actor.sub,
        },
      });
      return batch;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "MedicineBatch", entityId: updated.id, newValues: { stockIn: input.quantity, invoiceReference: input.invoiceReference }, req });
    await this.checkLowStockAlert(updated.id);
    return updated;
  },

  /**
   * Dispense against a SIGNED prescription item using FEFO (first-expiry-first-out)
   * batch selection. Refuses to dispense from expired batches. Runs in a transaction
   * so the stock decrement and stock-movement write succeed or fail together.
   */
  async dispense(actor: AccessTokenPayload, input: { prescriptionItemId: string; quantity: number }, req?: Request) {
    const item = await prisma.prescriptionItem.findUnique({
      where: { id: input.prescriptionItemId },
      include: { prescription: { include: { items: true } } },
    });
    if (!item) throw new NotFoundError("Prescription item not found");
    if (item.prescription.status !== "SIGNED") {
      throw new ConflictError("Cannot dispense — prescription is not SIGNED");
    }
    if (!item.isCatalogItem || !item.medicineId) {
      throw new BadRequestError("This prescription item is not linked to a catalog medicine and cannot be auto-dispensed");
    }
    const catalogItems = item.prescription.items.filter((prescriptionItem) => prescriptionItem.isCatalogItem && prescriptionItem.medicineId);
    if (catalogItems.length !== 1 || catalogItems[0].id !== item.id) {
      throw new BadRequestError("Prescriptions with multiple catalog medicines must be dispensed from the prescription-level workflow.");
    }

    const result = await this.dispensePrescription(actor, item.prescriptionId, {
      items: [{ prescriptionItemId: item.id, quantity: input.quantity }],
    }, req);
    for (const saleItem of result.sale.items) await this.checkLowStockAlert(saleItem.batchId);
    const updatedItem = await prisma.prescriptionItem.findUniqueOrThrow({ where: { id: item.id } });
    return { ...updatedItem, invoice: result.sale.invoice };
  },

  async dispensePrescription(
    actor: AccessTokenPayload,
    prescriptionId: string,
    input: { items: { prescriptionItemId: string; quantity: number }[] },
    req?: Request
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        const prescription = await tx.prescription.findFirst({
          where: { id: prescriptionId, deletedAt: null },
          include: {
            items: true,
            patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          },
        });
        if (!prescription) throw new NotFoundError("Prescription not found");
        if (prescription.status !== "SIGNED") throw new ConflictError("Only a SIGNED prescription can be dispensed.");
        if (prescription.items.some((item) => item.quantityDispensed > 0)) {
          throw new ConflictError("This prescription has already had items dispensed and cannot be dispensed again.");
        }

        const catalogItems = prescription.items.filter((item) => item.isCatalogItem && item.medicineId);
        if (catalogItems.length === 0) {
          throw new BadRequestError("This prescription has no catalog medicines available for automatic dispensing.");
        }
        const requested = new Map(input.items.map((item) => [item.prescriptionItemId, item.quantity]));
        if (requested.size !== catalogItems.length || catalogItems.some((item) => !requested.has(item.id))) {
          throw new BadRequestError("Specify a quantity for every catalog medicine on this prescription.");
        }

        const statusChanged = await tx.prescription.updateMany({
          where: { id: prescription.id, status: "SIGNED", deletedAt: null },
          data: { status: "DISPENSED" },
        });
        if (statusChanged.count !== 1) throw new ConflictError("This prescription has already been dispensed.");

        const saleId = randomUUID();
        const allocated: Array<{
          medicineId: string;
          batchId: string;
          quantity: number;
          unitPrice: number;
          discount: number;
          subtotal: number;
          description: string;
        }> = [];
        for (const item of catalogItems) {
          const quantity = requested.get(item.id)!;
          const movements = await deductStockFefo(tx, item.medicineId!, quantity, "pharmacy_sale", saleId, actor.sub);
          const updatedItem = await tx.prescriptionItem.update({ where: { id: item.id }, data: { quantityDispensed: { increment: quantity } } });
          await writeAuditLog({
            userId: actor.sub,
            action: "DISPENSE",
            module: "pharmacy",
            entityType: "PrescriptionItem",
            entityId: item.id,
            newValues: { quantity: updatedItem.quantityDispensed, movements },
            req,
          }, tx);
          for (const movement of movements) {
            allocated.push({
              medicineId: item.medicineId!,
              batchId: movement.batchId,
              quantity: movement.qty,
              unitPrice: movement.unitPrice,
              discount: 0,
              subtotal: roundPkr(movement.qty * movement.unitPrice),
              description: `${item.medicineName} / batch ${movement.batchNumber}`,
            });
          }
        }

        const subtotal = roundPkr(allocated.reduce((sum, item) => sum + item.subtotal, 0));
        const invoiceNumber = await generateInvoiceNumber(tx);
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            patientId: prescription.patientId,
            createdBy: actor.sub,
            status: "PAID",
            subtotal,
            grandTotal: subtotal,
            paidAmount: subtotal,
            balanceAmount: 0,
            items: {
              create: allocated.map((item) => ({
                itemType: "MEDICINE",
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discount: 0,
                subtotal: item.subtotal,
              })),
            },
          },
        });
        const sale = await tx.pharmacySale.create({
          data: {
            id: saleId,
            invoiceId: invoice.id,
            cashierId: actor.sub,
            customerName: `${prescription.patient.firstName} ${prescription.patient.lastName}`.trim(),
            customerPhone: prescription.patient.phone,
            paymentMethod: "CASH",
            subtotal,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: subtotal,
            items: {
              create: allocated.map(({ medicineId, batchId, quantity, unitPrice, discount, subtotal: lineSubtotal }) => ({
                medicineId, batchId, quantity, unitPrice, discount, subtotal: lineSubtotal,
              })),
            },
          },
          include: {
            invoice: { include: { items: true, payments: true } },
            cashier: { select: { id: true, name: true } },
            items: { include: { medicine: true, batch: true } },
          },
        });
        if (subtotal > 0) {
          await tx.payment.create({
            data: {
              invoiceId: invoice.id,
              paymentMethod: "CASH",
              amount: subtotal,
              createdBy: actor.sub,
              notes: `Cash payment for prescription ${prescription.id}`,
            },
          });
        }
        await writeAuditLog({
          userId: actor.sub,
          action: "DISPENSE",
          module: "pharmacy",
          entityType: "Prescription",
          entityId: prescription.id,
          oldValues: { status: "SIGNED" },
          newValues: { status: "DISPENSED", invoiceId: invoice.id, invoiceNumber },
          req,
        }, tx);
        await writeAuditLog({
          userId: actor.sub,
          action: "CREATE",
          module: "pharmacy",
          entityType: "PharmacySale",
          entityId: sale.id,
          newValues: sale,
          req,
        }, tx);
        return {
          prescription: { id: prescription.id, status: "DISPENSED" as const },
          sale,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictError("This prescription was changed by another request. Refresh and try again.");
      }
      throw error;
    }
  },

  async createSale(
    actor: AccessTokenPayload,
    input: { items: { medicineId: string; quantity: number; unitPrice?: number; discount: number }[]; tax: number; paymentMethod: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET" | "CREDIT"; paidNow?: number; paidNowMethod?: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET"; patientId?: string; customerName?: string; customerPhone?: string; discountReason?: string },
    req?: Request
  ) {
    const idempotencyKey = req?.get("Idempotency-Key");
    if (idempotencyKey) {
      const previous = await prisma.pharmacySale.findUnique({ where: { idempotencyKey }, include: { invoice: { include: { items: true, payments: true } }, cashier: { select: { id: true, name: true } }, items: { include: { medicine: true, batch: true } } } });
      if (previous) return previous;
    }

    const sale = await prisma.$transaction(async (tx) => {
      const patient = input.patientId
        ? await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true, firstName: true, lastName: true, phone: true } })
        : null;
      if (input.patientId && !patient) throw new NotFoundError("Patient not found");
      const grouped = new Map<string, { medicineId: string; quantity: number; discount: number }>();
      for (const item of input.items) {
        const existing = grouped.get(item.medicineId);
        if (existing) { existing.quantity += item.quantity; existing.discount += item.discount; }
        else grouped.set(item.medicineId, { medicineId: item.medicineId, quantity: item.quantity, discount: item.discount });
      }
      const saleId = crypto.randomUUID();
      const allocated: { medicineId: string; batchId: string; quantity: number; unitPrice: number; costPrice: number; discount: number; subtotal: number }[] = [];
      let requestedDiscountAmount = 0;
      for (const item of grouped.values()) {
        requestedDiscountAmount += item.discount;
        const medicine = await tx.medicine.findUnique({ where: { id: item.medicineId }, include: { batches: { where: { isActive: true }, orderBy: { expiryDate: "asc" } } } });
        if (!medicine || !medicine.isActive) throw new NotFoundError("Medicine not found");
        const movements = await deductStockFefo(tx, item.medicineId, item.quantity, "pharmacy_sale", saleId, actor.sub);
        for (const movement of movements) {
          allocated.push({ medicineId: item.medicineId, batchId: movement.batchId, quantity: movement.qty, unitPrice: movement.unitPrice, costPrice: movement.costPrice, discount: 0, subtotal: 0 });
        }
      }
      const subtotal = Math.round(allocated.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100;
      const discountAmount = Math.round(requestedDiscountAmount * 100) / 100;
      if (discountAmount > subtotal) throw new BadRequestError("Discount cannot exceed the medicine subtotal.");
      const discountPercent = subtotal > 0 ? discountAmount / subtotal * 100 : 0;
      const discountLimit = await getCashierDiscountLimit(tx);
      let approvingAdminId: string | null = actor.role === "ADMIN" && discountPercent > discountLimit ? actor.sub : null;
      if (discountPercent > discountLimit) {
        if (!input.discountReason?.trim()) throw new BadRequestError("A reason is required for discounts above the cashier limit.");
        if (!approvingAdminId) approvingAdminId = await getApprovingAdminId(req?.get("X-Discount-Approval-Token"), req?.get("X-Discount-Approval-Pin"));
      }
      assertDiscountLimit(discountPercent, discountLimit, Boolean(approvingAdminId));
      let discountRemainder = discountAmount;
      for (let index = 0; index < allocated.length; index += 1) {
        const item = allocated[index];
        const gross = item.quantity * item.unitPrice;
        const discount = index === allocated.length - 1
          ? Math.round(discountRemainder * 100) / 100
          : Math.min(discountRemainder, Math.round(discountAmount * gross / subtotal * 100) / 100);
        item.discount = discount;
        item.subtotal = Math.round((gross - discount) * 100) / 100;
        discountRemainder -= discount;
      }
      const lossAlertThresholdSetting = await tx.setting.findUnique({ where: { key: "pharmacyLossAlertThreshold" } });
      const lossAlertThreshold = Number(lossAlertThresholdSetting?.value ?? pharmacySettingDefaults.lossAlertThreshold);
      if (!Number.isFinite(lossAlertThreshold) || lossAlertThreshold < 0) {
        throw new BadRequestError("The pharmacy loss alert threshold setting must be a non-negative PKR amount.");
      }
      const saleLoss = roundPkr(allocated.reduce((sum, item) => sum + item.quantity * item.costPrice - item.subtotal, 0));
      if (lossAlertThreshold > 0 && saleLoss >= lossAlertThreshold) {
        await notifyRoles(["ADMIN"], {
          notificationType: "PHARMACY_LOSS_ALERT",
          title: "Pharmacy sale below cost threshold",
          message: `Sale loss of PKR ${saleLoss.toFixed(2)} reached the configured alert threshold.`,
          relatedEntityType: "PharmacySale",
          relatedEntityId: saleId,
        }, tx);
      }
      const totalAmount = Math.round((subtotal - discountAmount + input.tax) * 100) / 100;
      const isCreditSale = input.paymentMethod === "CREDIT";
      if (isCreditSale && !patient && !input.customerName?.trim()) {
        throw new BadRequestError("A linked patient or named customer is required for a credit sale.");
      }
      const paidNow = isCreditSale ? roundPkr(input.paidNow ?? 0) : totalAmount;
      if (paidNow > totalAmount) throw new BadRequestError("Amount paid now cannot exceed the invoice total.");
      if (isCreditSale && paidNow >= totalAmount) {
        throw new BadRequestError("A credit sale must leave a positive balance; choose a regular payment method if paid in full.");
      }
      const balanceAmount = roundPkr(totalAmount - paidNow);
      const invoiceNumber = await generateInvoiceNumber(tx);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber, patientId: patient?.id ?? null, createdBy: actor.sub,
          status: balanceAmount === 0 ? "PAID" : paidNow === 0 ? "UNPAID" : "PARTIAL",
          subtotal, discountAmount, taxAmount: input.tax, grandTotal: totalAmount, paidAmount: paidNow, balanceAmount,
          items: { create: allocated.map((item) => ({ itemType: "MEDICINE", description: `${item.medicineId} / batch ${item.batchId}`, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, subtotal: item.subtotal })) },
        }, include: { items: true },
      });
      if (isCreditSale) {
        const normalizedName = (input.customerName ?? `${patient?.firstName ?? ""} ${patient?.lastName ?? ""}`).trim();
        let ledgerAccount = patient
          ? await tx.pharmacyLedgerAccount.findUnique({ where: { patientId: patient.id } })
          : null;
        if (!ledgerAccount) {
          ledgerAccount = await tx.pharmacyLedgerAccount.findFirst({
            where: {
              type: "RECEIVABLE",
              patientId: null,
              ...(input.customerPhone?.trim()
                ? { customerPhone: input.customerPhone.trim() }
                : { customerName: { equals: normalizedName, mode: "insensitive" } }),
            },
          });
        }
        if (!ledgerAccount) {
          ledgerAccount = await tx.pharmacyLedgerAccount.create({
            data: {
              type: "RECEIVABLE",
              patientId: patient?.id,
              customerName: normalizedName,
              customerPhone: input.customerPhone?.trim() || patient?.phone,
              createdBy: actor.sub,
            },
          });
        }
        await appendPharmacyLedgerEntry(tx, {
          accountId: ledgerAccount.id,
          type: "SALE_ON_CREDIT",
          amount: balanceAmount,
          invoiceId: invoice.id,
          notes: `Credit sale ${invoiceNumber}`,
          createdBy: actor.sub,
        });
      }
      const created = await tx.pharmacySale.create({
        data: {
          id: saleId,
          invoiceId: invoice.id,
          cashierId: actor.sub,
          customerName: input.customerName ?? (patient ? `${patient.firstName} ${patient.lastName}`.trim() : undefined),
          customerPhone: input.customerPhone ?? patient?.phone,
          paymentMethod: input.paymentMethod,
          subtotal,
          discountAmount,
          taxAmount: input.tax,
          totalAmount,
          idempotencyKey,
          items: { create: allocated.map(({ medicineId, batchId, quantity, unitPrice, discount, subtotal }) => ({ medicineId, batchId, quantity, unitPrice, discount, subtotal })) },
        },
        include: {
          invoice: { include: { items: true } },
          cashier: { select: { id: true, name: true } },
          items: { include: { medicine: true, batch: true } },
        },
      });
      if (paidNow > 0) {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            paymentMethod: isCreditSale ? input.paidNowMethod ?? "CASH" : input.paymentMethod,
            amount: paidNow,
            createdBy: actor.sub,
            notes: isCreditSale ? "Partial payment at pharmacy sale" : "Pharmacy sale",
          },
        });
      }
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "PharmacySale", entityId: created.id, newValues: created, req }, tx);
      if (discountAmount > 0) {
        const audit = await tx.discountAudit.create({
          data: {
            invoiceId: invoice.id,
            cashierId: actor.sub,
            approvingAdminId,
            discountPercent: Math.round(discountPercent * 10000) / 10000,
            discountAmount,
            reason: input.discountReason?.trim() || null,
          },
        });
        await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "DiscountAudit", entityId: audit.id, newValues: audit, req }, tx);
      }
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return sale;
  },

  async pharmacyReports(
    actor: AccessTokenPayload,
    params: {
      period: PharmacyReportPeriod;
      from?: string;
      to?: string;
      expiryDays: number;
      limit: number;
      categoriesPage: number;
      topMedicinesPage: number;
      lowStockPage: number;
      expiringPage: number;
      expiredPage: number;
      cashiersPage: number;
      paymentMethodsPage: number;
    },
    req?: Request
  ) {
    const range = getPharmacyReportRange(params.period, params.from, params.to);
    const createdAt = pharmacyDateFilter(range.from, range.to);
    const saleWhere: Prisma.PharmacySaleWhereInput = {
      ...(createdAt ? { createdAt } : {}),
      invoice: { status: { not: "VOID" } },
    };
    const currentDay = pharmacyDateKey(new Date());
    const expiryStart = new Date(`${currentDay}T00:00:00.000+05:00`);
    const expiryEnd = new Date(`${addPharmacyCalendarDays(currentDay, params.expiryDays + 1)}T00:00:00.000+05:00`);
    const lowStockSkip = (params.lowStockPage - 1) * params.limit;
    const expiringSkip = (params.expiringPage - 1) * params.limit;
    const expiredSkip = (params.expiredPage - 1) * params.limit;

    const [sales, transactionCount, returns, categoryRows, categoryCount, medicineRows, medicineCount,
      lowStockItems, lowStockCount, expiringItems, expiringCount, expiredItems, expiredCount,
      cashierRows, cashierCount, paymentRows, paymentCount, grossProfitRows, restockedCostRows] = await Promise.all([
      prisma.pharmacySale.aggregate({
        where: saleWhere,
        _sum: { totalAmount: true, discountAmount: true, taxAmount: true },
      }),
      prisma.pharmacySale.count({ where: saleWhere }),
      prisma.pharmacySaleAdjustment.aggregate({
        where: { type: "RETURN", ...(createdAt ? { createdAt } : {}), invoice: { status: { not: "VOID" } } },
        _sum: { refundAmount: true },
      }),
      prisma.$queryRaw<Array<{ name: string; quantity: number; revenue: Prisma.Decimal }>>(Prisma.sql`
        SELECT COALESCE(mc.name, 'Uncategorized') AS name,
               SUM(psi.quantity)::int AS quantity,
               SUM(psi.subtotal)::numeric AS revenue
        FROM pharmacy_sale_items psi
        JOIN pharmacy_sales ps ON ps.id = psi.sale_id
        JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
        JOIN medicines m ON m.id = psi.medicine_id
        LEFT JOIN medicine_categories mc ON mc.id = m.category_id
        WHERE TRUE ${reportSaleDateSql(createdAt)}
        GROUP BY COALESCE(mc.name, 'Uncategorized')
        ORDER BY SUM(psi.subtotal) DESC, name ASC
        LIMIT ${params.limit} OFFSET ${(params.categoriesPage - 1) * params.limit}
      `),
      prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total FROM (
          SELECT COALESCE(mc.name, 'Uncategorized')
          FROM pharmacy_sale_items psi
          JOIN pharmacy_sales ps ON ps.id = psi.sale_id
          JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
          JOIN medicines m ON m.id = psi.medicine_id
          LEFT JOIN medicine_categories mc ON mc.id = m.category_id
          WHERE TRUE ${reportSaleDateSql(createdAt)}
          GROUP BY COALESCE(mc.name, 'Uncategorized')
        ) grouped_categories
      `),
      prisma.$queryRaw<Array<{ id: string; name: string; genericName: string | null; quantity: number; revenue: Prisma.Decimal }>>(Prisma.sql`
        SELECT m.id, m.name, m.generic_name AS "genericName",
               SUM(psi.quantity)::int AS quantity,
               SUM(psi.subtotal)::numeric AS revenue
        FROM pharmacy_sale_items psi
        JOIN pharmacy_sales ps ON ps.id = psi.sale_id
        JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
        JOIN medicines m ON m.id = psi.medicine_id
        WHERE TRUE ${reportSaleDateSql(createdAt)}
        GROUP BY m.id, m.name, m.generic_name
        ORDER BY SUM(psi.quantity) DESC, m.name ASC
        LIMIT ${params.limit} OFFSET ${(params.topMedicinesPage - 1) * params.limit}
      `),
      prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total FROM (
          SELECT psi.medicine_id
          FROM pharmacy_sale_items psi
          JOIN pharmacy_sales ps ON ps.id = psi.sale_id
          JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
          WHERE TRUE ${reportSaleDateSql(createdAt)}
          GROUP BY psi.medicine_id
        ) grouped_medicines
      `),
      prisma.medicineBatch.findMany({
        where: { isActive: true, stockQuantity: { lte: prisma.medicineBatch.fields.reorderLevel } },
        skip: lowStockSkip, take: params.limit, orderBy: [{ stockQuantity: "asc" }, { expiryDate: "asc" }],
        include: { medicine: { select: { name: true, genericName: true } } },
      }),
      prisma.medicineBatch.count({ where: { isActive: true, stockQuantity: { lte: prisma.medicineBatch.fields.reorderLevel } } }),
      prisma.medicineBatch.findMany({
        where: { isActive: true, stockQuantity: { gt: 0 }, expiryDate: { gte: expiryStart, lt: expiryEnd } },
        skip: expiringSkip, take: params.limit, orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
        include: { medicine: { select: { name: true, genericName: true } } },
      }),
      prisma.medicineBatch.count({ where: { isActive: true, stockQuantity: { gt: 0 }, expiryDate: { gte: expiryStart, lt: expiryEnd } } }),
      prisma.medicineBatch.findMany({
        where: { isActive: true, stockQuantity: { gt: 0 }, expiryDate: { lt: expiryStart } },
        skip: expiredSkip, take: params.limit, orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
        include: { medicine: { select: { name: true, genericName: true } } },
      }),
      prisma.medicineBatch.count({ where: { isActive: true, stockQuantity: { gt: 0 }, expiryDate: { lt: expiryStart } } }),
      prisma.$queryRaw<Array<{ id: string; name: string; transactions: number; revenue: Prisma.Decimal }>>(Prisma.sql`
        SELECT u.id, u.name, COUNT(ps.id)::int AS transactions,
               SUM(ps.total_amount)::numeric AS revenue
        FROM pharmacy_sales ps
        JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
        JOIN users u ON u.id = ps.cashier_id
        WHERE TRUE ${reportSaleDateSql(createdAt)}
        GROUP BY u.id, u.name
        ORDER BY SUM(ps.total_amount) DESC, u.name ASC
        LIMIT ${params.limit} OFFSET ${(params.cashiersPage - 1) * params.limit}
      `),
      prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total FROM (
          SELECT ps.cashier_id
          FROM pharmacy_sales ps
          JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
          WHERE TRUE ${reportSaleDateSql(createdAt)}
          GROUP BY ps.cashier_id
        ) grouped_cashiers
      `),
      prisma.$queryRaw<Array<{ paymentMethod: string; transactions: number; revenue: Prisma.Decimal }>>(Prisma.sql`
        SELECT ps.payment_method::text AS "paymentMethod", COUNT(ps.id)::int AS transactions,
               SUM(ps.total_amount)::numeric AS revenue
        FROM pharmacy_sales ps
        JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
        WHERE TRUE ${reportSaleDateSql(createdAt)}
        GROUP BY ps.payment_method
        ORDER BY SUM(ps.total_amount) DESC, ps.payment_method::text ASC
        LIMIT ${params.limit} OFFSET ${(params.paymentMethodsPage - 1) * params.limit}
      `),
      prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total FROM (
          SELECT ps.payment_method
          FROM pharmacy_sales ps
          JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
          WHERE TRUE ${reportSaleDateSql(createdAt)}
          GROUP BY ps.payment_method
        ) grouped_methods
      `),
      prisma.$queryRaw<Array<{ grossProfit: Prisma.Decimal }>>(Prisma.sql`
        SELECT COALESCE(SUM(psi.subtotal - mb.purchase_price * psi.quantity), 0)::numeric AS "grossProfit"
        FROM pharmacy_sale_items psi
        JOIN pharmacy_sales ps ON ps.id = psi.sale_id
        JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
        JOIN medicine_batches mb ON mb.id = psi.batch_id
        WHERE TRUE ${reportSaleDateSql(createdAt)}
      `),
      prisma.$queryRaw<Array<{ restockedCost: Prisma.Decimal }>>(Prisma.sql`
        SELECT COALESCE(SUM(mb.purchase_price * psai.quantity), 0)::numeric AS "restockedCost"
        FROM pharmacy_sale_adjustment_items psai
        JOIN pharmacy_sale_adjustments psa ON psa.id = psai.adjustment_id AND psa.type = 'RETURN'
        JOIN pharmacy_sales ps ON ps.id = psa.sale_id
        JOIN invoices i ON i.id = ps.invoice_id AND i.status <> 'VOID'
        JOIN medicine_batches mb ON mb.id = psai.batch_id
        WHERE psai.returned_to_stock = TRUE ${createdAt?.gte ? Prisma.sql`AND psa.created_at >= ${createdAt.gte}` : Prisma.empty}
        ${createdAt?.lt ? Prisma.sql`AND psa.created_at < ${createdAt.lt}` : Prisma.empty}
      `),
    ]);

    const totalSalesRevenue = Number(sales._sum.totalAmount ?? 0);
    const discountsGiven = Number(sales._sum.discountAmount ?? 0);
    const taxesCollected = Number(sales._sum.taxAmount ?? 0);
    const returnsAmount = Number(returns._sum.refundAmount ?? 0);
    const inventoryPage = (items: typeof lowStockItems, total: number, page: number) => ({
      items: items.map((batch) => ({
        medicineName: batch.medicine.name,
        genericName: batch.medicine.genericName,
        batchNumber: batch.batchNumber,
        stockQuantity: batch.stockQuantity,
        reorderLevel: batch.reorderLevel,
        expiryDate: batch.expiryDate,
      })),
      pagination: reportPage(page, params.limit, total),
    });
    const result = {
      period: params.period,
      dateRange: range,
      summary: {
        totalSalesRevenue,
        transactions: transactionCount,
        discountsGiven,
        taxesCollected,
        returns: returnsAmount,
        netRevenue: totalSalesRevenue - returnsAmount,
        grossProfit: Number(grossProfitRows[0]?.grossProfit ?? 0) - returnsAmount + Number(restockedCostRows[0]?.restockedCost ?? 0),
      },
      categories: {
        items: categoryRows.map((row) => ({ name: row.name, quantity: Number(row.quantity), revenue: Number(row.revenue) })),
        pagination: reportPage(params.categoriesPage, params.limit, Number(categoryCount[0]?.total ?? 0)),
      },
      topMedicines: {
        items: medicineRows.map((row) => ({ ...row, quantity: Number(row.quantity), revenue: Number(row.revenue) })),
        pagination: reportPage(params.topMedicinesPage, params.limit, Number(medicineCount[0]?.total ?? 0)),
      },
      lowStock: inventoryPage(lowStockItems, lowStockCount, params.lowStockPage),
      expiringSoon: {
        ...inventoryPage(expiringItems, expiringCount, params.expiringPage),
        days: params.expiryDays,
      },
      expiredStock: inventoryPage(expiredItems, expiredCount, params.expiredPage),
      salesByCashier: {
        items: cashierRows.map((row) => ({ ...row, transactions: Number(row.transactions), revenue: Number(row.revenue) })),
        pagination: reportPage(params.cashiersPage, params.limit, Number(cashierCount[0]?.total ?? 0)),
      },
      salesByPaymentMethod: {
        items: paymentRows.map((row) => ({ ...row, transactions: Number(row.transactions), revenue: Number(row.revenue) })),
        pagination: reportPage(params.paymentMethodsPage, params.limit, Number(paymentCount[0]?.total ?? 0)),
      },
    };
    await writeAuditLog({
      userId: actor.sub,
      action: "VIEW",
      module: "pharmacy",
      entityType: "PharmacyReport",
      newValues: { ...params, dateRange: range },
      req,
    });
    return result;
  },

  async listPharmacyInvoices(
    actor: AccessTokenPayload,
    params: PageParams & { search?: string; from?: string; to?: string },
    req?: Request
  ) {
    const createdAt = pharmacyDateFilter(params.from, params.to);
    const where: Prisma.PharmacySaleWhereInput = {
      AND: [
        ...(createdAt ? [{ invoice: { createdAt } }] : []),
        ...(params.search ? [{
          OR: [
            { customerName: { contains: params.search, mode: "insensitive" as const } },
            { invoice: { invoiceNumber: { contains: params.search, mode: "insensitive" as const } } },
            { invoice: { patient: { is: { OR: [
              { firstName: { contains: params.search, mode: "insensitive" as const } },
              { lastName: { contains: params.search, mode: "insensitive" as const } },
              { mrNumber: { contains: params.search, mode: "insensitive" as const } },
              { phone: { contains: params.search, mode: "insensitive" as const } },
            ] } } } },
          ],
        }] : []),
      ],
    };
    const [items, total] = await Promise.all([
      prisma.pharmacySale.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { createdAt: "desc" },
        include: {
          cashier: { select: { id: true, name: true } },
          invoice: {
            include: {
              patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true, phone: true } },
              items: true,
              payments: { where: { deletedAt: null } },
            },
          },
          items: { include: { medicine: true, batch: true } },
        },
      }),
      prisma.pharmacySale.count({ where }),
    ]);
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "pharmacy", entityType: "PharmacyInvoiceList", newValues: { search: params.search, from: params.from, to: params.to, page: params.page, limit: params.limit }, req });
    return { items, total };
  },

  async getSaleInvoice(actor: AccessTokenPayload, id: string, req?: Request) {
    const sale = await prisma.pharmacySale.findUnique({ where: { id }, include: { cashier: { select: { id: true, name: true } }, invoice: { include: { items: true, payments: true } }, items: { include: { medicine: true, batch: true } } } });
    if (!sale) throw new NotFoundError("Pharmacy sale not found");
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "pharmacy", entityType: "PharmacySale", entityId: id, req });
    return sale.invoice;
  },

  async getPharmacyInvoice(actor: AccessTokenPayload, invoiceId: string, req?: Request) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
        items: true,
        payments: { where: { deletedAt: null } },
        pharmacySale: {
          include: {
            cashier: { select: { id: true, name: true } },
            items: { include: { medicine: true, batch: true } },
            adjustments: {
              include: { items: true, actor: { select: { id: true, name: true } } },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });
    if (!invoice?.pharmacySale) throw new NotFoundError("Pharmacy invoice not found");
    const movementActors = await prisma.stockMovement.findMany({
      where: {
        referenceType: "pharmacy_sale",
        referenceId: invoice.pharmacySale.id,
        movementType: "OUT",
      },
      distinct: ["createdBy"],
      select: { createdBy: true },
    });
    const dispensedByIds = [...new Set(movementActors.map((movement) => movement.createdBy))];
    const dispensedBy = await prisma.user.findMany({ where: { id: { in: dispensedByIds } }, select: { id: true, name: true } });
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "pharmacy", entityType: "Invoice", entityId: invoiceId, req });
    return { ...invoice, pharmacySale: { ...invoice.pharmacySale, dispensedBy } };
  },

  async voidSale(actor: AccessTokenPayload, invoiceId: string, reason: string, req?: Request) {
    reason = reason.trim();
    if (!reason) throw new BadRequestError("A reason is required to void a pharmacy sale.");
    try {
      return await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          include: { pharmacySale: { include: { items: true } }, payments: true },
        });
        if (!invoice?.pharmacySale) throw new NotFoundError("Pharmacy invoice not found");
        if (invoice.status === "VOID") throw new ConflictError("Pharmacy sale is already void");

        const changed = await tx.invoice.updateMany({
          where: { id: invoiceId, status: { not: "VOID" } },
          data: { status: "VOID", voidedAt: new Date(), voidReason: reason },
        });
        if (changed.count !== 1) throw new ConflictError("Pharmacy sale is already void");
        const creditEntry = await tx.pharmacyLedgerEntry.findFirst({
          where: { invoiceId, type: "SALE_ON_CREDIT" },
          select: { accountId: true },
        });
        if (creditEntry) {
          const outstanding = roundPkr(Number(invoice.balanceAmount));
          if (outstanding > 0) {
            await appendPharmacyLedgerEntry(tx, {
              accountId: creditEntry.accountId,
              type: "ADJUSTMENT",
              amount: -outstanding,
              invoiceId,
              notes: `Credit reversed by void: ${reason}`,
              createdBy: actor.sub,
            });
          }
          await tx.invoice.update({ where: { id: invoiceId }, data: { balanceAmount: 0 } });
        }

        await tx.payment.updateMany({
          where: { invoiceId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        const priorReturns = await tx.pharmacySaleAdjustment.aggregate({
          where: { saleId: invoice.pharmacySale.id, type: "RETURN" },
          _sum: { refundAmount: true },
        });
        const adjustment = await tx.pharmacySaleAdjustment.create({
          data: {
            saleId: invoice.pharmacySale.id,
            invoiceId,
            createdBy: actor.sub,
            type: "VOID",
            reason,
            voidKey: invoice.pharmacySale.id,
            refundAmount: Math.max(0, roundPkr(Number(invoice.grandTotal) - Number(priorReturns._sum.refundAmount ?? 0))),
          },
        });
        const quantitiesByBatch = new Map<string, number>();
        for (const item of invoice.pharmacySale.items) {
          const alreadyRestocked = await tx.pharmacySaleAdjustmentItem.aggregate({
            where: { saleItemId: item.id, returnedToStock: true, adjustment: { type: "RETURN" } },
            _sum: { quantity: true },
          });
          const quantity = Math.max(0, item.quantity - Number(alreadyRestocked._sum.quantity ?? 0));
          quantitiesByBatch.set(item.batchId, (quantitiesByBatch.get(item.batchId) ?? 0) + quantity);
        }
        for (const [batchId, quantity] of quantitiesByBatch) {
          if (quantity === 0) continue;
          await tx.medicineBatch.update({ where: { id: batchId }, data: { stockQuantity: { increment: quantity } } });
          await tx.stockMovement.create({
            data: {
              batchId,
              movementType: "VOID",
              quantity,
              referenceType: "pharmacy_sale_adjustment",
              referenceId: adjustment.id,
              reason,
              createdBy: actor.sub,
            },
          });
        }
        await writeAuditLog({ userId: actor.sub, action: "VOID", module: "pharmacy", entityType: "PharmacySale", entityId: invoice.pharmacySale.id, oldValues: { status: invoice.status }, newValues: { status: "VOID", reason, adjustmentId: adjustment.id }, req }, tx);
        await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "PharmacySaleAdjustment", entityId: adjustment.id, newValues: adjustment, req }, tx);
        return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Pharmacy sale is already void");
      }
      throw error;
    }
  },

  async returnSale(
    actor: AccessTokenPayload,
    invoiceId: string,
    input: { reason: string; items: { saleItemId: string; quantity: number; returnToStock: boolean }[] },
    req?: Request
  ) {
    input.reason = input.reason.trim();
    if (!input.reason) throw new BadRequestError("A reason is required to return pharmacy items.");
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { pharmacySale: { include: { items: { include: { batch: true, medicine: true } } } } },
      });
      if (!invoice?.pharmacySale) throw new NotFoundError("Pharmacy invoice not found");
      if (invoice.status === "VOID") throw new ConflictError("Cannot return items from a voided pharmacy sale.");
      const saleItems = new Map(invoice.pharmacySale.items.map((item) => [item.id, item]));
      const returnLines: { saleItemId: string; batchId: string; quantity: number; returnedToStock: boolean }[] = [];
      let refundAmount = 0;

      for (const requested of input.items) {
        const saleItem = saleItems.get(requested.saleItemId);
        if (!saleItem) throw new BadRequestError("A return item does not belong to this pharmacy invoice.");
        const alreadyReturned = await tx.pharmacySaleAdjustmentItem.aggregate({
          where: { saleItemId: saleItem.id, adjustment: { type: "RETURN" } },
          _sum: { quantity: true },
        });
        const remainingQuantity = saleItem.quantity - Number(alreadyReturned._sum.quantity ?? 0);
        if (requested.quantity > remainingQuantity) {
          throw new BadRequestError(`Return quantity exceeds the remaining sold quantity (${remainingQuantity}) for ${saleItem.medicine.name}.`);
        }
        if (requested.returnToStock && saleItem.batch.expiryDate <= new Date()) {
          throw new BadRequestError(`Expired batch ${saleItem.batch.batchNumber} cannot be returned to stock.`);
        }
        const itemRefund = roundPkr(
          Number(saleItem.unitPrice) * requested.quantity -
          Number(saleItem.discount) * requested.quantity / saleItem.quantity
        );
        refundAmount = roundPkr(refundAmount + itemRefund);
        returnLines.push({
          saleItemId: saleItem.id,
          batchId: saleItem.batchId,
          quantity: requested.quantity,
          returnedToStock: requested.returnToStock,
        });
      }

      const adjustment = await tx.pharmacySaleAdjustment.create({
        data: {
          saleId: invoice.pharmacySale.id,
          invoiceId,
          createdBy: actor.sub,
          type: "RETURN",
          reason: input.reason,
          refundAmount,
          items: { create: returnLines },
        },
        include: { items: true },
      });
      const creditEntry = await tx.pharmacyLedgerEntry.findFirst({
        where: { invoiceId, type: "SALE_ON_CREDIT" },
        select: { accountId: true },
      });
      if (creditEntry) {
        const creditReduction = Math.min(refundAmount, Number(invoice.balanceAmount));
        if (creditReduction > 0) {
          await appendPharmacyLedgerEntry(tx, {
            accountId: creditEntry.accountId,
            type: "ADJUSTMENT",
            amount: -roundPkr(creditReduction),
            invoiceId,
            notes: `Credit reduced for return: ${input.reason}`,
            createdBy: actor.sub,
          });
          await tx.invoice.update({
            where: { id: invoiceId },
            data: { balanceAmount: { decrement: roundPkr(creditReduction) } },
          });
        }
      }
      for (const line of returnLines) {
        if (line.returnedToStock) {
          await tx.medicineBatch.update({ where: { id: line.batchId }, data: { stockQuantity: { increment: line.quantity } } });
        }
        await tx.stockMovement.create({
          data: {
            batchId: line.batchId,
            movementType: "RETURN",
            quantity: line.quantity,
            referenceType: "pharmacy_sale_adjustment",
            referenceId: adjustment.id,
            reason: line.returnedToStock ? input.reason : `${input.reason} (not returned to stock)`,
            createdBy: actor.sub,
          },
        });
      }
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "PharmacySaleAdjustment", entityId: adjustment.id, newValues: adjustment, req }, tx);
      return adjustment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async listSaleAdjustments(
    actor: AccessTokenPayload,
    params: PageParams & { from?: string; to?: string; type?: "VOID" | "RETURN" },
    req?: Request
  ) {
    const createdAt = pharmacyDateFilter(params.from, params.to);
    const where: Prisma.PharmacySaleAdjustmentWhereInput = {
      ...(createdAt ? { createdAt } : {}),
      ...(params.type ? { type: params.type } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.pharmacySaleAdjustment.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { createdAt: "desc" },
        include: {
          invoice: { select: { id: true, invoiceNumber: true } },
          sale: { select: { customerName: true, customerPhone: true } },
          actor: { select: { id: true, name: true } },
          items: { include: { saleItem: { include: { medicine: { select: { name: true } } } } } },
        },
      }),
      prisma.pharmacySaleAdjustment.count({ where }),
    ]);
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "pharmacy", entityType: "PharmacySaleAdjustment", newValues: { from: params.from, to: params.to, type: params.type, page: params.page, limit: params.limit }, req });
    return { items, total };
  },

  async listDiscountAudits(
    actor: AccessTokenPayload,
    params: PageParams & { from?: string; to?: string; cashier?: string },
    req?: Request
  ) {
    const createdAt = params.from || params.to
      ? {
          ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000+05:00`) } : {}),
          ...(params.to ? { lt: new Date(new Date(`${params.to}T00:00:00.000+05:00`).getTime() + 86400000) } : {}),
        }
      : undefined;
    const where: Prisma.DiscountAuditWhereInput = {
      ...(createdAt ? { createdAt } : {}),
      ...(params.cashier ? { cashier: { name: { contains: params.cashier, mode: "insensitive" } } } : {}),
    };
    const [items, total, aggregate] = await Promise.all([
      prisma.discountAudit.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { createdAt: "desc" },
        include: {
          invoice: { select: { invoiceNumber: true } },
          cashier: { select: { id: true, name: true } },
          approvingAdmin: { select: { id: true, name: true } },
        },
      }),
      prisma.discountAudit.count({ where }),
      prisma.discountAudit.aggregate({ where, _sum: { discountAmount: true } }),
    ]);
    await writeAuditLog({ userId: actor.sub, action: "VIEW", module: "pharmacy", entityType: "DiscountAudit", newValues: { from: params.from, to: params.to, cashier: params.cashier, page: params.page, limit: params.limit }, req });
    return { items, total, totalDiscountAmount: Number(aggregate._sum.discountAmount ?? 0) };
  },

  async returnStock(actor: AccessTokenPayload, input: { batchId: string; quantity: number; reason: string }, req?: Request) {
    input.reason = input.reason.trim();
    if (!input.reason) throw new BadRequestError("A reason is required to return stock.");
    const batch = await prisma.medicineBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError("Batch not found");

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.medicineBatch.update({ where: { id: input.batchId }, data: { stockQuantity: { increment: input.quantity } } });
      await tx.stockMovement.create({
        data: { batchId: input.batchId, movementType: "RETURN", quantity: input.quantity, reason: input.reason, createdBy: actor.sub },
      });
      return b;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "MedicineBatch", entityId: input.batchId, newValues: { returned: input.quantity, reason: input.reason }, req });
    return updated;
  },

  async adjust(actor: AccessTokenPayload, input: { batchId: string; quantity: number; reason: string }, req?: Request) {
    input.reason = input.reason.trim();
    if (!input.reason) throw new BadRequestError("A reason is required for stock adjustments.");
    const batch = await prisma.medicineBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.stockQuantity + input.quantity < 0) throw new BadRequestError("Adjustment would result in negative stock");

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.medicineBatch.update({ where: { id: input.batchId }, data: { stockQuantity: { increment: input.quantity } } });
      await tx.stockMovement.create({
        data: { batchId: input.batchId, movementType: "ADJUSTMENT", quantity: input.quantity, reason: input.reason, createdBy: actor.sub },
      });
      return b;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "MedicineBatch", entityId: input.batchId, newValues: { adjustment: input.quantity, reason: input.reason }, req });
    return updated;
  },

  async markDamagedOrExpired(actor: AccessTokenPayload, input: { batchId: string; quantity: number; type: "DAMAGED" | "EXPIRED"; reason: string }, req?: Request) {
    input.reason = input.reason.trim();
    if (!input.reason) throw new BadRequestError("A reason is required for stock write-offs.");
    const batch = await prisma.medicineBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.stockQuantity < input.quantity) throw new BadRequestError("Quantity exceeds current stock");
    if (input.type === "EXPIRED" && batch.expiryDate >= new Date(`${pharmacyDateKey(new Date())}T00:00:00.000Z`)) {
      throw new BadRequestError("Only expired batches can be written off as expired.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.medicineBatch.update({ where: { id: input.batchId }, data: { stockQuantity: { decrement: input.quantity } } });
      await tx.stockMovement.create({
        data: { batchId: input.batchId, movementType: input.type, quantity: input.quantity, reason: input.reason, createdBy: actor.sub },
      });
      return b;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "MedicineBatch", entityId: input.batchId, newValues: { [input.type.toLowerCase()]: input.quantity, reason: input.reason }, req });
    return updated;
  },

  async checkLowStockAlert(batchId: string) {
    const batch = await prisma.medicineBatch.findUnique({ where: { id: batchId }, include: { medicine: true } });
    if (!batch) return;
    if (batch.stockQuantity <= batch.reorderLevel) {
      await notifyRoles(["PHARMACIST", "ADMIN"], {
        notificationType: "LOW_STOCK_MEDICINE",
        title: "Low stock alert",
        message: `${batch.medicine.name} (batch ${batch.batchNumber}) is at or below reorder level (${batch.stockQuantity}/${batch.reorderLevel})`,
        relatedEntityType: "MedicineBatch",
        relatedEntityId: batch.id,
      });
    }
  },

  async listStockMovements(params: PageParams & { batchId?: string; medicineId?: string }) {
    const where: Prisma.StockMovementWhereInput = {
      ...(params.batchId ? { batchId: params.batchId } : {}),
      ...(params.medicineId ? { batch: { medicineId: params.medicineId } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({ where, skip: params.skip, take: params.limit, orderBy: { createdAt: "desc" }, include: { batch: { include: { medicine: true } } } }),
      prisma.stockMovement.count({ where }),
    ]);
    const createdByIds = [...new Set(items.map((item) => item.createdBy))];
    const saleIds = [...new Set(items.filter((item) => item.referenceType === "pharmacy_sale" && item.referenceId).map((item) => item.referenceId!))];
    const adjustmentIds = [...new Set(items.filter((item) => item.referenceType === "pharmacy_sale_adjustment" && item.referenceId).map((item) => item.referenceId!))];
    const prescriptionItemIds = [...new Set(items.filter((item) => item.referenceType === "prescription_dispense" && item.referenceId).map((item) => item.referenceId!))];
    const [users, sales, adjustments, prescriptionItems] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: createdByIds } }, select: { id: true, name: true } }),
      prisma.pharmacySale.findMany({
        where: { id: { in: saleIds } },
        select: { id: true, invoice: { select: { invoiceNumber: true, patient: { select: { mrNumber: true, firstName: true, lastName: true } } } } },
      }),
      prisma.pharmacySaleAdjustment.findMany({
        where: { id: { in: adjustmentIds } },
        select: { id: true, invoice: { select: { invoiceNumber: true, patient: { select: { mrNumber: true, firstName: true, lastName: true } } } } },
      }),
      prisma.prescriptionItem.findMany({
        where: { id: { in: prescriptionItemIds } },
        select: { id: true, prescription: { select: { patient: { select: { mrNumber: true, firstName: true, lastName: true } } } } },
      }),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const salesById = new Map(sales.map((sale) => [sale.id, sale.invoice]));
    const adjustmentsById = new Map(adjustments.map((adjustment) => [adjustment.id, adjustment.invoice]));
    const prescriptionItemsById = new Map(prescriptionItems.map((item) => [item.id, item.prescription.patient]));
    return {
      items: items.map((item) => {
        const invoice = item.referenceType === "pharmacy_sale"
          ? salesById.get(item.referenceId ?? "")
          : item.referenceType === "pharmacy_sale_adjustment"
            ? adjustmentsById.get(item.referenceId ?? "")
            : undefined;
        const patient = invoice?.patient ?? (item.referenceType === "prescription_dispense"
          ? prescriptionItemsById.get(item.referenceId ?? "")
          : undefined);
        return {
          ...item,
          createdByUser: usersById.get(item.createdBy) ?? null,
          invoice: invoice ? { invoiceNumber: invoice.invoiceNumber } : null,
          patient: patient ? {
            name: `${patient.firstName} ${patient.lastName}`.trim(),
            mrNumber: patient.mrNumber,
          } : null,
        };
      }),
      total,
    };
  },
};
