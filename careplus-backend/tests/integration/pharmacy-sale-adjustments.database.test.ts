import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const api = "/api/v1";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let token: string;
let fixture: { medicineId?: string; batchId?: string; saleId?: string; invoiceId?: string; saleItemId?: string } | undefined;
let reportAuditAfter: Date | undefined;

async function createSale() {
  const headers = { Authorization: `Bearer ${token}` };
  const medicineResponse = await request(app)
    .post(`${api}/pharmacy/medicines`)
    .set(headers)
    .send({ name: `Sale adjustment ${suffix}-${Math.random()}`, genericName: "Integration test" });
  expect(medicineResponse.status).toBe(201);
  const medicineId = medicineResponse.body.data.id as string;
  fixture = { medicineId };

  const batchResponse = await request(app)
    .post(`${api}/pharmacy/batches`)
    .set(headers)
    .send({ medicineId, batchNumber: `ADJ-${suffix}-${Math.random()}`, expiryDate: "2028-12-31", purchasePrice: 20, sellingPrice: 100, stockQuantity: 10 });
  expect(batchResponse.status).toBe(201);
  const batchId = batchResponse.body.data.id as string;
  fixture = { medicineId, batchId };

  const saleResponse = await request(app)
    .post(`${api}/pharmacy/sales`)
    .set(headers)
    .send({ items: [{ medicineId, quantity: 4 }], tax: 0, paymentMethod: "CASH", customerName: "Sale adjustment test" });
  expect(saleResponse.status).toBe(201);
  const saleId = saleResponse.body.data.id as string;
  const invoiceId = saleResponse.body.data.invoice.id as string;
  const saleItemId = saleResponse.body.data.items[0].id as string;
  fixture = { medicineId, batchId, saleId, invoiceId, saleItemId };
  return { headers, medicineId, batchId, saleId, invoiceId, saleItemId, cashierName: saleResponse.body.data.cashier.name as string, invoiceNumber: saleResponse.body.data.invoice.invoiceNumber as string };
}

