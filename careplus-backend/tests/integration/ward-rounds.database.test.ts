import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { daysBetweenHospitalDates, hospitalDateKey } from "../../src/modules/wards/wardRounds.service";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = "WardRounds@12345";
let admin: Awaited<ReturnType<typeof prisma.user.create>>;
let doctorA: Awaited<ReturnType<typeof prisma.user.create>>;
let doctorB: Awaited<ReturnType<typeof prisma.user.create>>;
let department: Awaited<ReturnType<typeof prisma.department.create>>;
let profileA: Awaited<ReturnType<typeof prisma.doctor.create>>;
let profileB: Awaited<ReturnType<typeof prisma.doctor.create>>;
let patient: Awaited<ReturnType<typeof prisma.patient.create>>;
let ward: Awaited<ReturnType<typeof prisma.ward.create>>;
let room: Awaited<ReturnType<typeof prisma.room.create>>;
let bed: Awaited<ReturnType<typeof prisma.bed.create>>;
let admission: Awaited<ReturnType<typeof prisma.admission.create>>;

async function tokenFor(email: string) {
  const result = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(result.status).toBe(200);
  return result.body.data.accessToken as string;
}

describe("Ward round API", () => {
  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    [admin, doctorA, doctorB] = await Promise.all([
      prisma.user.create({ data: { name: `Rounds Admin ${suffix}`, email: `rounds-admin-${suffix}@test.local`, passwordHash, role: "ADMIN" } }),
      prisma.user.create({ data: { name: `Rounds Doctor A ${suffix}`, email: `rounds-doctor-a-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: `Rounds Doctor B ${suffix}`, email: `rounds-doctor-b-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
    ]);
    department = await prisma.department.create({ data: { name: `Rounds Department ${suffix}` } });
    [profileA, profileB] = await Promise.all([
      prisma.doctor.create({ data: { userId: doctorA.id, departmentId: department.id, consultationFee: 100 } }),
      prisma.doctor.create({ data: { userId: doctorB.id, departmentId: department.id, consultationFee: 100 } }),
    ]);
    patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-ROUND-${suffix}`,
        firstName: "Ward",
        lastName: "Round",
        age: 48,
        gender: "OTHER",
        phone: `0300${Date.now().toString().slice(-7)}`,
        allergies: ["Penicillin"],
        createdBy: admin.id,
      },
    });
    ward = await prisma.ward.create({ data: { wardName: `Rounds Ward ${suffix}`, wardType: "GENERAL", dailyRate: 5000, capacity: 1 } });
    room = await prisma.room.create({ data: { wardId: ward.id, roomNumber: `WR-${suffix}` } });
    bed = await prisma.bed.create({ data: { roomId: room.id, bedNumber: `WR-${suffix}`, status: "OCCUPIED", dailyRate: 5000 } });
    admission = await prisma.admission.create({
      data: {
        patientId: patient.id,
        bedId: bed.id,
        attendingDoctorId: profileA.id,
        admissionReason: "Ward round integration test",
        createdBy: admin.id,
      },
    });
  });

  afterAll(async () => {
    if (admission) {
      await prisma.wardRound.deleteMany({ where: { admissionId: admission.id } });
      await prisma.admission.delete({ where: { id: admission.id } });
    }
    if (bed) await prisma.bed.delete({ where: { id: bed.id } });
    if (room) await prisma.room.delete({ where: { id: room.id } });
    if (ward) await prisma.ward.delete({ where: { id: ward.id } });
    if (patient) await prisma.patient.delete({ where: { id: patient.id } });
    if (profileA && profileB) await prisma.doctor.deleteMany({ where: { id: { in: [profileA.id, profileB.id] } } });
    if (admin && doctorA && doctorB) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.id, doctorA.id, doctorB.id] }, module: "wards" } });
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, doctorA.id, doctorB.id] } } });
    }
    if (department) await prisma.department.delete({ where: { id: department.id } });
    redis.disconnect();
  });

  it("creates immutable append-only round entries, scopes doctors, and reflects a round on today's board", async () => {
    const doctorToken = await tokenFor(doctorA.email);
    const otherDoctorToken = await tokenFor(doctorB.email);
    const emptyRound = await request(app)
      .post(`/api/v1/wards/admissions/${admission.id}/rounds`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({});
    expect(emptyRound.status).toBe(422);
    expect(emptyRound.body.message).toContain("Enter at least one ward-round note");

    const created = await request(app)
      .post(`/api/v1/wards/admissions/${admission.id}/rounds`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ subjective: "Pain improving", findings: "Afebrile", assessment: "Recovering", plan: "Continue observation" });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual(expect.objectContaining({
      admissionId: admission.id,
      doctorId: doctorA.id,
      subjective: "Pain improving",
      findings: "Afebrile",
      assessment: "Recovering",
      plan: "Continue observation",
    }));

    const rounds = await request(app)
      .get(`/api/v1/wards/admissions/${admission.id}/rounds`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(rounds.status).toBe(200);
    expect(rounds.body.data).toHaveLength(1);

    const denied = await request(app)
      .get(`/api/v1/wards/admissions/${admission.id}/rounds`)
      .set("Authorization", `Bearer ${otherDoctorToken}`);
    expect(denied.status).toBe(403);

    const deleted = await request(app)
      .delete(`/api/v1/wards/admissions/${admission.id}/rounds/${created.body.data.id}`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(deleted.status).toBe(404);

    const today = await request(app)
      .get("/api/v1/doctors/me/ward-rounds/today")
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(today.status).toBe(200);
    expect(today.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: admission.id,
        roundDoneToday: true,
        readyForDischarge: false,
        patient: expect.objectContaining({ allergies: ["Penicillin"] }),
        bed: expect.objectContaining({ bedNumber: bed.bedNumber }),
      }),
    ]));
  });

  it("uses calendar dates in Asia/Karachi for midnight and admitted-day boundaries", () => {
    expect(hospitalDateKey(new Date("2026-10-07T18:59:59.000Z"))).toBe("2026-10-07");
    expect(hospitalDateKey(new Date("2026-10-07T19:00:00.000Z"))).toBe("2026-10-08");
    expect(daysBetweenHospitalDates(new Date("2026-10-07T18:55:00.000Z"), new Date("2026-10-07T19:05:00.000Z"))).toBe(1);
    expect(daysBetweenHospitalDates(new Date("2026-10-07T17:00:00.000Z"), new Date("2026-10-07T18:00:00.000Z"))).toBe(0);
  });
});
