import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const password = "OtSchedule@12345";

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe("Integration: OT surgery scheduling authorization", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let doctorA: Awaited<ReturnType<typeof prisma.user.create>>;
  let doctorB: Awaited<ReturnType<typeof prisma.user.create>>;
  let admin: Awaited<ReturnType<typeof prisma.user.create>>;
  let profileA: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let profileB: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let patient: Awaited<ReturnType<typeof prisma.patient.create>>;
  let room: Awaited<ReturnType<typeof prisma.otRoom.findFirstOrThrow>>;
  let secondRoom: Awaited<ReturnType<typeof prisma.otRoom.create>>;
  let department: Awaited<ReturnType<typeof prisma.department.create>>;

  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    [doctorA, doctorB, admin] = await Promise.all([
      prisma.user.create({ data: { name: "OT Doctor A", email: `ot-doctor-a-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: "OT Doctor B", email: `ot-doctor-b-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: "OT Admin", email: `ot-admin-${suffix}@test.local`, passwordHash, role: "ADMIN" } }),
    ]);
    department = await prisma.department.create({ data: { name: `OT Regression ${suffix}` } });
    [profileA, profileB] = await Promise.all([
      prisma.doctor.create({ data: { userId: doctorA.id, departmentId: department.id, consultationFee: 100 } }),
      prisma.doctor.create({ data: { userId: doctorB.id, departmentId: department.id, consultationFee: 100 } }),
    ]);
    room = await prisma.otRoom.findFirstOrThrow({ where: { isActive: true } });
    secondRoom = await prisma.otRoom.create({ data: { roomName: `OT Regression Extra ${suffix}` } });
    patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-OT-${suffix}`,
        firstName: "OT Regression",
        lastName: "Patient",
        age: 36,
        gender: "OTHER",
        phone: `0300${Date.now().toString().slice(-7)}`,
        createdBy: admin.id,
      },
    });
    await prisma.surgery.create({
      data: {
        patientId: patient.id,
        otRoomId: room.id,
        surgeryType: `OT patient access fixture ${suffix}`,
        surgeonId: profileA.id,
        scheduledStart: new Date("2000-01-01T00:00:00.000Z"),
        scheduledEnd: new Date("2000-01-01T01:00:00.000Z"),
        createdBy: admin.id,
      },
    });
  });

  afterAll(async () => {
    if (patient) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: [doctorA.id, doctorB.id, admin.id] }, module: "ot" } });
      await prisma.surgery.deleteMany({ where: { patientId: patient.id } });
      await prisma.patient.delete({ where: { id: patient.id } });
    }
    if (profileA && profileB) await prisma.doctor.deleteMany({ where: { id: { in: [profileA.id, profileB.id] } } });
    if (doctorA && doctorB && admin) await prisma.user.deleteMany({ where: { id: { in: [doctorA.id, doctorB.id, admin.id] } } });
    if (department) await prisma.department.delete({ where: { id: department.id } });
    if (secondRoom) await prisma.otRoom.delete({ where: { id: secondRoom.id } });
    redis.disconnect();
  });

  function surgeryInput(surgeonId: string, hoursFromNow: number) {
    const scheduledStart = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    scheduledStart.setUTCDate(scheduledStart.getUTCDate() + Math.floor(hoursFromNow / 10));
    scheduledStart.setUTCHours(5 + (hoursFromNow % 10), 0, 0, 0);
    return {
      patientId: patient.id,
      otRoomId: room.id,
      surgeryType: `OT scheduling regression ${suffix}`,
      anesthesiaType: "General",
      surgeonId,
      scheduledStart: scheduledStart.toISOString(),
      scheduledEnd: new Date(scheduledStart.getTime() + 60 * 60 * 1000).toISOString(),
    };
  }

  it("allows doctors to schedule only for themselves, admins for anyone, and rejects room conflicts", async () => {
    const [doctorToken, adminToken] = await Promise.all([login(doctorA.email), login(admin.email)]);
    const currentUser = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(currentUser.body.data).toMatchObject({ id: doctorA.id, name: doctorA.name, email: doctorA.email, role: "DOCTOR" });

    const doctorsResponse = await request(app)
      .get("/api/v1/appointments/doctors")
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(doctorsResponse.status).toBe(200);
    expect(doctorsResponse.body.data.find((doctor: { id: string }) => doctor.id === profileA.id).user.id).toBe(doctorA.id);

    const ownSurgery = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(surgeryInput(profileA.id, 0));
    expect(ownSurgery.status).toBe(201);
    const ownSurgeryDetail = await request(app)
      .get(`/api/v1/ot/surgeries/${ownSurgery.body.data.id}`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(ownSurgeryDetail.body.data.otRoom.name).toBe(room.roomName);

    const anotherSurgeon = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(surgeryInput(profileB.id, 3));
    expect(anotherSurgeon.status).toBe(403);
    expect(anotherSurgeon.body.message).toBe("You can only schedule surgeries for yourself");

    const adminSurgery = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(surgeryInput(profileB.id, 6));
    expect(adminSurgery.status).toBe(201);

    const conflictInput = surgeryInput(profileA.id, 9);
    const firstBooking = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(conflictInput);
    expect(firstBooking.status).toBe(201);

    const conflict = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(conflictInput);
    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toBe(`${room.roomName} is already booked at that time`);

    const invalidInput = surgeryInput(profileA.id, 12);
    const invalidSchedule = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        ...invalidInput,
        scheduledEnd: invalidInput.scheduledStart,
      });
    expect(invalidSchedule.status).toBe(422);

    const past = surgeryInput(profileA.id, 15);
    past.scheduledStart = "2000-01-01T10:00:00.000Z";
    past.scheduledEnd = "2000-01-01T11:00:00.000Z";
    const pastSchedule = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(past);
    expect(pastSchedule.status).toBe(422);
    expect(pastSchedule.body.message).toBe("Surgery start time must be in the future (hospital time: Asia/Karachi)");

    const missingAnesthesia = surgeryInput(profileA.id, 16);
    delete (missingAnesthesia as Partial<typeof missingAnesthesia>).anesthesiaType;
    const missingAnesthesiaResponse = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(missingAnesthesia);
    expect(missingAnesthesiaResponse.status).toBe(422);
    expect(missingAnesthesiaResponse.body.errors.anesthesiaType).toBeDefined();

    const sharedPatientSlot = surgeryInput(profileA.id, 20);
    const patientBooking = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(sharedPatientSlot);
    expect(patientBooking.status).toBe(201);
    const patientDoubleBooking = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...sharedPatientSlot, otRoomId: secondRoom.id, surgeonId: profileB.id });
    expect(patientDoubleBooking.status).toBe(409);
    expect(patientDoubleBooking.body.message).toBe("Patient already has an overlapping surgery scheduled");
  });

  it("rejects past starts with the hospital-time message and requires anesthesia type", async () => {
    const doctorToken = await login(doctorA.email);
    const pastInput = surgeryInput(profileA.id, 0);
    pastInput.scheduledStart = "2026-10-06T23:50:00+05:00";
    pastInput.scheduledEnd = "2026-10-07T00:50:00+05:00";
    const pastSchedule = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(pastInput);
    expect(pastSchedule.status).toBe(422);
    expect(pastSchedule.body.message).toBe("Surgery start time must be in the future (hospital time: Asia/Karachi)");

    const missingAnesthesia: Record<string, unknown> = surgeryInput(profileA.id, 30);
    delete missingAnesthesia.anesthesiaType;
    const missingAnesthesiaResponse = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(missingAnesthesia);
    expect(missingAnesthesiaResponse.status).toBe(422);
    expect(missingAnesthesiaResponse.body.errors.anesthesiaType).toBeDefined();
  });
});
