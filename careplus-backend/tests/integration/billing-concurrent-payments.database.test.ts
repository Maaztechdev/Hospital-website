import { Role } from "@prisma/client";
import { prisma } from "@config/prisma";
import { billingService } from "@modules/billing/billing.service";

describe("billing concurrent payments", () => {
  let adminId: string;
  let invoiceId: string;
  let invoiceNumber: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/")[1]?.split("?")[0] !== "careplus_test") {
      throw new Error("Billing integration tests require the careplus_test database.");
    }

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    adminId = admin.id;
    invoiceNumber = `PAY-RACE-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        createdBy: adminId,
        status: "UNPAID",
        subtotal: 100,
        grandTotal: 100,
        paidAmount: 0,
        balanceAmount: 100,
      },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    if (invoiceId) {
      await prisma.payment.deleteMany({ where: { invoiceId } });
      await prisma.auditLog.deleteMany({ where: { entityId: invoiceId } });
      await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    }
  });

  it("serializes concurrent payments and rejects requests that exceed the remaining balance", async () => {
    const actor = {
      sub: adminId,
      role: "ADMIN" as Role,
      email: "admin@careplus.local",
    };

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        billingService.recordPayment(actor, invoiceId, { paymentMethod: "CASH", amount: 30 }),
      ),
    );
    expect(outcomes).toHaveLength(5);

    const accepted = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(accepted.length).toBeGreaterThan(0);
    const acceptedAmount = accepted.length * 30;
    expect(acceptedAmount).toBeLessThanOrEqual(100);
    expect(rejected.length).toBeGreaterThan(0);
    for (const outcome of rejected) {
      expect(outcome.reason).toHaveProperty("message", expect.stringContaining("exceeds remaining balance"));
    }

    const totalPaid = await prisma.payment.aggregate({
      where: { invoiceId, deletedAt: null },
      _sum: { amount: true },
    });
    expect(Number(totalPaid._sum.amount ?? 0)).toBe(acceptedAmount);
    expect(acceptedAmount).toBeLessThanOrEqual(100);

    const persistedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(Number(persistedInvoice.paidAmount)).toBe(acceptedAmount);
    expect(Number(persistedInvoice.balanceAmount)).toBeGreaterThanOrEqual(0);
  });
});
