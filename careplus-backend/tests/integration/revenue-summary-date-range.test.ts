import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { ultrasoundService } from "@modules/ultrasound/ultrasound.service";

const app = createApp();

describe("Integration: revenue summary date range", () => {
  let adminToken: string;
  let adminId: string;
  let invoiceIds: string[] = [];
  let ultrasoundOrderId: string;
  let baselineSummary: { invoiceCount: number; totalBilled: number; totalInvoiced: number; totalCollected: number };
  let baselineYesterdaySummary: { invoiceCount: number; totalInvoiced: number; totalCollected: number };
  let baselineTomorrowSummary: { invoiceCount: number; totalInvoiced: number; totalCollected: number };
  let baselineTrend: Array<{ label: string; collected: number; invoiced: number }>;
  let baselineUltrasoundCollected: number;
  const suffix = Date.now().toString();
  const invoiceNumbers = [`DATE-RANGE-TODAY-${suffix}`, `DATE-RANGE-YESTERDAY-${suffix}`, `DATE-RANGE-TOMORROW-PAY-${suffix}`];
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayStart = new Date(`${today}T00:00:00+05:00`);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/")[1]?.split("?")[0] !== "careplus_test") {
      throw new Error("Billing integration tests require the careplus_test database.");
    }

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    adminId = admin.id;
    const login = await request(app).post("/api/v1/auth/login").send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(login.status).toBe(200);
    adminToken = login.body.data.accessToken;

    const summaryBefore = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendBefore = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const yesterdayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterdayStart);
    const tomorrowKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrowStart);
    const yesterdaySummaryBefore = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${yesterdayKey}&to=${yesterdayKey}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const tomorrowSummaryBefore = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${tomorrowKey}&to=${tomorrowKey}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(summaryBefore.status).toBe(200);
    expect(trendBefore.status).toBe(200);
    expect(yesterdaySummaryBefore.status).toBe(200);
    expect(tomorrowSummaryBefore.status).toBe(200);
    baselineSummary = summaryBefore.body.data;
    baselineTrend = trendBefore.body.data;
    baselineYesterdaySummary = yesterdaySummaryBefore.body.data;
    baselineTomorrowSummary = tomorrowSummaryBefore.body.data;
    baselineUltrasoundCollected = (await ultrasoundService.overview()).stats.todayCollected;

    const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null } });
    const doctor = await prisma.doctor.findFirstOrThrow();
    const yesterdayInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: invoiceNumbers[1],
        createdBy: adminId,
        status: "PARTIAL",
        grandTotal: 900,
        paidAmount: 125,
        balanceAmount: 775,
        createdAt: new Date(yesterdayStart.getTime() + 12 * 60 * 60 * 1000),
      },
    });
    const ultrasoundOrder = await prisma.ultrasoundOrder.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        invoiceId: yesterdayInvoice.id,
        examType: "Revenue date test",
        feeAmount: 900,
        createdAt: new Date(yesterdayStart.getTime() + 12 * 60 * 60 * 1000),
      },
    });
    ultrasoundOrderId = ultrasoundOrder.id;
    const todayInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: invoiceNumbers[0],
        createdBy: adminId,
        status: "UNPAID",
        grandTotal: 100,
        paidAmount: 0,
        balanceAmount: 100,
        createdAt: new Date(todayStart.getTime() + 12 * 60 * 60 * 1000),
      },
    });
    const todayInvoicePaidTomorrow = await prisma.invoice.create({
      data: {
        invoiceNumber: invoiceNumbers[2],
        createdBy: adminId,
        status: "UNPAID",
        grandTotal: 200,
        paidAmount: 0,
        balanceAmount: 200,
        createdAt: new Date(todayStart.getTime() + 14 * 60 * 60 * 1000),
      },
    });
    invoiceIds = [todayInvoice.id, yesterdayInvoice.id, todayInvoicePaidTomorrow.id];
    await prisma.payment.create({
      data: {
        invoiceId: yesterdayInvoice.id,
        paymentMethod: "CASH",
        amount: 125,
        paymentDate: new Date(todayStart.getTime() + 13 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });
    await prisma.payment.create({
      data: {
        invoiceId: todayInvoicePaidTomorrow.id,
        paymentMethod: "CASH",
        amount: 200,
        paymentDate: new Date(tomorrowStart.getTime() + 13 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });
  });

  afterAll(async () => {
    if (ultrasoundOrderId) {
      await prisma.ultrasoundOrder.deleteMany({ where: { id: ultrasoundOrderId } });
    }
    if (invoiceIds.length) {
      await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    }
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { in: invoiceNumbers } } });
    redis.disconnect();
  });

  it("uses invoice dates for invoiced totals and payment dates for collected totals", async () => {
    const response = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.invoiceCount - baselineSummary.invoiceCount).toBe(2);
    expect(response.body.data.totalInvoiced - baselineSummary.totalInvoiced).toBe(300);
    expect(response.body.data.totalBilled).toBe(response.body.data.totalInvoiced);
    expect(response.body.data.totalCollected - baselineSummary.totalCollected).toBe(125);
  });

  it("separates invoice and payment dates when invoices are paid on different days", async () => {
    const yesterdayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterdayStart);
    const tomorrowKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrowStart);
    const [yesterday, tomorrow] = await Promise.all([
      request(app)
        .get(`/api/v1/reports/revenue-summary?from=${yesterdayKey}&to=${yesterdayKey}`)
        .set("Authorization", `Bearer ${adminToken}`),
      request(app)
        .get(`/api/v1/reports/revenue-summary?from=${tomorrowKey}&to=${tomorrowKey}`)
        .set("Authorization", `Bearer ${adminToken}`),
    ]);

    expect(yesterday.status).toBe(200);
    expect(yesterday.body.data.totalInvoiced - baselineYesterdaySummary.totalInvoiced).toBe(900);
    expect(yesterday.body.data.totalCollected - baselineYesterdaySummary.totalCollected).toBe(0);
    expect(tomorrow.status).toBe(200);
    expect(tomorrow.body.data.totalInvoiced - baselineTomorrowSummary.totalInvoiced).toBe(0);
    expect(tomorrow.body.data.totalCollected - baselineTomorrowSummary.totalCollected).toBe(200);
  });

  it("uses payment dates for collected trend and invoice dates for invoiced trend", async () => {
    const response = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].collected - baselineTrend[0].collected).toBe(125);
    expect(response.body.data[0].invoiced - baselineTrend[0].invoiced).toBe(300);
  });

  it("counts actual payment-date collections for Ultrasound, not study fees", async () => {
    const overview = await ultrasoundService.overview();

    expect(overview.stats.todayCollected - baselineUltrasoundCollected).toBe(125);
  });
});
