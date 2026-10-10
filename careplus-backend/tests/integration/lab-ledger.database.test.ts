import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const api = "/api/v1";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let headers: { Authorization: string };
let patientId: string;
let fixture: { accountIds: string[]; supplierId?: string; testId?: string; invoiceId?: string; orderIds: string[] } = {
  accountIds: [],
  orderIds: [],
};

describe("Lab receivable and send-out payable ledger", () => {
  beforeAll(async () => {
    const login = await request(app).post(`${api}/auth/login`).send({
      email: "admin@careplus.local",
      password: "Admin@12345",
    });
    expect(login.status).toBe(200);
    headers = { Authorization: `Bearer ${login.body.data.accessToken as string}` };
    const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    patientId = patient.id;
  });

  afterEach(async () => {
    const current = fixture;
    if (current.accountIds.length || current.orderIds.length) {
      await prisma.labLedgerEntry.deleteMany({
        where: {
          OR: [
            ...(current.accountIds.length ? [{ accountId: { in: current.accountIds } }] : []),
            ...(current.orderIds.length ? [{ labOrderId: { in: current.orderIds } }] : []),
          ],
        },
      });
    }
    if (current.orderIds.length) {
      await prisma.labOrderEvent.deleteMany({ where: { labOrderId: { in: current.orderIds } } });
      await prisma.labOrder.deleteMany({ where: { id: { in: current.orderIds } } });
    }
    if (current.invoiceId) {
      await prisma.payment.deleteMany({ where: { invoiceId: current.invoiceId } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: current.invoiceId } });
      await prisma.invoice.delete({ where: { id: current.invoiceId } });
    }
    if (current.testId) await prisma.labTest.delete({ where: { id: current.testId } });
    if (current.accountIds.length) await prisma.labLedgerAccount.deleteMany({ where: { id: { in: current.accountIds } } });
    if (current.supplierId) await prisma.supplier.delete({ where: { id: current.supplierId } });
    const ids = [...current.accountIds, ...current.orderIds, ...(current.testId ? [current.testId] : []), ...(current.invoiceId ? [current.invoiceId] : [])];
    if (ids.length) await prisma.auditLog.deleteMany({ where: { module: { in: ["lab", "billing"] }, entityId: { in: ids } } });
    fixture = { accountIds: [], orderIds: [] };
  });

  afterAll(() => {
    redis.disconnect();
  });

  it("posts clinic invoices and send-out costs, then clears them with linked payments", async () => {
    const clinicResponse = await request(app)
      .post(`${api}/lab/ledger/accounts`)
      .set(headers)
      .send({ partyType: "CLINIC", partyName: `Ledger Clinic ${suffix}` });
    expect(clinicResponse.status).toBe(201);
    const clinicAccountId = clinicResponse.body.data.id as string;
    fixture.accountIds.push(clinicAccountId);

    const referenceLabResponse = await request(app)
      .post(`${api}/lab/ledger/accounts`)
      .set(headers)
      .send({ partyType: "REFERENCE_LAB", partyName: `Ledger Reference Lab ${suffix}` });
    expect(referenceLabResponse.status).toBe(201);
    const referenceLabAccountId = referenceLabResponse.body.data.id as string;
    fixture.accountIds.push(referenceLabAccountId);
    fixture.supplierId = referenceLabResponse.body.data.supplierId as string;

    const testResponse = await request(app)
      .post(`${api}/lab/tests`)
      .set(headers)
      .send({
        testName: `Send-out assay ${suffix}`,
        testCode: `SO${Date.now()}`,
        price: 200,
        isSendOut: true,
        referenceLabSupplierId: fixture.supplierId,
        sendOutCost: 40,
      });
    expect(testResponse.status).toBe(201);
    fixture.testId = testResponse.body.data.id as string;

    const orderResponse = await request(app)
      .post(`${api}/lab/orders`)
      .set(headers)
      .send({
        patientId,
        testId: fixture.testId,
        referringClinicAccountId: clinicAccountId,
      });
    expect(orderResponse.status).toBe(201);
    fixture.orderIds.push(orderResponse.body.data.id as string);
    fixture.invoiceId = orderResponse.body.data.invoice.id as string;

    const clinicLedger = await request(app).get(`${api}/lab/ledger/accounts/${clinicAccountId}`).set(headers);
    expect(clinicLedger.status).toBe(200);
    expect(Number(clinicLedger.body.data.balance)).toBe(200);
    expect(clinicLedger.body.data.entries[0].invoice.invoiceNumber).toBe(orderResponse.body.data.invoice.invoiceNumber);

    const referenceLedger = await request(app).get(`${api}/lab/ledger/accounts/${referenceLabAccountId}`).set(headers);
    expect(referenceLedger.status).toBe(200);
    expect(Number(referenceLedger.body.data.balance)).toBe(40);
    expect(referenceLedger.body.data.entries[0].labOrder.orderNumber).toBe(orderResponse.body.data.orderNumber);

    const receivePayment = await request(app)
      .post(`${api}/lab/ledger/accounts/${clinicAccountId}/payments`)
      .set(headers)
      .send({ amount: 50, paymentMethod: "CASH" });
    expect(receivePayment.status).toBe(201);
    expect(Number(receivePayment.body.data.balance)).toBe(150);

    const remainingInvoicePayment = await request(app)
      .post(`${api}/billing/invoices/${fixture.invoiceId}/payments`)
      .set(headers)
      .send({ amount: 150, paymentMethod: "CARD" });
    expect(remainingInvoicePayment.status).toBe(200);
    const clinicLedgerAfterPayment = await request(app).get(`${api}/lab/ledger/accounts/${clinicAccountId}`).set(headers);
    expect(Number(clinicLedgerAfterPayment.body.data.balance)).toBe(0);

    const payReferenceLab = await request(app)
      .post(`${api}/lab/ledger/accounts/${referenceLabAccountId}/payments`)
      .set(headers)
      .send({ amount: 40, paymentMethod: "BANK_TRANSFER" });
    expect(payReferenceLab.status).toBe(201);
    expect(Number(payReferenceLab.body.data.balance)).toBe(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: fixture.invoiceId } })).status).toBe("PAID");
  });
});
