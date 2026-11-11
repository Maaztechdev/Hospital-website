import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";

const app = createApp();
const api = "/api/v1";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let token: string;
let fixture: {
  medicineId?: string;
  batchId?: string;
  saleId?: string;
  invoiceId?: string;
  patientId?: string;
  consultationInvoiceId?: string;
} = {};

describe("Pharmacy billing bypass guard", () => {
  beforeAll(async () => {
    const login = await request(app).post(`${api}/auth/login`).send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(login.status).toBe(200);
    token = login.body.data.accessToken as string;

    // Create a patient for testing
    const patientRes = await request(app)
      .post(`${api}/patients`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: `BypassGuard_${suffix}`,
        lastName: "Patient",
        gender: "MALE",
        age: 30,
        phone: `03${Math.floor(100000000 + Math.random() * 900000000).toString().slice(0, 9)}`,
        force: true,
      });
    expect(patientRes.status).toBe(201);
    fixture.patientId = patientRes.body.data.id;

    // Create medicine and batch
    const medRes = await request(app)
      .post(`${api}/pharmacy/medicines`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `BypassMed_${suffix}`, genericName: "Test" });
    expect(medRes.status).toBe(201);
    fixture.medicineId = medRes.body.data.id;

    const batchRes = await request(app)
      .post(`${api}/pharmacy/batches`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        medicineId: fixture.medicineId,
        batchNumber: `BATCH-${suffix}`,
        expiryDate: "2029-12-31",
        purchasePrice: 50,
        sellingPrice: 100,
        stockQuantity: 20,
      });
    expect(batchRes.status).toBe(201);
    fixture.batchId = batchRes.body.data.id;

    // Create a credit sale in pharmacy (generates invoice + pharmacySale + pharmacyLedgerEntry)
    const saleRes = await request(app)
      .post(`${api}/pharmacy/sales`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [{ medicineId: fixture.medicineId, quantity: 2 }],
        paymentMethod: "CREDIT",
        paidNow: 0,
        customerName: `Khata Customer ${suffix}`,
        customerPhone: "03009998877",
        tax: 0,
      });
    expect(saleRes.status).toBe(201);
    fixture.saleId = saleRes.body.data.id;
    fixture.invoiceId = saleRes.body.data.invoice.id;

    // Create a regular consultation invoice
    const consultInvoiceRes = await request(app)
      .post(`${api}/billing/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        patientId: fixture.patientId,
        department: "RECEPTION",
        items: [
          {
            itemType: "CONSULTATION",
            description: "General Consultation",
            quantity: 1,
            unitPrice: 500,
            discount: 0,
          },
        ],
      });
    expect(consultInvoiceRes.status).toBe(201);
    fixture.consultationInvoiceId = consultInvoiceRes.body.data.id;
  });

  afterAll(async () => {
    // Clean up created resources in reverse dependency order
    if (fixture.consultationInvoiceId) {
      await prisma.payment.deleteMany({ where: { invoiceId: fixture.consultationInvoiceId } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: fixture.consultationInvoiceId } });
      await prisma.invoice.deleteMany({ where: { id: fixture.consultationInvoiceId } });
    }
    if (fixture.saleId) {
      const sale = await prisma.pharmacySale.findUnique({ where: { id: fixture.saleId } });
      if (sale) {
        await prisma.pharmacyLedgerEntry.deleteMany({ where: { invoiceId: sale.invoiceId } });
        await prisma.payment.deleteMany({ where: { invoiceId: sale.invoiceId } });
        await prisma.pharmacySaleItem.deleteMany({ where: { saleId: sale.id } });
        await prisma.pharmacySale.deleteMany({ where: { id: sale.id } });
        await prisma.invoiceItem.deleteMany({ where: { invoiceId: sale.invoiceId } });
        await prisma.invoice.deleteMany({ where: { id: sale.invoiceId } });
      }
    }
    if (fixture.batchId) {
      await prisma.stockMovement.deleteMany({ where: { batchId: fixture.batchId } });
      await prisma.medicineBatch.deleteMany({ where: { id: fixture.batchId } });
    }
    if (fixture.medicineId) {
      await prisma.medicine.deleteMany({ where: { id: fixture.medicineId } });
    }
    if (fixture.patientId) {
      await prisma.patient.deleteMany({ where: { id: fixture.patientId } });
    }
  });

  it("allows cashier payment collection against an existing pharmacy credit invoice", async () => {
    const res = await request(app)
      .post(`${api}/billing/invoices/${fixture.invoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        paymentMethod: "CASH",
        amount: 50,
      });

    expect(res.status).toBe(200);
    expect(Number(res.body.data.paidAmount)).toBe(50);
    expect(Number(res.body.data.balanceAmount)).toBe(150);
  });

  it("guards POST /billing/invoices against direct medicine billing (409 Conflict)", async () => {
    const res = await request(app)
      .post(`${api}/billing/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        patientId: fixture.patientId,
        department: "RECEPTION",
        items: [
          {
            itemType: "MEDICINE",
            description: "Direct Billed Medicine",
            quantity: 1,
            unitPrice: 100,
            discount: 0,
          },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.error?.message || res.body.message).toMatch(
      /Pharmacy medicines must be billed through the pharmacy module/i
    );
  });

  it("allows legitimate non-pharmacy payments via POST /billing/invoices/:id/payments", async () => {
    const res = await request(app)
      .post(`${api}/billing/invoices/${fixture.consultationInvoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        paymentMethod: "CASH",
        amount: 500,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PAID");
  });
});
