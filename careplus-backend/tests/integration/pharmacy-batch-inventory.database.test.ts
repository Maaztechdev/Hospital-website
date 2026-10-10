import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const api = "/api/v1";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let token: string;
let medicineId: string | undefined;
let batchId: string | undefined;
let archiveMedicineId: string | undefined;
let supplierId: string | undefined;

describe("batch-aware pharmacy inventory", () => {
  beforeAll(async () => {
    const login = await request(app).post(`${api}/auth/login`).send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(login.status).toBe(200);
    token = login.body.data.accessToken as string;
  });

  afterEach(async () => {
    if (batchId) await prisma.stockMovement.deleteMany({ where: { batchId } });
    if (medicineId) await prisma.auditLog.deleteMany({ where: { module: "pharmacy", entityId: { in: [medicineId, batchId].filter((id): id is string => Boolean(id)) } } });
    if (batchId) await prisma.medicineBatch.deleteMany({ where: { id: batchId } });
    if (medicineId) await prisma.medicine.deleteMany({ where: { id: medicineId } });
    if (archiveMedicineId) {
      await prisma.auditLog.deleteMany({ where: { module: "pharmacy", entityId: archiveMedicineId } });
      await prisma.medicine.deleteMany({ where: { id: archiveMedicineId } });
    }
    if (supplierId) {
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    }
    medicineId = undefined;
    batchId = undefined;
    archiveMedicineId = undefined;
    supplierId = undefined;
  });

  afterAll(() => {
    redis.disconnect();
  });

  it("creates and tops up a batch with inbound references, writes off expired stock, and blocks archive with history", async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const createdMedicine = await request(app).post(`${api}/pharmacy/medicines`).set(headers).send({
      name: `Batch test ${suffix}`,
      unitType: "CAPSULE",
      manufacturer: "Test manufacturer",
    });
    expect(createdMedicine.status).toBe(201);
    medicineId = createdMedicine.body.data.id as string;
    expect(createdMedicine.body.data.unitType).toBe("CAPSULE");
    expect(createdMedicine.body.data.manufacturer).toBe("Test manufacturer");

    const batchInput = {
      medicineId,
      batchNumber: `BATCH-${suffix}`,
      expiryDate: "2027-12-31",
      quantity: 4,
      purchasePrice: 12,
      sellingPrice: 18,
      supplierName: `Supplier ${suffix}`,
      invoiceReference: `SUP-INV-${suffix}`,
    };
    const createdBatch = await request(app).post(`${api}/pharmacy/stock-in`).set(headers).send(batchInput);
    batchId = createdBatch.body.data.id as string;
    expect(createdBatch.status).toBe(200);

    const topUp = await request(app).post(`${api}/pharmacy/stock-in`).set(headers).send({ ...batchInput, quantity: 3, purchasePrice: 13, invoiceReference: `SUP-INV-2-${suffix}` });
    expect(topUp.status).toBe(200);
    expect(topUp.body.data.id).toBe(batchId);
    expect(topUp.body.data.stockQuantity).toBe(7);
    expect(Number(topUp.body.data.purchasePrice)).toBe(13);

    const batch = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId }, include: { supplier: true } });
    supplierId = batch.supplierId ?? undefined;
    expect(batch.supplier?.name).toBe(`Supplier ${suffix}`);
    const inbound = await prisma.stockMovement.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } });
    expect(inbound).toHaveLength(2);
    expect(inbound.map((movement) => movement.invoiceReference)).toEqual([`SUP-INV-${suffix}`, `SUP-INV-2-${suffix}`]);

    await prisma.medicineBatch.update({ where: { id: batchId }, data: { expiryDate: new Date("2020-01-01T00:00:00.000Z") } });
    const writeOff = await request(app).post(`${api}/pharmacy/write-off`).set(headers).send({ batchId, quantity: 2, type: "EXPIRED", reason: "Expired stock removal" });
    expect(writeOff.status).toBe(200);
    expect(writeOff.body.data.stockQuantity).toBe(5);
    expect(await prisma.stockMovement.count({ where: { batchId, movementType: "EXPIRED", quantity: 2 } })).toBe(1);

    const sale = await request(app).post(`${api}/pharmacy/sales`).set(headers).send({ items: [{ medicineId, quantity: 1 }], tax: 0, paymentMethod: "CASH" });
    expect(sale.status).toBe(409);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).stockQuantity).toBe(5);

    const archiveBlocked = await request(app).delete(`${api}/pharmacy/medicines/${medicineId}`).set(headers);
    expect(archiveBlocked.status).toBe(409);
    expect((await prisma.medicine.findUniqueOrThrow({ where: { id: medicineId } })).isActive).toBe(true);

    const archiveCandidate = await request(app).post(`${api}/pharmacy/medicines`).set(headers).send({ name: `Archive test ${suffix}` });
    expect(archiveCandidate.status).toBe(201);
    archiveMedicineId = archiveCandidate.body.data.id as string;
    const archived = await request(app).delete(`${api}/pharmacy/medicines/${archiveMedicineId}`).set(headers);
    expect(archived.status).toBe(200);
    expect(archived.body.data.isActive).toBe(false);
  });
});
