import { LabLedgerAccountType, LabLedgerEntry as LabLedgerEntryModel, LabLedgerEntryType, PaymentMethod, Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@common/errors/AppError";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { writeAuditLog } from "@common/utils/auditLog";

const roundPkr = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function assertLabBillingRole(actor: AccessTokenPayload) {
  if (!["ADMIN", "BILLING_MANAGER"].includes(actor.role)) {
    throw new ForbiddenError("Only Admin and Billing Manager roles may access the Lab ledger.");
  }
}

export async function appendLabLedgerEntry(
  tx: Prisma.TransactionClient,
  input: {
    accountId: string;
    type: LabLedgerEntryType;
    amount: number;
    createdBy: string;
    invoiceId?: string;
    labOrderId?: string;
    paymentMethod?: PaymentMethod;
    notes?: string;
  },
) {
  if (input.invoiceId && input.type === "INVOICE_CHARGE") {
    const existing = await tx.labLedgerEntry.findFirst({ where: { invoiceId: input.invoiceId, type: "INVOICE_CHARGE" } });
    if (existing) return existing;
  }
  if (input.labOrderId && input.type === "SEND_OUT_CHARGE") {
    const existing = await tx.labLedgerEntry.findFirst({ where: { labOrderId: input.labOrderId, type: "SEND_OUT_CHARGE" } });
    if (existing) return existing;
  }
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "lab_ledger_accounts" WHERE "id" = ${input.accountId} FOR UPDATE
  `;
  const balance = await tx.labLedgerEntry.aggregate({
    where: { accountId: input.accountId },
    _sum: { amount: true },
  });
  const balanceAfter = roundPkr(Number(balance._sum.amount ?? 0) + input.amount);
  const entry = await tx.labLedgerEntry.create({
    data: {
      ...input,
      amount: roundPkr(input.amount),
      balanceAfter,
    },
  });
  await writeAuditLog({
    userId: input.createdBy,
    action: "CREATE",
    module: "lab",
    entityType: "LabLedgerEntry",
    entityId: entry.id,
    newValues: entry,
  }, tx);
  return entry;
}

export async function postLabInvoicePayment(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  amount: number,
  paymentMethod: PaymentMethod,
  createdBy: string,
) {
  const charge = await tx.labLedgerEntry.findFirst({
    where: { invoiceId, type: "INVOICE_CHARGE" },
    select: { accountId: true },
  });
  if (!charge) return null;
  return appendLabLedgerEntry(tx, {
    accountId: charge.accountId,
    type: "PAYMENT_RECEIVED",
    amount: -amount,
    invoiceId,
    paymentMethod,
    notes: "Lab invoice payment",
    createdBy,
  });
}

export const labLedgerService = {
  async listAccounts(
    actor: AccessTokenPayload,
    params: PageParams & { search?: string; type?: LabLedgerAccountType },
    _req?: Request,
  ) {
    assertLabBillingRole(actor);
    const where: Prisma.LabLedgerAccountWhereInput = {
      ...(params.type ? { type: params.type } : {}),
      ...(params.search ? {
        OR: [
          { partyName: { contains: params.search, mode: "insensitive" } },
          { partyPhone: { contains: params.search, mode: "insensitive" } },
          { patient: { is: { mrNumber: { contains: params.search, mode: "insensitive" } } } },
          { patient: { is: { firstName: { contains: params.search, mode: "insensitive" } } } },
          { patient: { is: { lastName: { contains: params.search, mode: "insensitive" } } } },
          { supplier: { is: { name: { contains: params.search, mode: "insensitive" } } } },
        ],
      } : {}),
    };
    const [accounts, total, groupedBalances, allAccounts] = await Promise.all([
      prisma.labLedgerAccount.findMany({
        where,
        include: {
          patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true, phone: true } },
          supplier: { select: { id: true, name: true, phone: true } },
          entries: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
        },
        orderBy: [{ updatedAt: "desc" }, { partyName: "asc" }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.labLedgerAccount.count({ where }),
      prisma.labLedgerEntry.groupBy({ by: ["accountId"], _sum: { amount: true } }),
      prisma.labLedgerAccount.findMany({ select: { id: true, type: true } }),
    ]);
    const balanceByAccount = new Map(groupedBalances.map((item) => [item.accountId, Number(item._sum.amount ?? 0)]));
    const typeByAccount = new Map(allAccounts.map((account) => [account.id, account.type]));
    const summary = groupedBalances.reduce((totalSummary, item) => {
      const type = typeByAccount.get(item.accountId);
      if (type === "RECEIVABLE") totalSummary.receivable += Number(item._sum.amount ?? 0);
      if (type === "PAYABLE") totalSummary.payable += Number(item._sum.amount ?? 0);
      return totalSummary;
    }, { receivable: 0, payable: 0 });
    return {
      items: accounts.map(({ entries, ...account }) => ({
        ...account,
        balance: roundPkr(balanceByAccount.get(account.id) ?? 0),
        lastActivity: entries[0] ?? null,
      })),
      pagination: { page: params.page, limit: params.limit, total, pages: Math.max(1, Math.ceil(total / params.limit)) },
      summary: { receivable: roundPkr(summary.receivable), payable: roundPkr(summary.payable) },
    };
  },

  async listReferringClinics() {
    return prisma.labLedgerAccount.findMany({
      where: { type: "RECEIVABLE", partyType: "CLINIC" },
      select: { id: true, partyName: true },
      orderBy: { partyName: "asc" },
    });
  },

  async listReferenceLabs() {
    return prisma.supplier.findMany({
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    });
  },

  async createAccount(
    actor: AccessTokenPayload,
    input: { partyType: "CLINIC" | "REFERENCE_LAB"; partyName: string; partyPhone?: string },
    req?: Request,
  ) {
    assertLabBillingRole(actor);
    const partyName = input.partyName.trim();
    if (input.partyType === "CLINIC") {
      const existing = await prisma.labLedgerAccount.findFirst({
        where: { partyType: "CLINIC", partyName: { equals: partyName, mode: "insensitive" } },
      });
      if (existing) throw new ConflictError("A Lab ledger account already exists for this clinic.");
      const account = await prisma.labLedgerAccount.create({
        data: {
          type: "RECEIVABLE",
          partyType: "CLINIC",
          partyName,
          partyPhone: input.partyPhone,
          createdBy: actor.sub,
        },
      });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabLedgerAccount", entityId: account.id, newValues: account, req });
      return account;
    }

    const supplier = await prisma.supplier.findFirst({
      where: { name: { equals: partyName, mode: "insensitive" } },
    }) ?? await prisma.supplier.create({
      data: { name: partyName, phone: input.partyPhone },
    });
    const existing = await prisma.labLedgerAccount.findUnique({ where: { supplierId: supplier.id } });
    if (existing) throw new ConflictError("A Lab ledger account already exists for this reference lab.");
    const account = await prisma.labLedgerAccount.create({
      data: {
        type: "PAYABLE",
        partyType: "REFERENCE_LAB",
        supplierId: supplier.id,
        partyName: supplier.name,
        partyPhone: input.partyPhone ?? supplier.phone,
        createdBy: actor.sub,
      },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabLedgerAccount", entityId: account.id, newValues: account, req });
    return account;
  },

  async getLedger(actor: AccessTokenPayload, accountId: string, params: PageParams, _req?: Request) {
    assertLabBillingRole(actor);
    const account = await prisma.labLedgerAccount.findUnique({
      where: { id: accountId },
      include: {
        patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true, phone: true } },
        supplier: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!account) throw new NotFoundError("Lab ledger account not found.");
    const [entries, total, balance] = await Promise.all([
      prisma.labLedgerEntry.findMany({
        where: { accountId },
        include: {
          invoice: { select: { id: true, invoiceNumber: true } },
          labOrder: { select: { id: true, orderNumber: true } },
          creator: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.labLedgerEntry.count({ where: { accountId } }),
      prisma.labLedgerEntry.aggregate({ where: { accountId }, _sum: { amount: true } }),
    ]);
    return {
      account: { ...account, balance: roundPkr(Number(balance._sum.amount ?? 0)) },
      balance: roundPkr(Number(balance._sum.amount ?? 0)),
      entries,
      pagination: { page: params.page, limit: params.limit, total, pages: Math.max(1, Math.ceil(total / params.limit)) },
    };
  },

  async recordPayment(
    actor: AccessTokenPayload,
    accountId: string,
    input: { amount: number; paymentMethod: PaymentMethod; notes?: string },
    _req?: Request,
  ) {
    assertLabBillingRole(actor);
    return prisma.$transaction(async (tx) => {
      const account = await tx.labLedgerAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundError("Lab ledger account not found.");
      const aggregate = await tx.labLedgerEntry.aggregate({ where: { accountId }, _sum: { amount: true } });
      const balance = roundPkr(Number(aggregate._sum.amount ?? 0));
      if (input.amount > balance) throw new BadRequestError("Payment exceeds the outstanding balance.");

      if (account.type === "RECEIVABLE") {
        let unapplied = input.amount;
        const entries: LabLedgerEntryModel[] = [];
        const invoiceCharges = await tx.labLedgerEntry.findMany({
          where: {
            accountId,
            type: "INVOICE_CHARGE",
            invoiceId: { not: null },
            invoice: { status: { not: "VOID" }, balanceAmount: { gt: 0 } },
          },
          include: { invoice: true },
          orderBy: { createdAt: "asc" },
        });
        for (const charge of invoiceCharges) {
          if (!charge.invoice || unapplied <= 0) break;
          const applied = Math.min(unapplied, Number(charge.invoice.balanceAmount));
          const remaining = roundPkr(Number(charge.invoice.balanceAmount) - applied);
          await tx.payment.create({
            data: {
              invoiceId: charge.invoiceId!,
              paymentMethod: input.paymentMethod,
              amount: applied,
              createdBy: actor.sub,
              notes: input.notes ?? "Lab ledger payment",
            },
          });
          await tx.invoice.update({
            where: { id: charge.invoiceId! },
            data: {
              paidAmount: { increment: applied },
              balanceAmount: remaining,
              status: remaining === 0 ? "PAID" : "PARTIAL",
            },
          });
          const entry = await appendLabLedgerEntry(tx, {
            accountId,
            type: "PAYMENT_RECEIVED",
            amount: -applied,
            invoiceId: charge.invoiceId!,
            paymentMethod: input.paymentMethod,
            notes: input.notes?.trim() || `Payment received for invoice ${charge.invoice.invoiceNumber}`,
            createdBy: actor.sub,
          });
          entries.push(entry);
          unapplied = roundPkr(unapplied - applied);
        }
        if (unapplied > 0) {
          throw new ConflictError("Some receivable balance is not linked to an open Lab invoice; payment was not recorded.");
        }
        const entry = entries[entries.length - 1];
        if (!entry) throw new ConflictError("No open Lab invoice was available for this receivable payment.");
        return { entry, entries, balance: roundPkr(balance - input.amount) };
      }

      const entry = await appendLabLedgerEntry(tx, {
        accountId,
        type: "PAYMENT_MADE",
        amount: -input.amount,
        paymentMethod: input.paymentMethod,
        notes: input.notes?.trim() || "Payment to reference lab",
        createdBy: actor.sub,
      });
      return { entry, entries: [entry], balance: roundPkr(balance - input.amount) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },
};
