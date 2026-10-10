import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const api = "/api/v1";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let token: string;
let fixture: {
  medicineId?: string;
  batchIds?: string[];
  appointmentId?: string;
  consultationId?: string;
  prescriptionId?: string;
  prescriptionItemId?: string;
  saleId?: string;
  invoiceId?: string;
} = {};

describe("pharmacy prescription dispensing", () => {
  beforeAll(async () => {
    const login = await request(app).post(`${api}/auth/login`).send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(login.status).toBe(200);
    token = login.body.data.accessToken as string;
  });

  afterEach(async () => {
    const batchIds = fixture.batchIds ?? [];
    if (batchIds.length) await prisma.stockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
    if (fixture.invoiceId) {
      await prisma.payment.deleteMany({ where: { invoiceId: fixture.invoiceId } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: fixture.invoiceId } });
    }
    if (fixture.saleId) {
      await prisma.pharmacySaleItem.deleteMany({ where: { saleId: fixture.saleId } });
      await prisma.pharmacySale.deleteMany({ where: { id: fixture.saleId } });
    }
    if (fixture.invoiceId) await prisma.invoice.deleteMany({ where: { id: fixture.invoiceId } });
    const auditIds = [fixture.prescriptionId, fixture.saleId].filter((id): id is string => Boolean(id));
    if (auditIds.length) await prisma.auditLog.deleteMany({ where: { module: "pharmacy", entityId: { in: auditIds } } });
    if (fixture.prescriptionId) {
      await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: fixture.prescriptionId } });
      await prisma.prescription.deleteMany({ where: { id: fixture.prescriptionId } });
    }
    if (fixture.consultationId) await prisma.consultation.deleteMany({ where: { id: fixture.consultationId } });
    if (fixture.appointmentId) await prisma.appointment.deleteMany({ where: { id: fixture.appointmentId } });
    if (batchIds.length) await prisma.medicineBatch.deleteMany({ where: { id: { in: batchIds } } });
    if (fixture.medicineId) await prisma.medicine.deleteMany({ where: { id: fixture.medicineId } });
    fixture = {};
  });

  afterAll(() => {
    redis.disconnect();
  });

  it("uses FEFO, creates a linked invoice and movement history, and rejects repeat or over-quantity dispensing", async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" }, select: { id: true, name: true } });
    const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true, firstName: true, lastName: true, mrNumber: true } });
    const doctor = await prisma.doctor.findFirstOrThrow({ where: { isAvailable: true }, select: { id: true, departmentId: true } });

    const medicineResponse = await request(app).post(`${api}/pharmacy/medicines`).set(headers).send({ name: `Rx dispense ${suffix}` });
    expect(medicineResponse.status).toBe(201);
    const medicineId = medicineResponse.body.data.id as string;
    fixture.medicineId = medicineId;

    const firstBatchResponse = await request(app).post(`${api}/pharmacy/batches`).set(headers).send({
      medicineId, batchNumber: `RX-OLD-${suffix}`, expiryDate: "2030-12-31", purchasePrice: 2, sellingPrice: 7, stockQuantity: 2,
    });
    const nextBatchResponse = await request(app).post(`${api}/pharmacy/batches`).set(headers).send({
      medicineId, batchNumber: `RX-NEXT-${suffix}`, expiryDate: "2031-12-31", purchasePrice: 3, sellingPrice: 8, stockQuantity: 4,
    });
    expect(firstBatchResponse.status).toBe(201);
    expect(nextBatchResponse.status).toBe(201);
    const batchIds = [firstBatchResponse.body.data.id as string, nextBatchResponse.body.data.id as string];
    fixture.batchIds = batchIds;

    const appointmentDate = new Date("2030-01-01T00:00:00.000Z");
    const latestAppointment = await prisma.appointment.findFirst({
      where: { doctorId: doctor.id, appointmentDate },
      orderBy: { tokenNumber: "desc" },
      select: { tokenNumber: true },
    });
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        departmentId: doctor.departmentId,
        appointmentDate,
        timeSlot: new Date("1970-01-01T09:00:00.000Z"),
        tokenNumber: (latestAppointment?.tokenNumber ?? 0) + 1,
        appointmentType: "CONSULTATION",
        status: "CONFIRMED",
        source: "WALK_IN",
        createdBy: user.id,
      },
    });
    fixture.appointmentId = appointment.id;
    const consultation = await prisma.consultation.create({
      data: { appointmentId: appointment.id, patientId: patient.id, doctorId: doctor.id },
    });
    fixture.consultationId = consultation.id;
    const prescription = await prisma.prescription.create({
      data: {
        consultationId: consultation.id,
        patientId: patient.id,
        doctorId: doctor.id,
        status: "SIGNED",
        signedAt: new Date(),
        items: {
          create: {
            medicineId,
            medicineName: "Prescription test medicine",
            isCatalogItem: true,
            dosage: "1 tablet",
            doseAmount: 1,
            doseUnit: "tablet",
            route: "Oral",
            frequency: "OD",
            frequencyCode: "OD",
            durationDays: 3,
            durationValue: 3,
            durationUnit: "days",
          },
        },
      },
      include: { items: true },
    });
    fixture.prescriptionId = prescription.id;
    fixture.prescriptionItemId = prescription.items[0].id;

    const overQuantity = await request(app).post(`${api}/pharmacy/prescriptions/${prescription.id}/dispense`)
      .set(headers).send({ items: [{ prescriptionItemId: prescription.items[0].id, quantity: 7 }] });
    expect(overQuantity.status).toBe(409);
    expect((await prisma.prescription.findUniqueOrThrow({ where: { id: prescription.id } })).status).toBe("SIGNED");
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchIds[0] } })).stockQuantity).toBe(2);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchIds[1] } })).stockQuantity).toBe(4);

    const dispense = await request(app).post(`${api}/pharmacy/prescriptions/${prescription.id}/dispense`)
      .set(headers).send({ items: [{ prescriptionItemId: prescription.items[0].id, quantity: 3 }] });
    expect(dispense.status).toBe(201);
    fixture.saleId = dispense.body.data.sale.id as string;
    fixture.invoiceId = dispense.body.data.sale.invoice.id as string;
    expect(dispense.body.data.prescription.status).toBe("DISPENSED");
    expect(dispense.body.data.sale.cashier.name).toBe(user.name);
    expect(dispense.body.data.sale.invoice.patientId).toBe(patient.id);
    expect(dispense.body.data.sale.invoice.status).toBe("PAID");
    expect(dispense.body.data.sale.invoice.items.map((item: { description: string }) => item.description)).toEqual(expect.arrayContaining([
      expect.stringContaining(`batch RX-OLD-${suffix}`),
      expect.stringContaining(`batch RX-NEXT-${suffix}`),
    ]));
    expect(await prisma.auditLog.count({
      where: { module: "pharmacy", entityType: "Prescription", entityId: prescription.id, action: "DISPENSE" },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { module: "pharmacy", entityType: "PrescriptionItem", entityId: prescription.items[0].id, action: "DISPENSE" },
    })).toBe(1);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchIds[0] } })).stockQuantity).toBe(0);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchIds[1] } })).stockQuantity).toBe(3);

    const repeated = await request(app).post(`${api}/pharmacy/prescriptions/${prescription.id}/dispense`)
      .set(headers).send({ items: [{ prescriptionItemId: prescription.items[0].id, quantity: 1 }] });
    expect(repeated.status).toBe(409);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchIds[1] } })).stockQuantity).toBe(3);
    const legacyRepeated = await request(app).post(`${api}/pharmacy/dispense`)
      .set(headers).send({ prescriptionItemId: prescription.items[0].id, quantity: 1 });
    expect(legacyRepeated.status).toBe(409);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchIds[1] } })).stockQuantity).toBe(3);

    const movements = await request(app).get(`${api}/pharmacy/stock-movements?limit=200&medicineId=${medicineId}`).set(headers);
    expect(movements.status).toBe(200);
    const dispenseMovement = movements.body.data.find((movement: { referenceId: string }) => movement.referenceId === fixture.saleId);
    expect(dispenseMovement).toMatchObject({
      movementType: "OUT",
      createdBy: user.id,
      createdByUser: { name: user.name },
      invoice: { invoiceNumber: dispense.body.data.sale.invoice.invoiceNumber },
      patient: { name: `${patient.firstName} ${patient.lastName}`, mrNumber: patient.mrNumber },
    });
    expect(dispenseMovement.batch.batchNumber).toBe(`RX-NEXT-${suffix}`);
  });
});
