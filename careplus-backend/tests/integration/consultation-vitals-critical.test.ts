import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const password = "VitalsTest@12345";

describe("Integration: consultation vitals persistence and criticality", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let user: Awaited<ReturnType<typeof prisma.user.create>>;
  let doctor: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let patient: Awaited<ReturnType<typeof prisma.patient.create>>;
  let appointment: Awaited<ReturnType<typeof prisma.appointment.create>>;
  let completedAppointment: Awaited<ReturnType<typeof prisma.appointment.create>>;
  let consultationId: string | undefined;
  let completedConsultationId: string | undefined;
  let completedPrescriptionId: string | undefined;
  let token: string;

  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    user = await prisma.user.create({ data: { name: "Vitals Test Doctor", email: `vitals-doctor-${suffix}@test.local`, passwordHash, role: "DOCTOR" } });
    doctor = await prisma.doctor.create({ data: { userId: user.id, consultationFee: 100 } });
    patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-VITALS-${suffix}`,
        firstName: "Vitals",
        lastName: "Patient",
        age: 35,
        gender: "OTHER",
        phone: `0300${Date.now().toString().slice(-7)}`,
        createdBy: user.id,
        isTest: true,
      },
    });
    const now = new Date();
    const appointmentDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        appointmentDate,
        timeSlot: new Date("1970-01-01T10:00:00.000Z"),
        tokenNumber: Number(Date.now().toString().slice(-8)),
        appointmentType: "CONSULTATION",
        status: "IN_CONSULTATION",
        source: "WALK_IN",
        createdBy: user.id,
        isTest: true,
      },
    });
    const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password });
    expect(login.status).toBe(200);
    token = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    if (completedPrescriptionId) {
      await prisma.auditLog.deleteMany({ where: { entityId: completedPrescriptionId } });
      await prisma.prescription.deleteMany({ where: { id: completedPrescriptionId } });
    }
    if (consultationId) {
      await prisma.auditLog.deleteMany({ where: { entityId: consultationId } });
      await prisma.consultation.deleteMany({ where: { id: consultationId } });
    }
    if (completedConsultationId) {
      await prisma.auditLog.deleteMany({ where: { entityId: completedConsultationId } });
      await prisma.consultation.deleteMany({ where: { id: completedConsultationId } });
    }
    if (appointment || completedAppointment) await prisma.appointment.deleteMany({ where: { id: { in: [appointment?.id, completedAppointment?.id].filter((id): id is string => Boolean(id)) } } });
    if (patient) await prisma.patient.deleteMany({ where: { id: patient.id } });
    if (doctor) await prisma.doctor.deleteMany({ where: { id: doctor.id } });
    if (user) {
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
    redis.disconnect();
  });

  it("stores blank values as null and computes criticality from saved readings rather than a client flag", async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const blank = await request(app).post("/api/v1/consultations").set(headers).send({
      appointmentId: appointment.id,
      vitals: {
        bp_systolic: null,
        bp_diastolic: null,
        temperature: null,
        temperature_unit: null,
        pulse: null,
        respiratory_rate: null,
        oxygen_saturation: null,
        weight: null,
        height_cm: null,
      },
    });
    expect(blank.status).toBe(201);
    consultationId = blank.body.data.id as string;
    expect(blank.body.data).toMatchObject({
      bpSystolic: null,
      bpDiastolic: null,
      temperature: null,
      pulse: null,
      respiratoryRate: null,
      oxygenSaturation: null,
      weight: null,
      heightCm: null,
      isCritical: false,
      vitalsEstimated: false,
    });

    const unconfirmed = await request(app).patch(`/api/v1/consultations/${consultationId}`).set(headers).send({
      vitals: { oxygen_saturation: 66, critical_confirmed: false, isCritical: false },
    });
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.message).toContain("Confirm critical vital values");

    const confirmed = await request(app).patch(`/api/v1/consultations/${consultationId}`).set(headers).send({
      vitals: { oxygen_saturation: 66, critical_confirmed: true, isCritical: false },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.oxygenSaturation).toBe(66);
    expect(confirmed.body.data.isCritical).toBe(true);
    expect(confirmed.body.data.criticalConfirmed).toBe(true);

    completedAppointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        appointmentDate: appointment.appointmentDate,
        timeSlot: new Date("1970-01-01T11:00:00.000Z"),
        tokenNumber: appointment.tokenNumber + 1,
        appointmentType: "CONSULTATION",
        status: "IN_CONSULTATION",
        source: "WALK_IN",
        createdBy: user.id,
        isTest: true,
      },
    });
    const blankConsultation = await request(app).post("/api/v1/consultations").set(headers).send({ appointmentId: completedAppointment.id });
    expect(blankConsultation.status).toBe(201);
    completedConsultationId = blankConsultation.body.data.id as string;
    const profile = await request(app).get(`/api/v1/patients/${patient.id}/profile`).set(headers);
    expect(profile.status).toBe(200);
    expect(profile.body.data.consultations.map((item: { appointmentId: string }) => item.appointmentId)).toEqual(
      expect.arrayContaining([appointment.id, completedAppointment.id]),
    );
    const prescription = await request(app).post("/api/v1/prescriptions").set(headers).send({
      consultationId: completedConsultationId,
      items: [{ medicineName: "Test medicine", isCatalogItem: false, doseAmount: 1, doseUnit: "tablet", route: "Oral", frequencyCode: "OD", durationValue: 3, durationUnit: "days" }],
    });
    expect(prescription.status).toBe(201);
    completedPrescriptionId = prescription.body.data.id as string;
    expect((await request(app).post(`/api/v1/prescriptions/${completedPrescriptionId}/sign`).set(headers)).status).toBe(200);
    expect((await request(app).post(`/api/v1/consultations/${completedConsultationId}/sign`).set(headers)).status).toBe(200);
    const completed = await request(app).post(`/api/v1/consultations/${completedConsultationId}/complete`).set(headers);
    expect(completed.status).toBe(200);
    expect(completed.body.data).toMatchObject({
      bpSystolic: null,
      bpDiastolic: null,
      temperature: null,
      pulse: null,
      respiratoryRate: null,
      oxygenSaturation: null,
      weight: null,
      heightCm: null,
      isCritical: false,
    });
    expect((await prisma.appointment.findUnique({ where: { id: appointment.id } }))?.status).toBe("IN_CONSULTATION");
    expect((await prisma.appointment.findUnique({ where: { id: completedAppointment.id } }))?.status).toBe("COMPLETED");
  });
});
