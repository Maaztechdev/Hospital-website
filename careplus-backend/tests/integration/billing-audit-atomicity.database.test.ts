import { Role } from "@prisma/client";
import { prisma } from "@config/prisma";
import * as auditLog from "@common/utils/auditLog";
import { billingService } from "@modules/billing/billing.service";

describe("billing invoice audit atomicity", () => {
  it("rolls back invoice creation when the audit write fails", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/")[1]?.split("?")[0] !== "careplus_test") {
      throw new Error("Billing integration tests require the careplus_test database.");
    }

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null } });
    const invoiceCountBefore = await prisma.invoice.count();
    const auditSpy = jest.spyOn(auditLog, "writeAuditLog").mockRejectedValue(new Error("Forced audit write failure"));

    try {
      await expect(billingService.create(
        { sub: admin.id, role: "ADMIN" as Role, email: admin.email },
        {
          patientId: patient.id,
          department: "RECEPTION",
          items: [{
            itemType: "CONSULTATION",
            description: "Audit atomicity test",
            quantity: 1,
            unitPrice: 100,
            discount: 0,
          }],
        },
      )).rejects.toThrow("Forced audit write failure");

      expect(await prisma.invoice.count()).toBe(invoiceCountBefore);
    } finally {
      auditSpy.mockRestore();
    }
  });
});
