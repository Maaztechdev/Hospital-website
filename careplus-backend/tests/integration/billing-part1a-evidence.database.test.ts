import request from "supertest";
import { InvoiceItemType, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { billingService } from "@modules/billing/billing.service";

const app = createApp();
const api = "/api/v1";

describe("Integration: Part 1A billing evidence", () => {
  let adminId: string;
  let adminEmail: string;
  let adminToken: string;
  let patientId: string;
  let doctorId: string;
  let labTestId: string;
  const suffix = Date.now().toString();
  const invoiceIds: string[] = [];
  const labOrderIds: string[] = [];
  const ultrasoundOrderIds: string[] = [];
  const pharmacySaleIds: string[] = [];
  const pharmacyLedgerAccountIds: string[] = [];

  const actor = (role: Role) => ({ sub: adminId, role, email: adminEmail });

  async function createInvoice(itemType: InvoiceItemType, label: string, createdAt?: Date) {
    const department = itemType === "LAB" ? "LAB"
      : itemType === "MEDICINE" ? "PHARMACY"
        : itemType === "ULTRASOUND" ? "ULTRASOUND"
          : itemType === "WARD" ? "IPD" : "RECEPTION";
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `PART1A-${suffix}-${label}`,
        patientId,
        createdBy: adminId,
        department,
        status: "UNPAID",
        subtotal: 100,
        grandTotal: 100,
        paidAmount: 0,
        balanceAmount: 100,
        ...(createdAt ? { createdAt } : {}),
        items: {
          create: [{
            itemType,
            description: label,
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            subtotal: 100,
          }],
        },
      },
    });
    invoiceIds.push(invoice.id);
    return invoice;
  }

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/")[1]?.split("?")[0] !== "careplus_test") {
      throw new Error("Billing integration tests require the careplus_test database.");
    }

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null } });
    const doctor = await prisma.doctor.findFirstOrThrow();
    const labTest = await prisma.labTest.findFirstOrThrow();
    adminId = admin.id;
    adminEmail = admin.email;
    patientId = patient.id;
    doctorId = doctor.id;
    labTestId = labTest.id;

    const login = await request(app).post(`${api}/auth/login`).send({ email: admin.email, password: "Admin@12345" });
    expect(login.status).toBe(200);
    adminToken = login.body.data.accessToken;
  });

  afterAll(async () => {
    if (invoiceIds.length) {
      await prisma.labOrder.deleteMany({ where: { id: { in: labOrderIds } } });
      await prisma.ultrasoundOrder.deleteMany({ where: { id: { in: ultrasoundOrderIds } } });
      await prisma.pharmacySale.deleteMany({ where: { id: { in: pharmacySaleIds } } });
      const ledgerEntries = await prisma.pharmacyLedgerEntry.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: ledgerEntries.map((entry) => entry.id) } } });
      await prisma.pharmacyLedgerEntry.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.pharmacyLedgerAccount.deleteMany({ where: { id: { in: pharmacyLedgerAccountIds } } });
      const paymentIds = (await prisma.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } })).map((payment) => payment.id);
      await prisma.auditLog.deleteMany({ where: { entityId: { in: paymentIds } } });
      await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: invoiceIds } } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    redis.disconnect();
  });

  it("billingService.create allows discounts equal to subtotal and rejects one paisa over, including line discounts", async () => {
    const created = await billingService.create(actor("ADMIN" as Role), {
      patientId,
      department: "RECEPTION",
      items: [{
        itemType: "CONSULTATION",
        description: `Discount boundary ${suffix}`,
        quantity: 1,
        unitPrice: 100,
        discount: 20,
        discountType: "FLAT",
      }],
      discountAmount: 80,
    });
    invoiceIds.push(created.id);
    expect(Number(created.grandTotal)).toBe(0);

    await expect(billingService.create(actor("ADMIN" as Role), {
      patientId,
      department: "RECEPTION",
      items: [{
        itemType: "CONSULTATION",
        description: `Discount over boundary ${suffix}`,
        quantity: 1,
        unitPrice: 100,
        discount: 20,
        discountType: "FLAT",
      }],
      discountAmount: 80.01,
    })).rejects.toMatchObject({ message: "Total discounts cannot exceed invoice subtotal" });
  });

  it("GET /billing/invoices paginates server-side and returns page, pageSize, total for more than 100 invoices", async () => {
    const testInvoices: Awaited<ReturnType<typeof createInvoice>>[] = [];
    const baseCreatedAt = Date.now();
    for (let index = 0; index < 105; index += 1) {
      testInvoices.push(await createInvoice(
        "CONSULTATION",
        `PAGE-${String(index).padStart(3, "0")}`,
        new Date(baseCreatedAt + index * 1_000),
      ));
    }
    const expectedPage = testInvoices.slice().reverse().slice(20, 40);
    const response = await request(app)
      .get(`${api}/billing/invoices?search=PART1A-${suffix}-PAGE-&page=2&limit=20`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toMatchObject({ page: 2, pageSize: 20, total: 105 });
    expect(response.body.data).toHaveLength(20);
    expect(response.body.data.map((invoice: { id: string }) => invoice.id))
      .toEqual(expectedPage.map((invoice) => invoice.id));

    const finalizedInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `PART1A-${suffix}-FINALIZED`,
        createdBy: adminId,
        status: "FINALIZED",
        subtotal: 100,
        grandTotal: 100,
        paidAmount: 0,
        balanceAmount: 100,
      },
    });
    invoiceIds.push(finalizedInvoice.id);
    const unpaidFilterResponse = await request(app)
      .get(`${api}/billing/invoices?search=PART1A-${suffix}-FINALIZED&status=UNPAID&page=1&limit=20`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(unpaidFilterResponse.status).toBe(200);
    expect(unpaidFilterResponse.body.pagination.total).toBe(1);
    expect(unpaidFilterResponse.body.data[0].id).toBe(finalizedInvoice.id);
  });

  it("GET /billing/invoices/:id retains payment rows with reversed=true after voiding", async () => {
    const invoice = await createInvoice("CONSULTATION", "VOID-HISTORY");
    await billingService.recordPayment(actor("ADMIN" as Role), invoice.id, { paymentMethod: "CASH", amount: 40 });
    await billingService.voidInvoice(actor("ADMIN" as Role), invoice.id, "Void history evidence");

    const response = await request(app)
      .get(`${api}/billing/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.payments).toHaveLength(1);
    expect(Number(response.body.data.payments[0].amount)).toBe(40);
    expect(response.body.data.payments[0].reversed).toBe(true);
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it("enforces the payment and void 403/allow matrix for invoice source departments", async () => {
    const labInvoice = await createInvoice("LAB", "ROLE-LAB");
    const pharmacyInvoice = await createInvoice("MEDICINE", "ROLE-PHARMACY");
    const ultrasoundInvoice = await createInvoice("ULTRASOUND", "ROLE-ULTRASOUND");
    const receptionInvoice = await createInvoice("CONSULTATION", "ROLE-RECEPTION");
    const ipdInvoice = await createInvoice("WARD", "ROLE-IPD");

    const labOrder = await prisma.labOrder.create({
      data: {
        orderNumber: `PART1A-${suffix}-LAB-ORDER`,
        patientId,
        testId: labTestId,
        createdBy: adminId,
        invoiceId: labInvoice.id,
      },
    });
    labOrderIds.push(labOrder.id);
    const pharmacyLedgerAccount = await prisma.pharmacyLedgerAccount.create({
      data: {
        customerName: `Part 1A ${suffix}`,
        createdBy: adminId,
      },
    });
    pharmacyLedgerAccountIds.push(pharmacyLedgerAccount.id);
    await prisma.pharmacyLedgerEntry.create({
      data: {
        accountId: pharmacyLedgerAccount.id,
        invoiceId: pharmacyInvoice.id,
        type: "SALE_ON_CREDIT",
        amount: 100,
        balanceAfter: 100,
        createdBy: adminId,
      },
    });
    const pharmacySale = await prisma.pharmacySale.create({
      data: {
        invoiceId: pharmacyInvoice.id,
        cashierId: adminId,
        paymentMethod: "CASH",
        subtotal: 100,
        totalAmount: 100,
      },
    });
    pharmacySaleIds.push(pharmacySale.id);
    const ultrasoundOrder = await prisma.ultrasoundOrder.create({
      data: {
        patientId,
        doctorId,
        examType: "Part 1A permission check",
        invoiceId: ultrasoundInvoice.id,
      },
    });
    ultrasoundOrderIds.push(ultrasoundOrder.id);

    const allowedPayments: Array<[Role, string]> = [
      ["LAB_TECHNICIAN", labInvoice.id],
      ["PHARMACIST", pharmacyInvoice.id],
      ["ULTRASOUND_TECH", ultrasoundInvoice.id],
      ["ULTRASOUND_TECHNICIAN", ultrasoundInvoice.id],
      ["RECEPTIONIST", receptionInvoice.id],
      ["ADMIN", labInvoice.id],
      ["BILLING_MANAGER", labInvoice.id],
    ];
    for (const [role, invoiceId] of allowedPayments) {
      await expect(billingService.recordPayment(actor(role), invoiceId, { paymentMethod: "CASH", amount: 1 }))
        .resolves.toBeDefined();
    }
    const pharmacyLedgerBalance = await prisma.pharmacyLedgerEntry.aggregate({
      where: { accountId: pharmacyLedgerAccount.id },
      _sum: { amount: true },
    });
    expect(Number(pharmacyLedgerBalance._sum.amount)).toBe(99);

    const deniedPayments: Array<[Role, string]> = [
      ["LAB_TECHNICIAN", pharmacyInvoice.id],
      ["LAB_TECHNICIAN", ultrasoundInvoice.id],
      ["PHARMACIST", labInvoice.id],
      ["PHARMACIST", ultrasoundInvoice.id],
      ["ULTRASOUND_TECH", labInvoice.id],
      ["ULTRASOUND_TECH", pharmacyInvoice.id],
      ["ULTRASOUND_TECHNICIAN", labInvoice.id],
      ["ULTRASOUND_TECHNICIAN", pharmacyInvoice.id],
      ["RECEPTIONIST", ipdInvoice.id],
      ["DOCTOR", receptionInvoice.id],
      ["RADIOLOGIST", receptionInvoice.id],
      ["PATHOLOGIST", receptionInvoice.id],
      ["NURSE", receptionInvoice.id],
    ];
    for (const [role, invoiceId] of deniedPayments) {
      await expect(billingService.recordPayment(actor(role), invoiceId, { paymentMethod: "CASH", amount: 1 }))
        .rejects.toMatchObject({ statusCode: 403 });
    }

    const voidAdminInvoice = await createInvoice("LAB", "VOID-ADMIN");
    const voidManagerInvoice = await createInvoice("LAB", "VOID-MANAGER");
    const voidDeniedInvoice = await createInvoice("LAB", "VOID-DENIED");
    await expect(billingService.voidInvoice(actor("ADMIN" as Role), voidAdminInvoice.id, "Admin approval"))
      .resolves.toBeDefined();
    await expect(billingService.voidInvoice(actor("BILLING_MANAGER" as Role), voidManagerInvoice.id, "Billing approval"))
      .resolves.toBeDefined();
    for (const role of ["RECEPTIONIST", "LAB_TECHNICIAN", "PHARMACIST", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "DOCTOR", "RADIOLOGIST", "PATHOLOGIST", "NURSE"] as Role[]) {
      await expect(billingService.voidInvoice(actor(role), voidDeniedInvoice.id, "Must be denied"))
        .rejects.toMatchObject({ statusCode: 403 });
    }
  });
});
