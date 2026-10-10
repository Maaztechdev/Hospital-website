import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { admitPatientSchema } from "../../src/modules/wards/wards.validators";
import { assertBedStatusTransitionAllowed } from "../../src/modules/wards/bedStatusTransitions";

const app = createApp();
const password = "WardAdmission@12345";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const validAdmission = {
  patientId: "123e4567-e89b-42d3-a456-426614174000",
  bedId: "223e4567-e89b-42d3-a456-426614174000",
  attendingDoctorId: "323e4567-e89b-42d3-a456-426614174000",
  admissionType: "PLANNED" as const,
  admissionReason: "Observation",
  depositAmount: 1,
};

let admin: Awaited<ReturnType<typeof prisma.user.create>>;
let nurse: Awaited<ReturnType<typeof prisma.user.create>>;
let receptionist: Awaited<ReturnType<typeof prisma.user.create>>;
let doctorA: Awaited<ReturnType<typeof prisma.user.create>>;
let doctorB: Awaited<ReturnType<typeof prisma.user.create>>;
let department: Awaited<ReturnType<typeof prisma.department.create>>;
let profileA: Awaited<ReturnType<typeof prisma.doctor.create>>;
let profileB: Awaited<ReturnType<typeof prisma.doctor.create>>;
let patient: Awaited<ReturnType<typeof prisma.patient.create>>;
let unrelatedPatient: Awaited<ReturnType<typeof prisma.patient.create>>;
let concurrentPatient: Awaited<ReturnType<typeof prisma.patient.create>>;
let ward: Awaited<ReturnType<typeof prisma.ward.create>>;
let room: Awaited<ReturnType<typeof prisma.room.create>>;
let availableBed: Awaited<ReturnType<typeof prisma.bed.create>>;
let occupiedBed: Awaited<ReturnType<typeof prisma.bed.create>>;
let concurrentBed: Awaited<ReturnType<typeof prisma.bed.create>>;
let ownPatientBed: Awaited<ReturnType<typeof prisma.bed.create>>;
let otRoom: Awaited<ReturnType<typeof prisma.otRoom.create>>;

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe("Ward admission validation", () => {
  it("requires an explicit type and accepts only integer deposits from PKR 0 through PKR 1,000,000", () => {
    expect(admitPatientSchema.safeParse({ ...validAdmission, depositAmount: 0 }).success).toBe(true);
    expect(admitPatientSchema.safeParse({ ...validAdmission, depositAmount: -1 }).success).toBe(false);
    expect(admitPatientSchema.safeParse({ ...validAdmission, depositAmount: 1_000_001 }).success).toBe(false);
    expect(admitPatientSchema.safeParse({ ...validAdmission, depositAmount: 0.5 }).success).toBe(false);
    expect(admitPatientSchema.safeParse(validAdmission).success).toBe(true);
    expect(admitPatientSchema.safeParse({ ...validAdmission, depositAmount: undefined }).success).toBe(false);
    const { admissionType: _admissionType, ...missingType } = validAdmission;
    expect(admitPatientSchema.safeParse(missingType).success).toBe(false);
  });

  it("accepts only positive administrator-provided daily rates", () => {
    expect(admitPatientSchema.safeParse({ ...validAdmission, dailyRate: 0 }).success).toBe(false);
    expect(admitPatientSchema.safeParse({ ...validAdmission, dailyRate: 1 }).success).toBe(true);
  });
});

