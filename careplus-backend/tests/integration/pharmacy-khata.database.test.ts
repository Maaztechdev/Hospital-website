import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const api = "/api/v1";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let token: string;
let fixture: { medicineId?: string; batchId?: string; saleId?: string; invoiceId?: string; accountIds: string[] } = { accountIds: [] };

async function createCreditSale(paidNow: number) {
  const headers = { Authorization: `Bearer ${token}` };
  const medicineResponse = await request(app)
    .post(`${api}/pharmacy/medicines`)
    .set(headers)
    .send({ name: `Khata test medicine ${suffix}` });
  expect(medicineResponse.status).toBe(201);
  const medicineId = medicineResponse.body.data.id as string;
  fixture.medicineId = medicineId;

  const batchResponse = await request(app)
    .post(`${api}/pharmacy/batches`)
    .set(headers)
    .send({ medicineId, batchNumber: `KH-${suffix}`, expiryDate: "2028-12-31", purchasePrice: 20, sellingPrice: 100, stockQuantity: 10 });
  expect(batchResponse.status).toBe(201);
  fixture.batchId = batchResponse.body.data.id as string;

  const customerPhone = `KH${suffix}`;
  const saleResponse = await request(app)
    .post(`${api}/pharmacy/sales`)
    .set(headers)
    .send({
      items: [{ medicineId, quantity: 2 }],
      tax: 0,
      paymentMethod: "CREDIT",
      paidNow,
      paidNowMethod: "CASH",
      customerName: `Khata customer ${suffix}`,
      customerPhone,
    });
  expect(saleResponse.status).toBe(201);
  fixture.saleId = saleResponse.body.data.id as string;
  fixture.invoiceId = saleResponse.body.data.invoice.id as string;
  const account = await prisma.pharmacyLedgerAccount.findFirstOrThrow({ where: { customerPhone } });
  fixture.accountIds.push(account.id);
  return { headers, accountId: account.id, invoiceId: fixture.invoiceId };
}

describe("pharmacy customer and payable Khata", () => {
  beforeAll(async () => {
    const login = await request(app).post(`${api}/auth/login`).send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(login.status).toBe(200);
    token = login.body.data.accessToken as string;
  });

  afterEach(async () => {
    const current = fixture;
    const accountEntries = current.accountIds.length
      ? await prisma.pharmacyLedgerEntry.findMany({ where: { accountId: { in: current.accountIds } }, select: { id: true } })
      : [];
    const entityIds = [current.medicineId, current.batchId, current.saleId, current.invoiceId, ...current.accountIds, ...accountEntries.map(({ id }) => id)].filter((id): id is string => Boolean(id));
    if (accountEntries.length) await prisma.pharmacyLedgerEntry.deleteMany({ where: { id: { in: accountEntries.map(({ id }) => id) } } });
    if (current.accountIds.length) await prisma.pharmacyLedgerAccount.deleteMany({ where: { id: { in: current.accountIds } } });
    if (current.batchId) await prisma.stockMovement.deleteMany({ where: { batchId: current.batchId } });
    if (current.invoiceId) {
      await prisma.discountAudit.deleteMany({ where: { invoiceId: current.invoiceId } });
      await prisma.payment.deleteMany({ where: { invoiceId: current.invoiceId } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: current.invoiceId } });
    }
    if (current.saleId) {
      await prisma.pharmacySaleItem.deleteMany({ where: { saleId: current.saleId } });
      await prisma.pharmacySale.delete({ where: { id: current.saleId } });
    }
    if (current.invoiceId) await prisma.invoice.delete({ where: { id: current.invoiceId } });
    if (entityIds.length) await prisma.auditLog.deleteMany({ where: { module: "pharmacy", entityId: { in: entityIds } } });
    if (current.batchId) await prisma.medicineBatch.delete({ where: { id: current.batchId } });
    if (current.medicineId) await prisma.medicine.delete({ where: { id: current.medicineId } });
    fixture = { accountIds: [] };
  });

  afterAll(() => {
    redis.disconnect();
  });

  it("records partial payment and sale-on-credit with correct running balance, then rejects overpayment", async () => {
    const { headers, accountId, invoiceId } = await createCreditSale(50);
    const sale = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: true } });
    expect(sale.status).toBe("PARTIAL");
    expect(Number(sale.grandTotal)).toBe(200);
    expect(Number(sale.paidAmount)).toBe(50);
    expect(Number(sale.balanceAmount)).toBe(150);
    expect(Number(sale.payments.reduce((sum, payment) => sum + Number(payment.amount), 0))).toBe(50);

    const received = await request(app)
      .post(`${api}/pharmacy/khata/accounts/${accountId}/payments`)
      .set(headers)
      .send({ amount: 25, paymentMethod: "CASH", notes: "Test part payment" });
    expect(received.status).toBe(201);
    expect(Number(received.body.data.balance)).toBe(125);
    expect(received.body.data.entry.type).toBe("PAYMENT_RECEIVED");
    expect(Number(received.body.data.entry.amount)).toBe(-25);

    const ledger = await request(app).get(`${api}/pharmacy/khata/accounts/${accountId}`).set(headers);
    expect(ledger.status).toBe(200);
    expect(Number(ledger.body.data.balance)).toBe(125);
    expect(Number(ledger.body.data.entries[0].balanceAfter)).toBe(125);

    const updatedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(Number(updatedInvoice.paidAmount)).toBe(75);
    expect(Number(updatedInvoice.balanceAmount)).toBe(125);

    const overpayment = await request(app)
      .post(`${api}/pharmacy/khata/accounts/${accountId}/payments`)
      .set(headers)
      .send({ amount: 125.01, paymentMethod: "CASH" });
    expect(overpayment.status).toBe(400);
    expect(Number((await prisma.pharmacyLedgerEntry.aggregate({ where: { accountId }, _sum: { amount: true } }))._sum.amount)).toBe(125);
  });

  it("tracks payable adjustments and supplier payments in the same ledger model", async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const created = await request(app)
      .post(`${api}/pharmacy/khata/accounts`)
      .set(headers)
      .send({ type: "PAYABLE", customerName: `Khata supplier ${suffix}`, customerPhone: `SUP${suffix}` });
    expect(created.status).toBe(201);
    const accountId = created.body.data.id as string;
    fixture.accountIds.push(accountId);

    const adjustment = await request(app)
      .post(`${api}/pharmacy/khata/accounts/${accountId}/adjustments`)
      .set(headers)
      .send({ amount: 80, notes: "Supplier invoice received" });
    expect(adjustment.status).toBe(201);
    expect(Number(adjustment.body.data.balance)).toBe(80);

    const payment = await request(app)
      .post(`${api}/pharmacy/khata/accounts/${accountId}/payments`)
      .set(headers)
      .send({ amount: 30, paymentMethod: "BANK_TRANSFER" });
    expect(payment.status).toBe(201);
    expect(payment.body.data.entry.type).toBe("PAYMENT_MADE");
    expect(Number(payment.body.data.balance)).toBe(50);
  });
});
