import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import jwt from "jsonwebtoken";
import { env } from "@config/env";

const app = createApp();

describe("Optimistic Locking Concurrent Edits Suite", () => {
  let adminToken: string;
  let adminId: string;
  let doctorToken: string;
  let doctorUserId: string;
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;

  beforeAll(async () => {
    // 1. Get or create admin
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!admin) throw new Error("Admin required");
    adminId = admin.id;
    adminToken = jwt.sign({ sub: admin.id, role: admin.role, email: admin.email }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

    // 2. Get doctor
    const doc = await prisma.doctor.findFirst({ include: { user: true } });
    if (!doc) throw new Error("Doctor record required");
    doctorId = doc.id;
    doctorUserId = doc.userId;
    doctorToken = jwt.sign({ sub: doc.user.id, role: doc.user.role, email: doc.user.email }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

    // 3. Create test patient
    const patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-OPT-${Date.now()}`,
        firstName: "Optimistic",
        lastName: "Tester",
        gender: "MALE",
        age: 35,
        phone: "03001239999",
        creator: { connect: { id: adminId } },
      },
    });
    patientId = patient.id;

    // 4. Create appointment
    const docWithDept = await prisma.doctor.findFirst({ where: { id: doctorId } });
    const appt = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        departmentId: docWithDept!.departmentId,
        tokenNumber: 999,
        appointmentType: "CONSULTATION",
        gender: "MALE",
        appointmentDate: new Date(),
        timeSlot: new Date(),
        status: "CONFIRMED",
        createdBy: adminId,
      },
    });
    appointmentId = appt.id;
  });

  afterAll(async () => {
    if (appointmentId) await prisma.appointment.deleteMany({ where: { id: appointmentId } }).catch(() => {});
    if (patientId) await prisma.patient.update({ where: { id: patientId }, data: { deletedAt: new Date() } }).catch(() => {});
  });

  describe("1. Consultation Optimistic Locking", () => {
    let consultationId: string;

    beforeEach(async () => {
      const c = await prisma.consultation.create({
        data: {
          appointmentId,
          patientId,
          doctorId,
          chiefComplaint: "Initial complaint",
          diagnosis: "Initial diagnosis",
          prescriptionStatus: "DRAFT",
        },
      });
      consultationId = c.id;
    });

    afterEach(async () => {
      if (consultationId) {
        await prisma.consultation.deleteMany({ where: { id: consultationId } });
      }
    });

    it("rejects second concurrent edit with 409 when expectedUpdatedAt is stale", async () => {
      // Both users read the consultation at timestamp T0
      const initial = await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId } });
      const staleTimestamp = initial.updatedAt.toISOString();

      // User 1 saves first
      const res1 = await request(app)
        .patch(`/api/v1/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          chiefComplaint: "Updated by User 1",
          expectedUpdatedAt: staleTimestamp,
        });
      expect(res1.status).toBe(200);

      // User 2 tries to save with the old stale timestamp
      const res2 = await request(app)
        .patch(`/api/v1/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          chiefComplaint: "Updated by User 2",
          expectedUpdatedAt: staleTimestamp,
        });

      expect(res2.status).toBe(409);
      expect(res2.body.message).toMatch(/this record was changed by another user, reload/i);
    });
    it("rejects consultation update omitting expectedUpdatedAt with 400", async () => {
      const res = await request(app)
        .patch(`/api/v1/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ chiefComplaint: "Update without expectedUpdatedAt" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expectedUpdatedAt is required/i);
    });
  });

  describe("2. Prescription Optimistic Locking", () => {
    let prescriptionId: string;

    beforeEach(async () => {
      const rx = await prisma.prescription.create({
        data: {
          patientId,
          doctorId,
          status: "DRAFT",
          presentingComplaints: "Initial complaint",
          items: {
            create: [
              {
                medicineName: "Paracetamol 500mg",
                dosage: "1 tablet",
                frequency: "TID",
                durationDays: 5,
                doseAmount: 1,
                doseUnit: "tablet",
                route: "Oral",
                frequencyCode: "TID",
                durationValue: 5,
                durationUnit: "days",
              },
            ],
          },
        },
      });
      prescriptionId = rx.id;
    });

    afterEach(async () => {
      if (prescriptionId) {
        await prisma.prescriptionItem.deleteMany({ where: { prescriptionId } });
        await prisma.prescription.deleteMany({ where: { id: prescriptionId } });
      }
    });

    it("rejects concurrent prescription edit with 409 on stale version", async () => {
      const initial = await prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId } });
      const staleTimestamp = initial.updatedAt.toISOString();

      // User 1 updates successfully
      const res1 = await request(app)
        .patch(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          expectedUpdatedAt: staleTimestamp,
          padData: { presentingComplaints: "Changed by User 1" },
        });
      expect(res1.status).toBe(200);

      // User 2 attempts update with old timestamp
      const res2 = await request(app)
        .patch(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          expectedUpdatedAt: staleTimestamp,
          padData: { presentingComplaints: "Changed by User 2" },
        });

      expect(res2.status).toBe(409);
      expect(res2.body.message).toMatch(/this record was changed by another user, reload/i);
    });
    it("rejects prescription update omitting expectedUpdatedAt with 400", async () => {
      const res = await request(app)
        .patch(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ padData: { presentingComplaints: "Update without expectedUpdatedAt" } });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expectedUpdatedAt is required/i);
    });
  });

  describe("3. Ultrasound Report Optimistic Locking", () => {
    let orderId: string;

    beforeEach(async () => {
      const order = await prisma.ultrasoundOrder.create({
        data: {
          patientId,
          doctorId,
          examType: "Abdomen",
          status: "IN_PROGRESS",
          findings: "Initial findings",
        },
      });
      orderId = order.id;
    });

    afterEach(async () => {
      if (orderId) {
        await prisma.ultrasoundOrder.deleteMany({ where: { id: orderId } });
      }
    });

    it("rejects concurrent ultrasound review with 409 when expectedUpdatedAt is stale", async () => {
      const initial = await prisma.ultrasoundOrder.findUniqueOrThrow({ where: { id: orderId } });
      const staleTimestamp = initial.updatedAt.toISOString();

      // User 1 reviews first
      const res1 = await request(app)
        .patch(`/api/v1/ultrasound/${orderId}/review`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          findings: "User 1 findings",
          expectedUpdatedAt: staleTimestamp,
        });
      expect(res1.status).toBe(200);

      // User 2 reviews with stale timestamp
      const res2 = await request(app)
        .patch(`/api/v1/ultrasound/${orderId}/review`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          findings: "User 2 conflicting findings",
          expectedUpdatedAt: staleTimestamp,
        });

      expect(res2.status).toBe(409);
      expect(res2.body.message).toMatch(/this record was changed by another user, reload/i);
    });
    it("rejects ultrasound review omitting expectedUpdatedAt with 400", async () => {
      const res = await request(app)
        .patch(`/api/v1/ultrasound/${orderId}/review`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ findings: "Ultrasound review without expectedUpdatedAt" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expectedUpdatedAt is required/i);
    });
  });

  describe("4. Lab Result Optimistic Locking with Two Technicians", () => {
    let labTestId: string;
    let labOrderId: string;
    let parameterId: string;
    let tech1Token: string;
    let tech2Token: string;

    beforeEach(async () => {
      // Ensure two real lab technician users exist in the DB
      const techUser1 = await prisma.user.upsert({
        where: { email: "tech1.opt@careplus.local" },
        update: {},
        create: {
          email: "tech1.opt@careplus.local",
          name: "Lab Tech One",
          passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
          role: "LAB_TECHNICIAN",
        },
      });
      const techUser2 = await prisma.user.upsert({
        where: { email: "tech2.opt@careplus.local" },
        update: {},
        create: {
          email: "tech2.opt@careplus.local",
          name: "Lab Tech Two",
          passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
          role: "LAB_TECHNICIAN",
        },
      });

      tech1Token = jwt.sign({ sub: techUser1.id, role: techUser1.role, email: techUser1.email }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
      tech2Token = jwt.sign({ sub: techUser2.id, role: techUser2.role, email: techUser2.email }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

      const test = await prisma.labTest.create({
        data: {
          testCode: `TEST-OPT-${Date.now().toString().slice(-6)}`,
          testName: "Optimistic Locking CBC",
          price: 500,
          category: "HEMATOLOGY",
          sampleType: "Blood",
          parameters: {
            create: [
              {
                name: "Hemoglobin",
                unit: "g/dL",
                resultType: "NUMERIC",
                displayOrder: 1,
              },
            ],
          },
        },
        include: { parameters: true },
      });
      labTestId = test.id;
      parameterId = test.parameters[0].id;

      const order = await prisma.labOrder.create({
        data: {
          orderNumber: `ORD-OPT-${Date.now().toString().slice(-6)}`,
          patientId,
          testId: labTestId,
          status: "SAMPLE_COLLECTED",
          createdBy: adminId,
        },
      });
      labOrderId = order.id;
    });

    afterEach(async () => {
      // lab_order_events are immutable by PostgreSQL trigger; labOrder records are left intact in test DB
    });

    it("rejects concurrent lab result entry by technician 2 when technician 1 updated first", async () => {
      // Tech 1 saves initial result version
      const res1 = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/results`)
        .set("Authorization", `Bearer ${tech1Token}`)
        .send({
          parameters: [{ parameterId, value: "14.2" }],
        });
      expect(res1.status).toBe(201);
      const firstResult = res1.body.data;
      const initialResultId = firstResult.id;

      // Tech 1 saves second amendment / update
      const res2 = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/results`)
        .set("Authorization", `Bearer ${tech1Token}`)
        .send({
          parameters: [{ parameterId, value: "14.5" }],
          expectedResultId: initialResultId,
        });
      expect(res2.status).toBe(201);

      // Tech 2 tries to save using the old initialResultId or stale timestamp
      const res3 = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/results`)
        .set("Authorization", `Bearer ${tech2Token}`)
        .send({
          parameters: [{ parameterId, value: "13.9" }],
          expectedResultId: initialResultId,
        });

      expect(res3.status).toBe(409);
      expect(res3.body.message).toMatch(/this record was changed by another user, reload/i);
    });

    it("rejects stale verification with 409 when expectedUpdatedAt does not match latest result", async () => {
      // Tech 1 saves initial result
      const res1 = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/results`)
        .set("Authorization", `Bearer ${tech1Token}`)
        .send({
          parameters: [{ parameterId, value: "14.2" }],
        });
      expect(res1.status).toBe(201);
      const staleTimestamp = new Date(Date.now() - 60000).toISOString();

      // Pathologist/Admin verifies with stale expectedUpdatedAt
      const verifyRes = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          expectedUpdatedAt: staleTimestamp,
        });

      expect(verifyRes.status).toBe(409);
      expect(verifyRes.body.message).toMatch(/this record was changed by another user, reload/i);
    });
    it("rejects lab result update omitting expectedUpdatedAt with 400", async () => {
      // Tech 1 saves initial result
      const res1 = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/results`)
        .set("Authorization", `Bearer ${tech1Token}`)
        .send({ parameters: [{ parameterId, value: "14.2" }] });
      expect(res1.status).toBe(201);

      // Now updating without expectedUpdatedAt
      const res2 = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/results`)
        .set("Authorization", `Bearer ${tech1Token}`)
        .send({ parameters: [{ parameterId, value: "14.5" }] });
      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/expectedUpdatedAt is required/i);
    });

    it("rejects lab verification omitting expectedUpdatedAt with 400", async () => {
      const res1 = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/results`)
        .set("Authorization", `Bearer ${tech1Token}`)
        .send({ parameters: [{ parameterId, value: "14.2" }] });
      expect(res1.status).toBe(201);

      const verifyRes = await request(app)
        .post(`/api/v1/lab/orders/${labOrderId}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.message).toMatch(/expectedUpdatedAt is required/i);
    });
  });
});
