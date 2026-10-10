import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const api = "/api/v1";
const settingKeys = [
  "pharmacyName",
  "pharmacyAddress",
  "pharmacyPhone",
  "pharmacyCurrency",
  "pharmacyDefaultReceiptFormat",
  "cashierMaxDiscountPercent",
  "pharmacyLossAlertThreshold",
  "pharmacyDefaultLowStockLevel",
];

describe("pharmacy settings", () => {
  let adminHeaders: { Authorization: string };
  let pharmacistHeaders: { Authorization: string };
  let originalSettings: { key: string; value: unknown }[] = [];
  let originalSecurity: Awaited<ReturnType<typeof prisma.pharmacySecurity.findUnique>>;

  beforeAll(async () => {
    const [admin, pharmacist] = await Promise.all([
      request(app).post(`${api}/auth/login`).send({ email: "admin@careplus.local", password: "Admin@12345" }),
      request(app).post(`${api}/auth/login`).send({ email: "pharmacist@careplus.local", password: "Staff@12345" }),
    ]);
    expect(admin.status).toBe(200);
    expect(pharmacist.status).toBe(200);
    adminHeaders = { Authorization: `Bearer ${admin.body.data.accessToken}` };
    pharmacistHeaders = { Authorization: `Bearer ${pharmacist.body.data.accessToken}` };
    originalSettings = await prisma.setting.findMany({ where: { key: { in: settingKeys } } });
    originalSecurity = await prisma.pharmacySecurity.findUnique({ where: { id: "default" } });
  });

  afterAll(async () => {
    await prisma.$transaction(async (tx) => {
      for (const key of settingKeys) {
        const original = originalSettings.find((setting) => setting.key === key);
        if (original) await tx.setting.upsert({ where: { key }, create: { key, value: original.value as never }, update: { value: original.value as never } });
        else await tx.setting.deleteMany({ where: { key } });
      }
      if (originalSecurity) {
        await tx.pharmacySecurity.upsert({
          where: { id: "default" },
          create: { id: originalSecurity.id, pinHash: originalSecurity.pinHash, pinAdminId: originalSecurity.pinAdminId },
          update: { pinHash: originalSecurity.pinHash, pinAdminId: originalSecurity.pinAdminId },
        });
      } else {
        await tx.pharmacySecurity.deleteMany({ where: { id: "default" } });
      }
      await tx.auditLog.deleteMany({
        where: {
          module: "pharmacy",
          OR: [
            { entityType: "PharmacySetting", entityId: { in: settingKeys } },
            { entityType: "PharmacySecurity", entityId: "default" },
          ],
        },
      });
    });
    redis.disconnect();
  });

  it("restricts changes to Admins, audits each setting, and never returns a PIN hash", async () => {
    const read = await request(app).get(`${api}/pharmacy/settings`).set(pharmacistHeaders);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ currency: "PKR", cashierMaxDiscountPercent: expect.anything(), adminPinConfigured: expect.any(Boolean) });
    expect(JSON.stringify(read.body)).not.toMatch(/pinHash|pin_hash|pinAdminId|pin_admin_id/i);

    const settings = {
      name: "Settings test pharmacy",
      address: "Test address",
      phone: "03001234567",
      currency: "PKR",
      defaultReceiptFormat: "receipt",
      cashierMaxDiscountPercent: 7,
      lossAlertThreshold: 100,
      defaultLowStockLevel: 6,
    };
    const denied = await request(app).put(`${api}/pharmacy/settings`).set(pharmacistHeaders).send(settings);
    expect(denied.status).toBe(403);
    const updated = await request(app).put(`${api}/pharmacy/settings`).set(adminHeaders).send(settings);
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject(settings);
    const audits = await prisma.auditLog.findMany({
      where: { module: "pharmacy", entityType: "PharmacySetting", entityId: { in: settingKeys } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(settingKeys.length - 1);
  });

  it("hashes the Admin PIN, requires the current PIN for changes, and only returns configured state", async () => {
    const pin = "764219";
    const initial = await request(app).put(`${api}/pharmacy/settings/admin-pin`).set(adminHeaders).send({ newPin: pin });
    expect(initial.status).toBe(200);
    expect(initial.body.data).toEqual({ adminPinConfigured: true });
    const stored = await prisma.pharmacySecurity.findUniqueOrThrow({ where: { id: "default" } });
    expect(stored.pinHash).not.toBe(pin);
    expect(await argon2.verify(stored.pinHash, pin)).toBe(true);

    const missingCurrent = await request(app).put(`${api}/pharmacy/settings/admin-pin`).set(adminHeaders).send({ newPin: "875310" });
    expect(missingCurrent.status).toBe(400);
    const wrongCurrent = await request(app).put(`${api}/pharmacy/settings/admin-pin`).set(adminHeaders).send({ currentPin: "111111", newPin: "875310" });
    expect(wrongCurrent.status).toBe(403);
    const changed = await request(app).put(`${api}/pharmacy/settings/admin-pin`).set(adminHeaders).send({ currentPin: pin, newPin: "875310" });
    expect(changed.status).toBe(200);
    expect(JSON.stringify(changed.body)).not.toMatch(/pinHash|pin_hash|875310|764219/i);

    let medicineId: string | undefined;
    let batchId: string | undefined;
    let saleId: string | undefined;
    let invoiceId: string | undefined;
    try {
      const createdMedicine = await request(app).post(`${api}/pharmacy/medicines`).set(pharmacistHeaders).send({ name: `PIN approval test ${Date.now()}` });
      expect(createdMedicine.status).toBe(201);
      medicineId = createdMedicine.body.data.id as string;
      const createdBatch = await request(app).post(`${api}/pharmacy/batches`).set(pharmacistHeaders).send({
        medicineId,
        batchNumber: `PIN-${Date.now()}`,
        expiryDate: "2028-12-31",
        purchasePrice: 200,
        sellingPrice: 100,
        stockQuantity: 2,
      });
      expect(createdBatch.status).toBe(201);
      batchId = createdBatch.body.data.id as string;
      const sale = await request(app)
        .post(`${api}/pharmacy/sales`)
        .set(pharmacistHeaders)
        .set("X-Discount-Approval-Pin", "875310")
        .send({
          items: [{ medicineId, quantity: 1, discount: 20 }],
          tax: 0,
          paymentMethod: "CASH",
          discountReason: "Approved clearance discount",
        });
      expect(sale.status).toBe(201);
      saleId = sale.body.data.id as string;
      invoiceId = sale.body.data.invoice.id as string;
      const discountAudit = await prisma.discountAudit.findFirstOrThrow({ where: { invoiceId } });
      expect(discountAudit.approvingAdminId).toBe((await prisma.pharmacySecurity.findUniqueOrThrow({ where: { id: "default" } })).pinAdminId);
      expect(await prisma.notification.count({ where: { relatedEntityId: saleId, notificationType: "PHARMACY_LOSS_ALERT" } })).toBeGreaterThan(0);
    } finally {
      if (saleId) await prisma.notification.deleteMany({ where: { relatedEntityId: saleId, notificationType: "PHARMACY_LOSS_ALERT" } });
      if (invoiceId) {
        await prisma.discountAudit.deleteMany({ where: { invoiceId } });
        await prisma.payment.deleteMany({ where: { invoiceId } });
        await prisma.invoiceItem.deleteMany({ where: { invoiceId } });
      }
      if (saleId) await prisma.pharmacySaleItem.deleteMany({ where: { saleId } });
      if (saleId) await prisma.pharmacySale.deleteMany({ where: { id: saleId } });
      if (invoiceId) await prisma.invoice.deleteMany({ where: { id: invoiceId } });
      if (batchId) {
        await prisma.auditLog.deleteMany({ where: { module: "pharmacy", entityId: { in: [batchId, medicineId ?? ""] } } });
        await prisma.stockMovement.deleteMany({ where: { batchId } });
        await prisma.medicineBatch.deleteMany({ where: { id: batchId } });
      }
      if (medicineId) await prisma.medicine.deleteMany({ where: { id: medicineId } });
      if (saleId) await prisma.auditLog.deleteMany({ where: { module: "pharmacy", entityId: saleId } });
    }
  });
});
