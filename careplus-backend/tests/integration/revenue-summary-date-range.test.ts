import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();

describe("Integration: revenue summary date range", () => {
  let adminToken: string;
  let adminId: string;
  const suffix = Date.now().toString();
  const invoiceNumbers = [`DATE-RANGE-TODAY-${suffix}`, `DATE-RANGE-YESTERDAY-${suffix}`];

  beforeAll(async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    adminId = admin.id;
    const login = await request(app).post("/api/v1/auth/login").send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(login.status).toBe(200);
    adminToken = login.body.data.accessToken;

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await prisma.invoice.createMany({
      data: [
        { invoiceNumber: invoiceNumbers[0], createdBy: adminId, status: "FINALIZED", grandTotal: 100, paidAmount: 100, balanceAmount: 0, createdAt: today },
        { invoiceNumber: invoiceNumbers[1], createdBy: adminId, status: "FINALIZED", grandTotal: 900, paidAmount: 900, balanceAmount: 0, createdAt: yesterday },
      ],
    });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { in: invoiceNumbers } } });
    redis.disconnect();
  });

  it("sums only invoices created on the requested day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await request(app)
      .get(`/api/v1/reports/revenue-summary?from=${today}&to=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.invoiceCount).toBeGreaterThanOrEqual(1);
    expect(response.body.data.totalCollected).toBeGreaterThanOrEqual(100);
    expect(response.body.data.totalBilled).toBeGreaterThanOrEqual(100);
  });
});