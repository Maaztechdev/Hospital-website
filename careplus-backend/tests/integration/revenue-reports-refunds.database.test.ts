import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { ultrasoundService } from "@modules/ultrasound/ultrasound.service";

const app = createApp();

describe("Integration: revenue reports refund exclusion", () => {
  let adminToken: string;
  let adminId: string;
  const createdInvoiceIds: string[] = [];
  const createdUltrasoundOrderIds: string[] = [];
  const suffix = Date.now().toString();

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const todayStart = new Date(`${today}T00:00:00+05:00`);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterdayStart);

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
  });

  afterAll(async () => {
    if (createdUltrasoundOrderIds.length) {
      await prisma.ultrasoundOrder.deleteMany({ where: { id: { in: createdUltrasoundOrderIds } } });
    }
    if (createdInvoiceIds.length) {
      await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    redis.disconnect();
  });

  it("test 1: partial refund - payment 1000 and refund 300 shows collected = 700 in summary and trend", async () => {
    const summaryBefore = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendBefore = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const baseCollected = summaryBefore.body.data.totalCollected;
    const baseGross = summaryBefore.body.data.grossCollected ?? 0;
    const baseRefunds = summaryBefore.body.data.refundsTotal ?? 0;
    const baseTrendDay = trendBefore.body.data.find((p: { label: string }) => true)?.collected ?? 0;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `REPRO-REV-${suffix}-1`,
        department: "RECEPTION",
        createdBy: adminId,
        status: "PARTIAL",
        grandTotal: 1000,
        paidAmount: 700,
        balanceAmount: 300,
        createdAt: new Date(todayStart.getTime() + 10 * 60 * 60 * 1000),
      },
    });
    createdInvoiceIds.push(invoice.id);

    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "PAYMENT",
        paymentMethod: "CASH",
        amount: 1000,
        paymentDate: new Date(todayStart.getTime() + 11 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "REFUND",
        paymentMethod: "CASH",
        amount: 300,
        reason: "Partial return test",
        paymentDate: new Date(todayStart.getTime() + 12 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    const summaryAfter = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendAfter = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(summaryAfter.body.data.totalCollected - baseCollected).toBe(700);
    expect(summaryAfter.body.data.grossCollected - baseGross).toBe(1000);
    expect(summaryAfter.body.data.refundsTotal - baseRefunds).toBe(300);

    const trendDayAfter = trendAfter.body.data.find((p: { label: string }) => true)?.collected ?? 0;
    expect(trendDayAfter - baseTrendDay).toBe(700);

    // Also check billing summary for RECEPTION department
    const billingSummary = await request(app)
      .get(`/api/v1/billing/summary?dateFrom=${today}&dateTo=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(billingSummary.status).toBe(200);
    const reception = billingSummary.body.data.departments.find((d: { department: string }) => d.department === "RECEPTION");
    expect(Number(reception.collected)).toBeGreaterThanOrEqual(1000);
    expect(Number(reception.refunded)).toBeGreaterThanOrEqual(300);
    expect(Number(reception.netCollected)).toBe(Number(reception.collected) - Number(reception.refunded));
  });

  it("test 2: refund only - refund 250 with no payment in range decreases collected by 250", async () => {
    const summaryBefore = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendBefore = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const baseCollected = summaryBefore.body.data.totalCollected;
    const baseGross = summaryBefore.body.data.grossCollected ?? 0;
    const baseRefunds = summaryBefore.body.data.refundsTotal ?? 0;
    const baseTrendDay = trendBefore.body.data.find((p: { label: string }) => true)?.collected ?? 0;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `REPRO-REV-${suffix}-2`,
        department: "RECEPTION",
        createdBy: adminId,
        status: "PAID",
        grandTotal: 500,
        paidAmount: 250,
        balanceAmount: 0,
        createdAt: new Date(todayStart.getTime() + 10 * 60 * 60 * 1000),
      },
    });
    createdInvoiceIds.push(invoice.id);

    // Only a REFUND in this window (no PAYMENT in today)
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "REFUND",
        paymentMethod: "CASH",
        amount: 250,
        reason: "Full return",
        paymentDate: new Date(todayStart.getTime() + 13 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    const summaryAfter = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendAfter = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(summaryAfter.body.data.totalCollected - baseCollected).toBe(-250);
    expect(summaryAfter.body.data.grossCollected - baseGross).toBe(0);
    expect(summaryAfter.body.data.refundsTotal - baseRefunds).toBe(250);

    const trendDayAfter = trendAfter.body.data.find((p: { label: string }) => true)?.collected ?? 0;
    expect(trendDayAfter - baseTrendDay).toBe(-250);
  });

  it("test 3: voided payment - soft-deleted payment is excluded from summary and trend", async () => {
    const summaryBefore = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendBefore = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const baseCollected = summaryBefore.body.data.totalCollected;
    const baseGross = summaryBefore.body.data.grossCollected ?? 0;
    const baseRefunds = summaryBefore.body.data.refundsTotal ?? 0;
    const baseTrendDay = trendBefore.body.data.find((p: { label: string }) => true)?.collected ?? 0;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `REPRO-REV-${suffix}-3`,
        department: "RECEPTION",
        createdBy: adminId,
        status: "UNPAID",
        grandTotal: 800,
        paidAmount: 0,
        balanceAmount: 800,
        createdAt: new Date(todayStart.getTime() + 10 * 60 * 60 * 1000),
      },
    });
    createdInvoiceIds.push(invoice.id);

    // Create a payment that was voided/deleted
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "PAYMENT",
        paymentMethod: "CASH",
        amount: 800,
        paymentDate: new Date(todayStart.getTime() + 11 * 60 * 60 * 1000),
        deletedAt: new Date(todayStart.getTime() + 11 * 60 * 60 * 1000 + 5000),
        createdBy: adminId,
      },
    });

    const summaryAfter = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendAfter = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(summaryAfter.body.data.totalCollected - baseCollected).toBe(0);
    expect(summaryAfter.body.data.grossCollected - baseGross).toBe(0);
    expect(summaryAfter.body.data.refundsTotal - baseRefunds).toBe(0);

    const trendDayAfter = trendAfter.body.data.find((p: { label: string }) => true)?.collected ?? 0;
    expect(trendDayAfter - baseTrendDay).toBe(0);
  });

  it("test 4: voided invoice - payments and refunds on VOID invoices are excluded", async () => {
    const summaryBefore = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendBefore = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const baseCollected = summaryBefore.body.data.totalCollected;
    const baseGross = summaryBefore.body.data.grossCollected ?? 0;
    const baseRefunds = summaryBefore.body.data.refundsTotal ?? 0;
    const baseTrendDay = trendBefore.body.data.find((p: { label: string }) => true)?.collected ?? 0;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `REPRO-REV-${suffix}-4`,
        department: "RECEPTION",
        createdBy: adminId,
        status: "VOID",
        grandTotal: 1500,
        paidAmount: 0,
        balanceAmount: 0,
        createdAt: new Date(todayStart.getTime() + 10 * 60 * 60 * 1000),
      },
    });
    createdInvoiceIds.push(invoice.id);

    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "PAYMENT",
        paymentMethod: "CASH",
        amount: 1500,
        paymentDate: new Date(todayStart.getTime() + 11 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "REFUND",
        paymentMethod: "CASH",
        amount: 1500,
        paymentDate: new Date(todayStart.getTime() + 12 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    const summaryAfter = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const trendAfter = await request(app)
      .get(`/api/v1/reports/revenue-trend?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(summaryAfter.body.data.totalCollected - baseCollected).toBe(0);
    expect(summaryAfter.body.data.grossCollected - baseGross).toBe(0);
    expect(summaryAfter.body.data.refundsTotal - baseRefunds).toBe(0);

    const trendDayAfter = trendAfter.body.data.find((p: { label: string }) => true)?.collected ?? 0;
    expect(trendDayAfter - baseTrendDay).toBe(0);
  });

  it("test 5: date-range edge - refund in a later period than payment", async () => {
    // Baseline for yesterday, today, and combined
    const [yestSumBefore, todaySumBefore, combSumBefore, trendBefore] = await Promise.all([
      request(app).get(`/api/v1/reports/revenue-summary?from=${yesterday}&to=${yesterday}`).set("Authorization", `Bearer ${adminToken}`),
      request(app).get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`).set("Authorization", `Bearer ${adminToken}`),
      request(app).get(`/api/v1/reports/revenue-summary?from=${yesterday}&to=${today}`).set("Authorization", `Bearer ${adminToken}`),
      request(app).get(`/api/v1/reports/revenue-trend?from=${yesterday}&to=${today}`).set("Authorization", `Bearer ${adminToken}`),
    ]);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `REPRO-REV-${suffix}-5`,
        department: "RECEPTION",
        createdBy: adminId,
        status: "PARTIAL",
        grandTotal: 1000,
        paidAmount: 600,
        balanceAmount: 400,
        createdAt: new Date(yesterdayStart.getTime() + 10 * 60 * 60 * 1000),
      },
    });
    createdInvoiceIds.push(invoice.id);

    // Payment of 1000 yesterday
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "PAYMENT",
        paymentMethod: "CASH",
        amount: 1000,
        paymentDate: new Date(yesterdayStart.getTime() + 11 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    // Refund of 400 today
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "REFUND",
        paymentMethod: "CASH",
        amount: 400,
        reason: "Edge date refund",
        paymentDate: new Date(todayStart.getTime() + 11 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    const [yestSumAfter, todaySumAfter, combSumAfter, trendAfter] = await Promise.all([
      request(app).get(`/api/v1/reports/revenue-summary?from=${yesterday}&to=${yesterday}`).set("Authorization", `Bearer ${adminToken}`),
      request(app).get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`).set("Authorization", `Bearer ${adminToken}`),
      request(app).get(`/api/v1/reports/revenue-summary?from=${yesterday}&to=${today}`).set("Authorization", `Bearer ${adminToken}`),
      request(app).get(`/api/v1/reports/revenue-trend?from=${yesterday}&to=${today}`).set("Authorization", `Bearer ${adminToken}`),
    ]);

    // Yesterday: payment of 1000, refund of 0 -> collected = +1000
    expect(yestSumAfter.body.data.totalCollected - yestSumBefore.body.data.totalCollected).toBe(1000);
    expect(yestSumAfter.body.data.grossCollected - (yestSumBefore.body.data.grossCollected ?? 0)).toBe(1000);
    expect(yestSumAfter.body.data.refundsTotal - (yestSumBefore.body.data.refundsTotal ?? 0)).toBe(0);

    // Today: payment of 0, refund of 400 -> collected = -400
    expect(todaySumAfter.body.data.totalCollected - todaySumBefore.body.data.totalCollected).toBe(-400);
    expect(todaySumAfter.body.data.grossCollected - (todaySumBefore.body.data.grossCollected ?? 0)).toBe(0);
    expect(todaySumAfter.body.data.refundsTotal - (todaySumBefore.body.data.refundsTotal ?? 0)).toBe(400);

    // Combined yesterday-today: payment of 1000, refund of 400 -> collected = +600
    expect(combSumAfter.body.data.totalCollected - combSumBefore.body.data.totalCollected).toBe(600);
    expect(combSumAfter.body.data.grossCollected - (combSumBefore.body.data.grossCollected ?? 0)).toBe(1000);
    expect(combSumAfter.body.data.refundsTotal - (combSumBefore.body.data.refundsTotal ?? 0)).toBe(400);

    // Trend points
    expect(trendAfter.body.data).toHaveLength(2);
    const yestTrendDelta = trendAfter.body.data[0].collected - trendBefore.body.data[0].collected;
    const todayTrendDelta = trendAfter.body.data[1].collected - trendBefore.body.data[1].collected;
    expect(yestTrendDelta).toBe(1000);
    expect(todayTrendDelta).toBe(-400);
  });

  it("test 6: ultrasound overview - refunds are subtracted from todayCollected", async () => {
    const overviewBefore = await ultrasoundService.overview();
    const baseUltrasoundCollected = overviewBefore.stats.todayCollected;

    const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null } });
    const doctor = await prisma.doctor.findFirstOrThrow();

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `REPRO-REV-${suffix}-6`,
        department: "ULTRASOUND",
        createdBy: adminId,
        status: "PARTIAL",
        grandTotal: 500,
        paidAmount: 350,
        balanceAmount: 150,
        createdAt: new Date(todayStart.getTime() + 10 * 60 * 60 * 1000),
      },
    });
    createdInvoiceIds.push(invoice.id);

    const usOrder = await prisma.ultrasoundOrder.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        invoiceId: invoice.id,
        examType: "Pelvic Ultrasound",
        feeAmount: 500,
        createdAt: new Date(todayStart.getTime() + 10 * 60 * 60 * 1000),
      },
    });
    createdUltrasoundOrderIds.push(usOrder.id);

    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "PAYMENT",
        paymentMethod: "CASH",
        amount: 500,
        paymentDate: new Date(todayStart.getTime() + 11 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        type: "REFUND",
        paymentMethod: "CASH",
        amount: 150,
        reason: "Patient requested partial refund",
        paymentDate: new Date(todayStart.getTime() + 12 * 60 * 60 * 1000),
        createdBy: adminId,
      },
    });

    const overviewAfter = await ultrasoundService.overview();
    expect(overviewAfter.stats.todayCollected - baseUltrasoundCollected).toBe(350);
  });
});