describe("pharmacy sale void and return workflows", () => {
  beforeAll(async () => {
    const login = await request(app).post(`${api}/auth/login`).send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(login.status).toBe(200);
    token = login.body.data.accessToken as string;
  });

  afterEach(async () => {
    if (reportAuditAfter) {
      await prisma.auditLog.deleteMany({
        where: { module: "pharmacy", entityType: { in: ["PharmacyReport", "PharmacyOverview"] }, createdAt: { gte: reportAuditAfter } },
      });
      reportAuditAfter = undefined;
    }
    if (!fixture) return;
    const current = fixture;
    const adjustments = current.saleId
      ? await prisma.pharmacySaleAdjustment.findMany({ where: { saleId: current.saleId }, select: { id: true } })
      : [];
    const entityIds = [current.medicineId, current.batchId, current.saleId, current.invoiceId, ...adjustments.map((item) => item.id)].filter((id): id is string => Boolean(id));
    if (adjustments.length) await prisma.pharmacySaleAdjustmentItem.deleteMany({ where: { adjustmentId: { in: adjustments.map((item) => item.id) } } });
    if (current.batchId) await prisma.stockMovement.deleteMany({ where: { batchId: current.batchId } });
    if (current.invoiceId) {
      await prisma.discountAudit.deleteMany({ where: { invoiceId: current.invoiceId } });
      await prisma.payment.deleteMany({ where: { invoiceId: current.invoiceId } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: current.invoiceId } });
    }
    if (current.saleId) {
      await prisma.pharmacySaleAdjustment.deleteMany({ where: { saleId: current.saleId } });
      await prisma.pharmacySaleItem.deleteMany({ where: { saleId: current.saleId } });
      await prisma.pharmacySale.delete({ where: { id: current.saleId } });
    }
    if (current.invoiceId) await prisma.invoice.delete({ where: { id: current.invoiceId } });
    if (entityIds.length) await prisma.auditLog.deleteMany({ where: { module: "pharmacy", entityId: { in: entityIds } } });
    if (current.batchId) await prisma.medicineBatch.delete({ where: { id: current.batchId } });
    if (current.medicineId) await prisma.medicine.delete({ where: { id: current.medicineId } });
    fixture = undefined;
  });

  afterAll(() => {
    redis.disconnect();
  });

  it("rejects a second void and restores original-batch stock exactly once", async () => {
    const { headers, batchId, invoiceId, cashierName, invoiceNumber } = await createSale();
    const list = await request(app).get(`${api}/pharmacy/invoices?search=${encodeURIComponent(invoiceNumber)}`).set(headers);
    expect(list.status).toBe(200);
    expect(list.body.data.items[0].cashier.name).toBe(cashierName);
    expect(list.body.data.items[0].invoice.id).toBe(invoiceId);
    const details = await request(app).get(`${api}/pharmacy/invoices/${invoiceId}`).set(headers);
    expect(details.status).toBe(200);
    expect(details.body.data.pharmacySale.cashier.name).toBe(cashierName);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(6);

    const missingReason = await request(app).post(`${api}/pharmacy/invoices/${invoiceId}/void`).set(headers).send({ reason: " " });
    expect(missingReason.status).toBe(422);
    const billingVoid = await request(app).post(`${api}/billing/invoices/${invoiceId}/void`).set(headers).send({ reason: "Must use pharmacy workflow" });
    expect(billingVoid.status).toBe(409);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(6);

    const voided = await request(app).post(`${api}/pharmacy/invoices/${invoiceId}/void`).set(headers).send({ reason: "Duplicate sale" });
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe("VOID");
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(10);

    const repeated = await request(app).post(`${api}/pharmacy/invoices/${invoiceId}/void`).set(headers).send({ reason: "Try twice" });
    expect(repeated.status).toBe(409);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(10);
    expect(await prisma.stockMovement.count({ where: { batchId, movementType: "VOID" } })).toBe(1);
  });

  it("excludes pharmacy sales outside the selected report date range", async () => {
    const { headers, saleId } = await createSale();
    await prisma.pharmacySale.update({ where: { id: saleId }, data: { createdAt: new Date("2020-04-15T12:00:00.000+05:00") } });
    reportAuditAfter = new Date();

    const invalidRange = await request(app)
      .get(`${api}/pharmacy/reports?period=custom&from=2020-04-17&to=2020-04-16`)
      .set(headers);
    expect(invalidRange.status).toBe(400);

    const response = await request(app)
      .get(`${api}/pharmacy/reports?period=custom&from=2020-04-16&to=2020-04-16`)
      .set(headers);

    expect(response.status).toBe(200);
    expect(response.body.data.dateRange).toEqual({ from: "2020-04-16", to: "2020-04-16" });
    expect(response.body.data.summary.transactions).toBe(0);
    expect(response.body.data.summary.totalSalesRevenue).toBe(0);
    expect(response.body.data.summary.discountsGiven).toBe(0);
    expect(response.body.data.categories.pagination.total).toBe(0);
    expect(response.body.data.topMedicines.pagination.total).toBe(0);
  });

  it("returns backend overview totals and updates sales, stock value, and recent sales after sale adjustments", async () => {
    const { headers, batchId, invoiceId, invoiceNumber } = await createSale();
    reportAuditAfter = new Date(Date.now() - 5000);

    const afterSale = await request(app).get(`${api}/pharmacy/overview`).set(headers);
    expect(afterSale.status).toBe(200);
    expect(afterSale.body.data.today.sales).toBeGreaterThanOrEqual(400);
    expect(afterSale.body.data.today.transactions).toBeGreaterThanOrEqual(1);
    expect(afterSale.body.data.lowStock.count).toBeGreaterThanOrEqual(1);
    expect(afterSale.body.data.inventoryValue.cost).toBeGreaterThan(0);
    expect(afterSale.body.data.inventoryValue.selling).toBeGreaterThan(afterSale.body.data.inventoryValue.cost);
    expect(afterSale.body.data.recentSales.some((sale: { invoiceNumber: string }) => sale.invoiceNumber === invoiceNumber)).toBe(true);

    const baselineSales = afterSale.body.data.today.sales as number;
    const baselineTransactions = afterSale.body.data.today.transactions as number;
    const returned = await request(app)
      .post(`${api}/pharmacy/invoices/${invoiceId}/returns`)
      .set(headers)
      .send({ reason: "Overview return", items: [{ saleItemId: fixture?.saleItemId, quantity: 1, returnToStock: true }] });
    expect(returned.status).toBe(201);
    const afterReturn = await request(app).get(`${api}/pharmacy/overview`).set(headers);
    expect(afterReturn.body.data.today.sales).toBe(baselineSales - 100);
    expect(afterReturn.body.data.inventoryValue.cost - afterSale.body.data.inventoryValue.cost).toBe(20);
    expect(afterReturn.body.data.inventoryValue.selling - afterSale.body.data.inventoryValue.selling).toBe(100);

    const voided = await request(app)
      .post(`${api}/pharmacy/invoices/${invoiceId}/void`)
      .set(headers)
      .send({ reason: "Overview void" });
    expect(voided.status).toBe(200);
    const afterVoid = await request(app).get(`${api}/pharmacy/overview`).set(headers);
    expect(afterVoid.body.data.today.sales).toBe(baselineSales - 400);
    expect(afterVoid.body.data.today.transactions).toBe(baselineTransactions - 1);
    expect(afterVoid.body.data.recentSales.some((sale: { invoiceNumber: string }) => sale.invoiceNumber === invoiceNumber)).toBe(false);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(10);
  });

  it("rejects over-returns and tracks restock choice without overstating stock", async () => {
    const { headers, batchId, invoiceId, saleItemId } = await createSale();
    const returned = await request(app)
      .post(`${api}/pharmacy/invoices/${invoiceId}/returns`)
      .set(headers)
      .send({ reason: "Partial return", items: [{ saleItemId, quantity: 3, returnToStock: true }] });
    expect(returned.status).toBe(201);
    expect(Number(returned.body.data.refundAmount)).toBe(300);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(9);

    const excess = await request(app)
      .post(`${api}/pharmacy/invoices/${invoiceId}/returns`)
      .set(headers)
      .send({ reason: "Over return", items: [{ saleItemId, quantity: 2, returnToStock: true }] });
    expect(excess.status).toBe(400);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(9);

    const damaged = await request(app)
      .post(`${api}/pharmacy/invoices/${invoiceId}/returns`)
      .set(headers)
      .send({ reason: "Damaged packaging", items: [{ saleItemId, quantity: 1, returnToStock: false }] });
    expect(damaged.status).toBe(201);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(9);
    expect(await prisma.stockMovement.count({ where: { batchId, movementType: "RETURN" } })).toBe(2);
  });

  it("voids after a partial return without restoring the returned quantity twice", async () => {
    const { headers, batchId, invoiceId, saleItemId } = await createSale();
    const returned = await request(app)
      .post(`${api}/pharmacy/invoices/${invoiceId}/returns`)
      .set(headers)
      .send({ reason: "Restockable return", items: [{ saleItemId, quantity: 2, returnToStock: true }] });
    expect(returned.status).toBe(201);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(8);

    const voided = await request(app)
      .post(`${api}/pharmacy/invoices/${invoiceId}/void`)
      .set(headers)
      .send({ reason: "Cancel remaining sale" });
    expect(voided.status).toBe(200);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(10);
    const voidMovement = await prisma.stockMovement.findFirstOrThrow({ where: { batchId, movementType: "VOID" } });
    expect(voidMovement.quantity).toBe(2);
  });
});
