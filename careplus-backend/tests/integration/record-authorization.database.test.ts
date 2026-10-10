import request from "supertest";
import argon2 from "argon2";
import { randomUUID } from "crypto";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

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
  let appointmentDate: string;

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
    const patientData = { age: 36, gender: "OTHER" as const, phone: `0300${suffix.slice(-7)}`, createdBy: admin.id };
    patientA = await prisma.patient.create({ data: { ...patientData, mrNumber: `MR-${suffix}-A`, firstName: "Patient", lastName: "A" } });
    patientB = await prisma.patient.create({ data: { ...patientData, mrNumber: `MR-${suffix}-B`, phone: `0311${suffix.slice(-7)}`, firstName: "Patient", lastName: "B" } });
    const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const [year, month, day] = todayKey.split("-").map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
    appointmentDate = day < daysInMonth
      ? `${year}-${String(month).padStart(2, "0")}-${String(day + 1).padStart(2, "0")}`
      : month < 12 ? `${year}-${String(month + 1).padStart(2, "0")}-01` : `${year + 1}-01-01`;
    const createFixtureAppointment = async (patientId: string, doctorId: string, timeSlot: string, tokenNumber: number) => {
      const id = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO appointments (
          id, patient_id, doctor_id, department_id, appointment_date, time_slot, token_number,
          appointment_type, status, priority, source, created_by, created_at, updated_at
        ) VALUES (
          ${id}, ${patientId}, ${doctorId}, ${department.id}, ${appointmentDate}::date, ${timeSlot}::time, ${tokenNumber},
          'NEW_VISIT'::"AppointmentType", 'CONFIRMED'::"AppointmentStatus", 'ROUTINE'::"Priority", 'WALK_IN'::"AppointmentSource",
          ${admin.id}, NOW(), NOW()
        )
      `;
      return prisma.appointment.findUniqueOrThrow({ where: { id } });
    };
    appointmentA = await createFixtureAppointment(patientA.id, profileA.id, "09:00", 9001);
    appointmentB = await createFixtureAppointment(patientB.id, profileB.id, "10:00", 9002);
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
    redis.disconnect();
  });

  it("allows own records and rejects modified cross-doctor IDs", async () => {
    const tokenA = await login(doctorA.email);
    const tokenB = await login(doctorB.email);
    const queueDate = appointmentDate;
    const queueA = await request(app).get(`/api/v1/opd-queue?date=${queueDate}`).set("Authorization", `Bearer ${tokenA}`);
    const queueB = await request(app).get(`/api/v1/opd-queue?date=${queueDate}`).set("Authorization", `Bearer ${tokenB}`);
    expect(queueA.status).toBe(200);
    expect(queueB.status).toBe(200);
    expect(queueA.body.data.map((appointment: { id: string }) => appointment.id)).toEqual([appointmentA.id]);
    expect(queueB.body.data.map((appointment: { id: string }) => appointment.id)).toEqual([appointmentB.id]);
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

  it("returns and persists the appointment advanced by call-next", async () => {
    const adminToken = await login(admin.email);
    const response = await request(app)
      .post(`/api/v1/opd-queue/${profileA.id}/call-next`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(appointmentA.id);
    expect(response.body.data.status).toBe("WAITING");
    await expect(prisma.appointment.findUnique({ where: { id: appointmentA.id }, select: { status: true } }))
      .resolves.toEqual({ status: "WAITING" });
    expect((await request(app).get(`/api/v1/appointments/${appointmentA.id}`).set("Authorization", `Bearer ${adminToken}`)).body.data.status).toBe("WAITING");
  });
});
