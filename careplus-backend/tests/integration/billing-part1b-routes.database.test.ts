import request from "supertest";
import jwt from "jsonwebtoken";
import { InvoiceDepartment, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { env } from "@config/env";
import { redis } from "@config/redis";

const app = createApp();
const departments: InvoiceDepartment[] = ["RECEPTION", "LAB", "PHARMACY", "ULTRASOUND", "IPD"];
const roles: Role[] = [
  "ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "LAB_TECHNICIAN", "PHARMACIST",
  "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "DOCTOR", "PATHOLOGIST", "RADIOLOGIST", "NURSE",
];
const expectedDepartments: Partial<Record<Role, InvoiceDepartment[]>> = {
  ADMIN: departments,
  BILLING_MANAGER: departments,
  RECEPTIONIST: ["RECEPTION", "LAB", "PHARMACY", "ULTRASOUND"],
  LAB_TECHNICIAN: ["LAB"],
  PHARMACIST: ["PHARMACY"],
  ULTRASOUND_TECH: ["ULTRASOUND"],
  ULTRASOUND_TECHNICIAN: ["ULTRASOUND"],
};

describe("Integration: billing Part 1B route authorization matrix", () => {
  let userId: string;
  let patientId: string;
  let invoiceIds: string[] = [];

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/").filter(Boolean).pop()?.split("?")[0] !== "careplus_test") {
      throw new Error("Billing integration tests require the careplus_test database.");
    }
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null } });
    userId = admin.id;
    patientId = patient.id;
    const invoices = await Promise.all(departments.map((department, index) => prisma.invoice.create({
      data: {
        invoiceNumber: `PART1B-ROUTE-${Date.now()}-${index}`,
        department,
        createdBy: admin.id,
        patientId,
        status: "UNPAID",
        subtotal: 100,
        grandTotal: 100,
        paidAmount: 0,
        balanceAmount: 100,
      },
    })));
    invoiceIds = invoices.map((invoice) => invoice.id);
  });

  afterAll(async () => {
    if (invoiceIds.length) {
      const paymentIds = (await prisma.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } }))
        .map((payment) => payment.id);
      await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...invoiceIds, ...paymentIds] } } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    redis.disconnect();
  });

  function token(role: Role) {
    return jwt.sign({ sub: userId, role, email: "admin@careplus.local" }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  }

  it("enforces list, create, and payment route gates and department policies for every role/dept cell", async () => {
    for (const role of roles) {
      const auth = { Authorization: `Bearer ${token(role)}` };
      for (const [index, department] of departments.entries()) {
        const allowed = expectedDepartments[role]?.includes(department) ?? false;
        const canCreate = role === "RECEPTIONIST"
          ? department === "RECEPTION"
          : allowed;

        const list = await request(app)
          .get(`/api/v1/billing/invoices?department=${department}`)
          .set(auth);
        expect(list.status).toBe(allowed ? 200 : 403);

        const detail = await request(app)
          .get(`/api/v1/billing/invoices/${invoiceIds[index]}`)
          .set(auth);
        expect(detail.status).toBe(allowed ? 200 : 403);

        const staff = await request(app)
          .get(`/api/v1/billing/staff?department=${department}`)
          .set(auth);
        expect(staff.status).toBe(allowed ? 200 : 403);

        const create = await request(app)
          .post("/api/v1/billing/invoices")
          .set(auth)
          .send({
            patientId,
            department,
            items: [{ itemType: "CONSULTATION", description: `route matrix ${role}`, quantity: 1, unitPrice: 1, discount: 0 }],
          });
        expect(create.status).toBe(canCreate ? 201 : 403);
        if (create.status === 201) {
          invoiceIds.push(create.body.data.id as string);
        }

        const payment = await request(app)
          .post(`/api/v1/billing/invoices/${invoiceIds[index]}/payments`)
          .set(auth)
          .send({ paymentMethod: "CASH", amount: 1 });
        expect(payment.status).toBe(allowed ? 200 : 403);
      }
    }
  });

  it("limits department summaries, combined history, refunds, and voids to Admin/Billing Manager", async () => {
    const allowedRoles: Role[] = ["ADMIN", "BILLING_MANAGER"];
    const missingInvoiceId = crypto.randomUUID();
    for (const role of roles) {
      const auth = { Authorization: `Bearer ${token(role)}` };
      const allowed = allowedRoles.includes(role);

      const summary = await request(app).get("/api/v1/billing/summary").set(auth);
      expect(summary.status).toBe(allowed ? 200 : 403);

      const history = await request(app).get("/api/v1/billing/history").set(auth);
      expect(history.status).toBe(allowed ? 200 : 403);

      for (const department of departments) {
        const refund = await request(app)
          .post(`/api/v1/billing/invoices/${missingInvoiceId}/refunds`)
          .set(auth)
          .send({ paymentMethod: "CASH", amount: 1, reason: "RBAC matrix" });
        expect(refund.status).toBe(allowed ? 404 : 403);

        const voidInvoice = await request(app)
          .post(`/api/v1/billing/invoices/${missingInvoiceId}/void`)
          .set(auth)
          .send({ reason: `RBAC matrix ${department}` });
        expect(voidInvoice.status).toBe(allowed ? 404 : 403);
      }
    }
  });

  it("matches summary totals with raw invoice and payment rows across departments, IPD, refunds, and voids", async () => {
    const adminAuth = { Authorization: `Bearer ${token("ADMIN")}` };
    const dateFrom = "2000-01-01";
    const dateTo = "2099-12-31";
    const dateStart = new Date(`${dateFrom}T00:00:00.000+05:00`);
    const dateEnd = new Date(new Date(`${dateTo}T00:00:00.000+05:00`).getTime() + 86400000);

    for (const department of departments) {
      const created = await request(app)
        .post("/api/v1/billing/invoices")
        .set(adminAuth)
        .send({
          patientId,
          department,
          items: [{
            itemType: department === "IPD" ? "LAB" : "CONSULTATION",
            description: `Raw summary parity ${department}`,
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            ...(department === "IPD" ? {
              sourceType: "LAB_ORDER",
              sourceId: crypto.randomUUID(),
              sourceDepartment: "LAB",
            } : {}),
          }],
        });
      expect(created.status).toBe(201);
      const invoiceId = created.body.data.id as string;
      invoiceIds.push(invoiceId);

      const payment = await request(app)
        .post(`/api/v1/billing/invoices/${invoiceId}/payments`)
        .set(adminAuth)
        .send({ paymentMethod: "CASH", amount: 40 });
      expect(payment.status).toBe(200);

      const refund = await request(app)
        .post(`/api/v1/billing/invoices/${invoiceId}/refunds`)
        .set(adminAuth)
        .send({ paymentMethod: "CASH", amount: 7, reason: `Raw summary parity ${department}` });
      expect(refund.status).toBe(200);
    }

    const voidable = await request(app)
      .post("/api/v1/billing/invoices")
      .set(adminAuth)
      .send({
        patientId,
        department: "RECEPTION",
        items: [{ itemType: "CONSULTATION", description: "Voided summary parity", quantity: 1, unitPrice: 25, discount: 0 }],
      });
    expect(voidable.status).toBe(201);
    const voidedInvoiceId = voidable.body.data.id as string;
    invoiceIds.push(voidedInvoiceId);
    const voidPayment = await request(app)
      .post(`/api/v1/billing/invoices/${voidedInvoiceId}/payments`)
      .set(adminAuth)
      .send({ paymentMethod: "CASH", amount: 10 });
    expect(voidPayment.status).toBe(200);
    const voidResponse = await request(app)
      .post(`/api/v1/billing/invoices/${voidedInvoiceId}/void`)
      .set(adminAuth)
      .send({ reason: "Exclude voided rows from summary totals" });
    expect(voidResponse.status).toBe(200);

    const response = await request(app)
      .get(`/api/v1/billing/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .set(adminAuth);
    expect(response.status).toBe(200);
    const summary = response.body.data as {
      departments: Array<{ department: InvoiceDepartment; invoiced: number; collected: number; refunded: number }>;
      billedViaIpd: Array<{ sourceDepartment: string; amount: number }>;
    };

    const invoices = await prisma.invoice.findMany({
      where: {
        createdAt: { gte: dateStart, lt: dateEnd },
        status: { not: "VOID" },
      },
      select: { department: true, grandTotal: true },
    });
    const payments = await prisma.payment.findMany({
      where: {
        paymentDate: { gte: dateStart, lt: dateEnd },
        deletedAt: null,
        invoice: { status: { not: "VOID" } },
      },
      select: { type: true, amount: true, invoice: { select: { department: true } } },
    });

    for (const department of departments) {
      const expectedInvoiced = invoices
        .filter((invoice) => (invoice.department ?? "RECEPTION") === department)
        .reduce((sum, invoice) => sum + Number(invoice.grandTotal), 0);
      const departmentPayments = payments.filter((payment) => (payment.invoice.department ?? "RECEPTION") === department);
      const expectedCollected = departmentPayments
        .filter((payment) => payment.type === "PAYMENT")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      const expectedRefunded = departmentPayments
        .filter((payment) => payment.type === "REFUND")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      const actual = summary.departments.find((entry) => entry.department === department);
      expect(actual).toBeDefined();
      expect(Number(actual?.invoiced)).toBeCloseTo(expectedInvoiced, 2);
      expect(Number(actual?.collected)).toBeCloseTo(expectedCollected, 2);
      expect(Number(actual?.refunded)).toBeCloseTo(expectedRefunded, 2);
    }

    const rawIpdItems = await prisma.invoiceItem.groupBy({
      by: ["sourceDepartment"],
      where: {
        invoice: { department: "IPD", createdAt: { gte: dateStart, lt: dateEnd } },
        sourceDepartment: { not: null },
      },
      _sum: { subtotal: true },
    });
    expect(summary.billedViaIpd).toHaveLength(rawIpdItems.length);
    for (const item of rawIpdItems) {
      const actual = summary.billedViaIpd.find((entry) => entry.sourceDepartment === item.sourceDepartment);
      expect(actual).toBeDefined();
      expect(Number(actual?.amount)).toBeCloseTo(Number(item._sum.subtotal), 2);
    }
  });

  it("filters outstanding invoices across selected departments and scopes the billing staff lookup", async () => {
    const receptionistAuth = { Authorization: `Bearer ${token("RECEPTIONIST")}` };
    const list = await request(app)
      .get("/api/v1/billing/invoices?departments=LAB,PHARMACY,ULTRASOUND&status=OUTSTANDING&page=1&limit=100")
      .set(receptionistAuth);

    expect(list.status).toBe(200);
    expect(list.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ department: "LAB" }),
      expect.objectContaining({ department: "PHARMACY" }),
      expect.objectContaining({ department: "ULTRASOUND" }),
    ]));
    expect(list.body.data.every((invoice: { department: string; status: string }) =>
      ["LAB", "PHARMACY", "ULTRASOUND"].includes(invoice.department)
      && ["UNPAID", "FINALIZED", "DRAFT", "PARTIAL"].includes(invoice.status),
    )).toBe(true);
    expect(list.body.pagination).toMatchObject({ page: 1, pageSize: 100, total: expect.any(Number) });

    const labStaff = await request(app)
      .get("/api/v1/billing/staff?department=LAB")
      .set({ Authorization: `Bearer ${token("LAB_TECHNICIAN")}` });
    expect(labStaff.status).toBe(200);
    expect(labStaff.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: userId })]));

    const crossDepartmentStaff = await request(app)
      .get("/api/v1/billing/staff?department=PHARMACY")
      .set({ Authorization: `Bearer ${token("LAB_TECHNICIAN")}` });
    expect(crossDepartmentStaff.status).toBe(403);
  });
});