describe("Ward admission authorization and bed concurrency", () => {
  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    [admin, nurse, doctorA, doctorB, receptionist] = await Promise.all([
      prisma.user.create({ data: { name: `Ward Admin ${suffix}`, email: `ward-admin-${suffix}@test.local`, passwordHash, role: "ADMIN" } }),
      prisma.user.create({ data: { name: `Ward Nurse ${suffix}`, email: `ward-nurse-${suffix}@test.local`, passwordHash, role: "NURSE" } }),
      prisma.user.create({ data: { name: `Ward Doctor A ${suffix}`, email: `ward-doctor-a-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: `Ward Doctor B ${suffix}`, email: `ward-doctor-b-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: `Ward Reception ${suffix}`, email: `ward-reception-${suffix}@test.local`, passwordHash, role: "RECEPTIONIST" } }),
    ]);
    department = await prisma.department.create({ data: { name: `Ward Admission ${suffix}` } });
    [profileA, profileB] = await Promise.all([
      prisma.doctor.create({ data: { userId: doctorA.id, departmentId: department.id, consultationFee: 100 } }),
      prisma.doctor.create({ data: { userId: doctorB.id, departmentId: department.id, consultationFee: 100 } }),
    ]);
    patient = await prisma.patient.create({
      data: { mrNumber: `MR-WARD-${suffix}`, firstName: "Ward", lastName: "Admission", age: 35, gender: "OTHER", phone: `0300${Date.now().toString().slice(-7)}`, createdBy: admin.id },
    });
    unrelatedPatient = await prisma.patient.create({
      data: { mrNumber: `MR-WARD-X-${suffix}`, firstName: "Unrelated", lastName: "Patient", age: 35, gender: "OTHER", phone: `0301${Date.now().toString().slice(-7)}`, createdBy: admin.id },
    });
    concurrentPatient = await prisma.patient.create({
      data: { mrNumber: `MR-WARD-C-${suffix}`, firstName: "Concurrent", lastName: "Patient", age: 35, gender: "OTHER", phone: `0302${Date.now().toString().slice(-7)}`, createdBy: admin.id },
    });
    ward = await prisma.ward.create({ data: { wardName: `Ward Admission ${suffix}`, wardType: "GENERAL", dailyRate: 5000, capacity: 4 } });
    room = await prisma.room.create({ data: { wardId: ward.id, roomNumber: `WA-${suffix}` } });
    otRoom = await prisma.otRoom.create({ data: { roomName: `Ward Auth OT ${suffix}` } });
    await prisma.surgery.create({
      data: {
        patientId: patient.id,
        otRoomId: otRoom.id,
        surgeonId: profileA.id,
        surgeryType: "Authorization patient relationship",
        scheduledStart: new Date("2000-01-01T00:00:00.000Z"),
        scheduledEnd: new Date("2000-01-01T01:00:00.000Z"),
        status: "COMPLETED",
        createdBy: admin.id,
      },
    });
    [availableBed, occupiedBed, concurrentBed, ownPatientBed] = await Promise.all([
      prisma.bed.create({ data: { roomId: room.id, bedNumber: "101-A", dailyRate: 5000 } }),
      prisma.bed.create({ data: { roomId: room.id, bedNumber: "101-B", dailyRate: 5000, status: "OCCUPIED" } }),
      prisma.bed.create({ data: { roomId: room.id, bedNumber: "101-C", dailyRate: 5000 } }),
      prisma.bed.create({ data: { roomId: room.id, bedNumber: "101-D", dailyRate: 5000 } }),
    ]);
  });

  afterAll(async () => {
    if (admin && nurse && doctorA && doctorB && receptionist) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.id, nurse.id, doctorA.id, doctorB.id, receptionist.id] }, module: "wards" } });
      await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.id, nurse.id, doctorA.id, doctorB.id, receptionist.id] }, module: "ot" } });
    }
    if (patient || unrelatedPatient || concurrentPatient) {
      const patientIds = [patient?.id, unrelatedPatient?.id, concurrentPatient?.id].filter((id): id is string => Boolean(id));
      await prisma.patientLedgerEntry.deleteMany({ where: { patientId: { in: patientIds } } });
      await prisma.admission.deleteMany({ where: { patientId: { in: patientIds } } });
    }
    if (patient) await prisma.surgery.deleteMany({ where: { patientId: patient.id } });
    if (availableBed && occupiedBed && concurrentBed && ownPatientBed) {
      await prisma.bed.deleteMany({ where: { id: { in: [availableBed.id, occupiedBed.id, concurrentBed.id, ownPatientBed.id] } } });
    }
    if (room) await prisma.room.delete({ where: { id: room.id } });
    if (ward) await prisma.ward.delete({ where: { id: ward.id } });
    if (otRoom) await prisma.otRoom.delete({ where: { id: otRoom.id } });
    if (patient) await prisma.patient.delete({ where: { id: patient.id } });
    if (unrelatedPatient) await prisma.patient.delete({ where: { id: unrelatedPatient.id } });
    if (concurrentPatient) await prisma.patient.delete({ where: { id: concurrentPatient.id } });
    if (profileA && profileB) await prisma.doctor.deleteMany({ where: { id: { in: [profileA.id, profileB.id] } } });
    if (admin && nurse && doctorA && doctorB && receptionist) await prisma.user.deleteMany({ where: { id: { in: [admin.id, nurse.id, doctorA.id, doctorB.id, receptionist.id] } } });
    if (department) await prisma.department.delete({ where: { id: department.id } });
    redis.disconnect();
  });

  function admissionInput(bedId: string, attendingDoctorId: string, depositAmount = 0) {
    return {
      patientId: patient.id,
      bedId,
      attendingDoctorId,
      admissionType: "PLANNED",
      admissionReason: "Focused ward admission test",
      depositAmount,
    };
  }

  it("allows a nurse to admit any patient and a doctor only under their own name or for their own patient", async () => {
    const nurseToken = await login(nurse.email);
    const nurseAdmission = await request(app)
      .post("/api/v1/wards/admissions")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ ...admissionInput(availableBed.id, profileB.id), patientId: unrelatedPatient.id });
    expect(nurseAdmission.status).toBe(201);

    const doctorToken = await login(doctorA.email);
    const ownPatientAdmission = await request(app)
      .post("/api/v1/wards/admissions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ ...admissionInput(ownPatientBed.id, profileB.id), depositAmount: "not-a-deposit", dailyRate: -1, expectedStayDays: 0, admissionNotes: "Clinically stable for ward observation" });
    expect(ownPatientAdmission.status).toBe(201);
    expect(ownPatientAdmission.body.data).toEqual(expect.objectContaining({
      depositAmount: "0",
      depositStatus: "PENDING",
      dailyRate: "5000",
      admissionNotes: "Clinically stable for ward observation",
    }));
    expect(await prisma.patientLedgerEntry.count({ where: { admissionId: ownPatientAdmission.body.data.id, type: "ADVANCE_DEPOSIT" } })).toBe(0);
    const receptionistToken = await login(receptionist.email);
    const recordedDeposit = await request(app)
      .post(`/api/v1/wards/admissions/${ownPatientAdmission.body.data.id}/deposits`)
      .set("Authorization", "Bearer " + receptionistToken)
      .send({ amount: 10_000, paymentMethod: "CASH" });
    expect(recordedDeposit.status).toBe(201);
    expect(recordedDeposit.body.data).toEqual(expect.objectContaining({ depositAmount: "10000", depositStatus: "PAID" }));
    const duplicateAdmission = await request(app)
      .post("/api/v1/wards/admissions")
      .set("Authorization", "Bearer " + doctorToken)
      .send(admissionInput(concurrentBed.id, profileA.id));
    expect(duplicateAdmission.status).toBe(409);
    expect(duplicateAdmission.body.message).toBe("Patient already has an active admission");
    const profile = await request(app)
      .get(`/api/v1/patients/${patient.id}/profile`)
      .set("Authorization", "Bearer " + doctorToken);
    expect(profile.status).toBe(200);
    expect(profile.body.data.ledgerEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "ADVANCE_DEPOSIT", amount: "10000" }),
    ]));

    const underAnotherDoctor = await request(app)
      .post("/api/v1/wards/admissions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ ...admissionInput(occupiedBed.id, profileB.id), patientId: unrelatedPatient.id });
    expect(underAnotherDoctor.status).toBe(403);
    expect(underAnotherDoctor.body.message).toBe("Doctors can only admit patients under their own name");
  });

  it("returns a specific conflict when the requested bed is occupied", async () => {
    const nurseToken = await login(nurse.email);
    const response = await request(app)
      .post("/api/v1/wards/admissions")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send(admissionInput(occupiedBed.id, profileB.id));
    expect(response.status).toBe(409);
    expect(response.body.message).toBe("Bed 101-B is no longer available");
  });

  it("allows exactly one of two concurrent admissions to the same available bed", async () => {
    const doctorToken = await login(doctorA.email);
    const input = { ...admissionInput(concurrentBed.id, profileA.id), patientId: concurrentPatient.id };
    const responses = await Promise.all([
      request(app).post("/api/v1/wards/admissions").set("Authorization", `Bearer ${doctorToken}`).send(input),
      request(app).post("/api/v1/wards/admissions").set("Authorization", `Bearer ${doctorToken}`).send(input),
    ]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
  });

  it("returns field-specific 422 errors for a fractional deposit", async () => {
    const nurseToken = await login(nurse.email);
    const response = await request(app)
      .post("/api/v1/wards/admissions")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send(admissionInput(occupiedBed.id, profileB.id, 1.5));
    expect(response.status).toBe(422);
    expect(response.body.errors).toHaveProperty("depositAmount");
  });

  it("uses the shared doctor-profile authorization for Operation Theatre scheduling", async () => {
    const doctorToken = await login(doctorA.email);
    const scheduledStart = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
    scheduledStart.setUTCHours(10, 0, 0, 0);
    const surgeryInput = {
      patientId: patient.id,
      otRoomId: otRoom.id,
      surgeryType: "Shared authorization regression",
      anesthesiaType: "General",
      surgeonId: profileA.id,
      scheduledStart: scheduledStart.toISOString(),
      scheduledEnd: new Date(scheduledStart.getTime() + 60 * 60 * 1000).toISOString(),
    };
    const ownSurgery = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send(surgeryInput);
    expect(ownSurgery.status).toBe(201);

    const anotherSurgeon = await request(app)
      .post("/api/v1/ot/surgeries")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ ...surgeryInput, surgeonId: profileB.id });
    expect(anotherSurgeon.status).toBe(403);
    expect(anotherSurgeon.body.message).toBe("You can only schedule surgeries for yourself");
  });
});

describe("Bed status transitions", () => {
  it("allows Cleaning -> Available and Maintenance <-> Available", () => {
    expect(() => assertBedStatusTransitionAllowed("CLEANING", "AVAILABLE")).not.toThrow();
    expect(() => assertBedStatusTransitionAllowed("MAINTENANCE", "AVAILABLE")).not.toThrow();
    expect(() => assertBedStatusTransitionAllowed("AVAILABLE", "MAINTENANCE")).not.toThrow();
  });

  it("rejects Occupied -> Available directly", () => {
    expect(() => assertBedStatusTransitionAllowed("OCCUPIED", "AVAILABLE")).toThrow(
      expect.objectContaining({ statusCode: 409 })
    );
  });
});
