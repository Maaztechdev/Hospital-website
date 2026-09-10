import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";

const app = createApp();
const password = "IdorTest@12345";

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe("Database-backed record authorization", () => {
  const suffix = Date.now().toString();
  let doctorA: Awaited<ReturnType<typeof prisma.user.create>>;
  let doctorB: Awaited<ReturnType<typeof prisma.user.create>>;
  let admin: Awaited<ReturnType<typeof prisma.user.create>>;
  let labTech: Awaited<ReturnType<typeof prisma.user.create>>;
  let profileA: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let profileB: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let patientA: Awaited<ReturnType<typeof prisma.patient.create>>;
  let patientB: Awaited<ReturnType<typeof prisma.patient.create>>;
  let appointmentA: Awaited<ReturnType<typeof prisma.appointment.create>>;
  let appointmentB: Awaited<ReturnType<typeof prisma.appointment.create>>;
  let consultationB: Awaited<ReturnType<typeof prisma.consultation.create>>;
  let prescriptionB: Awaited<ReturnType<typeof prisma.prescription.create>>;
  let labOrderB: Awaited<ReturnType<typeof prisma.labOrder.create>>;
  let test: Awaited<ReturnType<typeof prisma.labTest.create>>;
  let departmentId: string | undefined;

  beforeAll(async () => {
    const department = await prisma.department.create({ data: { name: `IDOR ${suffix}` } });
    departmentId = department.id;
    const hash = await argon2.hash(password);
    [doctorA, doctorB, admin, labTech] = await Promise.all([
      prisma.user.create({ data: { name: "Doctor A", email: `idor-a-${suffix}@test.local`, passwordHash: hash, role: "DOCTOR", departmentId: department.id } }),
      prisma.user.create({ data: { name: "Doctor B", email: `idor-b-${suffix}@test.local`, passwordHash: hash, role: "DOCTOR", departmentId: department.id } }),
      prisma.user.create({ data: { name: "IDOR Admin", email: `idor-admin-${suffix}@test.local`, passwordHash: hash, role: "ADMIN" } }),
      prisma.user.create({ data: { name: "IDOR Lab", email: `idor-lab-${suffix}@test.local`, passwordHash: hash, role: "LAB_TECHNICIAN" } }),
    ]);
    [profileA, profileB] = await Promise.all([
      prisma.doctor.create({ data: { userId: doctorA.id, departmentId: department.id, consultationFee: 100 } }),
      prisma.doctor.create({ data: { userId: doctorB.id, departmentId: department.id, consultationFee: 100 } }),
    ]);
    const patientData = { dateOfBirth: new Date("1990-01-01"), age: 36, gender: "OTHER" as const, phone: `0300${suffix.slice(-7)}`, createdBy: admin.id };
    patientA = await prisma.patient.create({ data: { ...patientData, mrNumber: `MR-${suffix}-A`, firstName: "Patient", lastName: "A" } });
    patientB = await prisma.patient.create({ data: { ...patientData, mrNumber: `MR-${suffix}-B`, phone: `0311${suffix.slice(-7)}`, firstName: "Patient", lastName: "B" } });
    const baseDate = new Date(Date.now() + 86400000);
    appointmentA = await prisma.appointment.create({ data: { patientId: patientA.id, doctorId: profileA.id, appointmentDate: baseDate, timeSlot: "09:00", tokenNumber: 9001, appointmentType: "NEW_VISIT", createdBy: admin.id } });
    appointmentB = await prisma.appointment.create({ data: { patientId: patientB.id, doctorId: profileB.id, appointmentDate: baseDate, timeSlot: "10:00", tokenNumber: 9002, appointmentType: "NEW_VISIT", createdBy: admin.id } });
    consultationB = await prisma.consultation.create({ data: { appointmentId: appointmentB.id, patientId: patientB.id, doctorId: profileB.id } });
    prescriptionB = await prisma.prescription.create({ data: { consultationId: consultationB.id, patientId: patientB.id, doctorId: profileB.id, items: { create: { medicineName: "Test", dosage: "1", route: "oral", frequency: "daily", durationDays: 1 } } } });
    test = await prisma.labTest.create({ data: { testName: `IDOR Test ${suffix}`, testCode: `IDOR${suffix}`, price: 1 } });
    labOrderB = await prisma.labOrder.create({ data: { patientId: patientB.id, doctorId: profileB.id, testId: test.id, createdBy: admin.id } });
  });

  afterAll(async () => {
    if (labOrderB) await prisma.labOrder.deleteMany({ where: { id: labOrderB.id } });
    if (prescriptionB) await prisma.prescription.deleteMany({ where: { id: prescriptionB.id } });
    if (consultationB) await prisma.consultation.deleteMany({ where: { id: consultationB.id } });
    if (appointmentA && appointmentB) await prisma.appointment.deleteMany({ where: { id: { in: [appointmentA.id, appointmentB.id] } } });
    if (patientA && patientB) await prisma.patient.deleteMany({ where: { id: { in: [patientA.id, patientB.id] } } });
    if (profileA && profileB) await prisma.doctor.deleteMany({ where: { id: { in: [profileA.id, profileB.id] } } });
    if (doctorA && doctorB && admin && labTech) await prisma.user.deleteMany({ where: { id: { in: [doctorA.id, doctorB.id, admin.id, labTech.id] } } });
    if (test) await prisma.labTest.deleteMany({ where: { id: test.id } });
    if (departmentId) await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("allows own records and rejects modified cross-doctor IDs", async () => {
    const tokenA = await login(doctorA.email);
    expect((await request(app).get(`/api/v1/appointments/${appointmentA.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(200);
    const consultationA = await prisma.consultation.create({ data: { appointmentId: appointmentA.id, patientId: patientA.id, doctorId: profileA.id } });
    const prescriptionA = await prisma.prescription.create({ data: { consultationId: consultationA.id, patientId: patientA.id, doctorId: profileA.id } });
    const labOrderA = await prisma.labOrder.create({ data: { patientId: patientA.id, doctorId: profileA.id, testId: test.id, createdBy: admin.id } });
    expect((await request(app).get(`/api/v1/consultations/${consultationA.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/prescriptions/${prescriptionA.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/lab/orders/${labOrderA.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/appointments/${appointmentB.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(403);
    expect((await request(app).post(`/api/v1/appointments/${appointmentB.id}/approve`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/patients/${patientB.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/consultations/${consultationB.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(403);
    expect((await request(app).patch(`/api/v1/consultations/${consultationB.id}`).set("Authorization", `Bearer ${tokenA}`).send({ diagnosis: "tampered" })).status).toBe(403);
    expect((await request(app).get(`/api/v1/prescriptions/${prescriptionB.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(403);
    expect((await request(app).post(`/api/v1/prescriptions/${prescriptionB.id}/sign`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/lab/orders/${labOrderB.id}`).set("Authorization", `Bearer ${tokenA}`)).status).toBe(403);
    await prisma.labOrder.delete({ where: { id: labOrderA.id } });
    await prisma.prescription.delete({ where: { id: prescriptionA.id } });
    await prisma.consultation.delete({ where: { id: consultationA.id } });
  });

  it("preserves admin and lab operational access", async () => {
    const adminToken = await login(admin.email);
    const labToken = await login(labTech.email);
    expect((await request(app).get(`/api/v1/patients/${patientB.id}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/lab/orders/${labOrderB.id}`).set("Authorization", `Bearer ${labToken}`)).status).toBe(200);
  });
});
