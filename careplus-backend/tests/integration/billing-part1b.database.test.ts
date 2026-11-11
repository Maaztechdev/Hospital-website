import { InvoiceDepartment, Role } from "@prisma/client";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { generateDepartmentInvoiceNumber } from "@common/utils/sequenceGenerators";
import { billingService } from "@modules/billing/billing.service";
import { backfillInvoiceDepartments, classifyInvoiceDepartment } from "../../scripts/backfill-invoice-departments";

describe("Integration: billing Part 1B", () => {
  let adminId: string;
  let adminEmail: string;
  let patientId: string;
  const invoiceIds: string[] = [];

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/").filter(Boolean).pop()?.split("?")[0] !== "careplus_test") {
      throw new Error("Billing integration tests require the careplus_test database.");
    }
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null } });
    adminId = admin.id;
    adminEmail = admin.email;
    patientId = patient.id;
  });

  afterAll(async () => {
    if (invoiceIds.length) {
      const paymentIds = (await prisma.payment.findMany({
        where: { invoiceId: { in: invoiceIds } },
        select: { id: true },
      })).map((payment) => payment.id);
      await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...invoiceIds, ...paymentIds] } } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    redis.disconnect();
  });

  it("generates unique per-department, per-year invoice numbers under concurrent transactions", async () => {
    const year = new Date().getFullYear();
    const prefixes: Record<InvoiceDepartment, string> = {
      RECEPTION: "OPD",
      LAB: "LAB",
      PHARMACY: "PHARM",
      ULTRASOUND: "USG",
      IPD: "IPD",
    };
    for (const department of Object.keys(prefixes) as InvoiceDepartment[]) {
      const generated = await Promise.all(Array.from({ length: 6 }, () =>
        prisma.$transaction((tx) => generateDepartmentInvoiceNumber(tx, department, new Date(`${year}-06-01T12:00:00Z`))),
      ));
      expect(new Set(generated).size).toBe(6);
      expect(generated.every((number) => new RegExp(`^${prefixes[department]}-${year}-\\d{6}$`).test(number))).toBe(true);
    }
  });

  it("reports mixed evidence as ambiguous and applies only the documented Reception fallback", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `PART1B-AMBIGUOUS-${Date.now()}`,
        createdBy: admin.id,
        status: "UNPAID",
        subtotal: 20,
        grandTotal: 20,
        paidAmount: 0,
        balanceAmount: 20,
        items: {
          create: [
            { itemType: "LAB", description: "Ambiguous lab source", quantity: 1, unitPrice: 10, discount: 0, subtotal: 10 },
            { itemType: "MEDICINE", description: "Ambiguous pharmacy source", quantity: 1, unitPrice: 10, discount: 0, subtotal: 10 },
          ],
        },
      },
    });
    invoiceIds.push(invoice.id);

    expect(classifyInvoiceDepartment({
      department: null,
      admissionId: null,
      labPackageId: null,
      pharmacySale: null,
      labOrders: [],
      ultrasoundOrder: null,
      items: [{ itemType: "LAB" }, { itemType: "MEDICINE" }],
    })).toEqual({ department: null, reason: "Mixed department evidence: LAB, PHARMACY" });

    const dryRun = await backfillInvoiceDepartments(prisma, false, false);
    expect(dryRun.review).toEqual([expect.objectContaining({
      id: invoice.id,
      suggestedDepartment: "RECEPTION",
    })]);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).department).toBeNull();

    const applied = await backfillInvoiceDepartments(prisma, true, false);
    expect(applied.review).toEqual([expect.objectContaining({ id: invoice.id })]);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).department).toBe("RECEPTION");
  });

  it("rejects a refund exceeding paid funds and records valid refunds as new audited rows", async () => {
    const actor = { sub: adminId, role: "ADMIN" as Role, email: adminEmail };
    const invoice = await billingService.create(actor, {
      patientId,
      department: "RECEPTION",
      items: [{ itemType: "CONSULTATION", description: "Refund evidence", quantity: 1, unitPrice: 100, discount: 0 }],
    });
    invoiceIds.push(invoice.id);
    await billingService.recordPayment(actor, invoice.id, { paymentMethod: "CASH", amount: 80 });

    await expect(billingService.refund(actor, invoice.id, {
      paymentMethod: "CASH", amount: 80.01, reason: "Over-limit test",
    })).rejects.toMatchObject({ message: expect.stringContaining("exceeds amount actually paid") });

    await billingService.refund(actor, invoice.id, {
      paymentMethod: "CASH", amount: 30, reason: "Partial refund test",
    });
    const detail = await billingService.getById(actor, invoice.id);
    expect(detail.payments).toHaveLength(2);
    expect(detail.payments.map((payment) => payment.type)).toEqual(["PAYMENT", "REFUND"]);
    expect(detail.payments[1].reason).toBe("Partial refund test");
    expect(detail.status).toBe("PARTIALLY_REFUNDED");
    expect(await prisma.auditLog.count({ where: { entityId: detail.payments[1].id } })).toBe(1);
  });

  it("reports summary collections/refunds from raw payment rows and IPD charges by source department", async () => {
    const actor = { sub: adminId, role: "ADMIN" as Role, email: adminEmail };
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const summaryBefore = await billingService.summary(actor, { dateFrom: today, dateTo: today });
    const receptionInvoice = await billingService.create(actor, {
      patientId,
      department: "RECEPTION",
      items: [{ itemType: "CONSULTATION", description: "Summary date evidence", quantity: 1, unitPrice: 100, discount: 0 }],
    });
    invoiceIds.push(receptionInvoice.id);
    await billingService.recordPayment(actor, receptionInvoice.id, { paymentMethod: "CASH", amount: 40 });
    await billingService.refund(actor, receptionInvoice.id, { paymentMethod: "CASH", amount: 7, reason: "Summary date evidence" });
    const ipdInvoice = await billingService.create(actor, {
      patientId,
      department: "IPD",
      items: [{
        itemType: "LAB",
        description: "Lab charge posted to IPD",
        quantity: 1,
        unitPrice: 50,
        discount: 0,
        sourceType: "LAB_ORDER",
        sourceId: crypto.randomUUID(),
        sourceDepartment: "LAB",
      }],
    });
    invoiceIds.push(ipdInvoice.id);

    const summary = await billingService.summary(actor, { dateFrom: today, dateTo: today });
    const receptionSummary = summary.departments.find((department) => department.department === "RECEPTION");
    const ipdSummary = summary.departments.find((department) => department.department === "IPD");
    const rawPayments = await prisma.payment.groupBy({
      by: ["type"],
      where: {
        invoice: { department: "RECEPTION", status: { not: "VOID" } },
        paymentDate: {
          gte: new Date(`${today}T00:00:00.000+05:00`),
          lt: new Date(new Date(`${today}T00:00:00.000+05:00`).getTime() + 86400000),
        },
      },
      _sum: { amount: true },
    });

    expect(Number(receptionSummary?.collected)).toBe(Number(rawPayments.find((payment) => payment.type === "PAYMENT")?._sum.amount));
    expect(Number(receptionSummary?.refunded)).toBe(Number(rawPayments.find((payment) => payment.type === "REFUND")?._sum.amount));
    expect(summary.billedViaIpd).toContainEqual(expect.objectContaining({ sourceDepartment: "LAB", amount: expect.anything() }));
    const billedViaIpdBefore = Number(summaryBefore.billedViaIpd.find((item) => item.sourceDepartment === "LAB")?.amount ?? 0);
    const billedViaIpdAfter = Number(summary.billedViaIpd.find((item) => item.sourceDepartment === "LAB")?.amount ?? 0);
    const invoicedIpdBefore = Number(summaryBefore.departments.find((department) => department.department === "IPD")?.invoiced ?? 0);
    expect(billedViaIpdAfter - billedViaIpdBefore).toBe(50);
    expect(Number(ipdSummary?.invoiced) - invoicedIpdBefore).toBe(50);
  });

  it("enforces create permissions for every real role and invoice department", async () => {
    const roles: Role[] = [
      "ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "LAB_TECHNICIAN", "PHARMACIST",
      "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "DOCTOR", "PATHOLOGIST", "RADIOLOGIST", "NURSE",
    ];
    const departments: InvoiceDepartment[] = ["RECEPTION", "LAB", "PHARMACY", "ULTRASOUND", "IPD"];
    const expectedDepartments: Partial<Record<Role, InvoiceDepartment[]>> = {
      ADMIN: departments,
      BILLING_MANAGER: departments,
      RECEPTIONIST: ["RECEPTION"],
      LAB_TECHNICIAN: ["LAB"],
      PHARMACIST: ["PHARMACY"],
      ULTRASOUND_TECH: ["ULTRASOUND"],
      ULTRASOUND_TECHNICIAN: ["ULTRASOUND"],
    };

    for (const role of roles) {
      for (const department of departments) {
        const actor = { sub: adminId, role, email: adminEmail };
        const create = billingService.create(actor, {
          patientId,
          department,
          items: [{ itemType: "CONSULTATION", description: `RBAC ${role} ${department}`, quantity: 1, unitPrice: 10, discount: 0 }],
        });
        if (expectedDepartments[role]?.includes(department)) {
          const invoice = await create;
          invoiceIds.push(invoice.id);
          expect(invoice.department).toBe(department);
        } else {
          await expect(create).rejects.toMatchObject({ statusCode: 403 });
        }
      }
    }
  });
});
