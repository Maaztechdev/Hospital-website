import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const password = "OtWorkflow@12345";
const checklist = {
  consent_form_confirmed: true,
  fasting_confirmed: true,
  blood_arranged: true,
  required_reports_reviewed: true,
  identity_verified: false,
  allergies_checked: false,
  pre_op_vitals_recorded: false,
};

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

function todayAt(hour: number, minute = 0) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:00`);
}

describe("Integration: OT surgery state machine", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let admin: Awaited<ReturnType<typeof prisma.user.create>>;
  let surgeonUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let assistantUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let outsiderUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let surgeon: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let assistant: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let outsider: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let department: Awaited<ReturnType<typeof prisma.department.create>>;
  let patient: Awaited<ReturnType<typeof prisma.patient.create>>;
  let room: Awaited<ReturnType<typeof prisma.otRoom.create>>;

  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    [admin, surgeonUser, assistantUser, outsiderUser] = await Promise.all([
      prisma.user.create({ data: { name: `OT Admin ${suffix}`, email: `ot-admin-${suffix}@test.local`, passwordHash, role: "ADMIN" } }),
      prisma.user.create({ data: { name: `OT Surgeon ${suffix}`, email: `ot-surgeon-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: `OT Assistant ${suffix}`, email: `ot-assistant-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: `OT Outsider ${suffix}`, email: `ot-outsider-${suffix}@test.local`, passwordHash, role: "DOCTOR" } }),
    ]);
    department = await prisma.department.create({ data: { name: `OT Workflow ${suffix}` } });
    [surgeon, assistant, outsider] = await Promise.all([
      prisma.doctor.create({ data: { userId: surgeonUser.id, departmentId: department.id, consultationFee: 100 } }),
      prisma.doctor.create({ data: { userId: assistantUser.id, departmentId: department.id, consultationFee: 100 } }),
      prisma.doctor.create({ data: { userId: outsiderUser.id, departmentId: department.id, consultationFee: 100 } }),
    ]);
    room = await prisma.otRoom.create({ data: { roomName: `OT Workflow ${suffix}` } });
    patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-OT-WF-${suffix}`,
        firstName: "OT Workflow",
        lastName: "Patient",
        age: 36,
        gender: "OTHER",
        phone: `0300${Date.now().toString().slice(-7)}`,
        createdBy: admin.id,
      },
    });
  });

  afterAll(async () => {
    if (patient) {
      const surgeries = await prisma.surgery.findMany({ where: { patientId: patient.id }, select: { id: true } });
      const ids = surgeries.map((surgery) => surgery.id);
      await prisma.notification.deleteMany({ where: { relatedEntityType: "Surgery", relatedEntityId: { in: ids } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "Surgery", entityId: { in: ids } } });
      await prisma.surgery.deleteMany({ where: { id: { in: ids } } });
      await prisma.patient.delete({ where: { id: patient.id } });
    }
    if (room) await prisma.otRoom.delete({ where: { id: room.id } });
    if (surgeon && assistant && outsider) {
      await prisma.doctor.deleteMany({ where: { id: { in: [surgeon.id, assistant.id, outsider.id] } } });
    }
    if (admin && surgeonUser && assistantUser && outsiderUser) {
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, surgeonUser.id, assistantUser.id, outsiderUser.id] } } });
    }
    if (department) await prisma.department.delete({ where: { id: department.id } });
    redis.disconnect();
  });

  it("enforces transitions, checklist/override gates, room exclusion, roles, audit and notifications", async () => {
    const [adminToken, surgeonToken, assistantToken, outsiderToken] = await Promise.all([
      login(admin.email), login(surgeonUser.email), login(assistantUser.email), login(outsiderUser.email),
    ]);
    const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
    const create = async (name: string, priority: "ELECTIVE" | "EMERGENCY" = "ELECTIVE") => prisma.surgery.create({
      data: {
        patientId: patient.id,
        otRoomId: room.id,
        surgeryType: `${name} ${suffix}`,
        priority,
        surgeonId: surgeon.id,
        assistantSurgeonId: assistant.id,
        scheduledStart: todayAt(8),
        scheduledEnd: todayAt(9),
        createdBy: admin.id,
      },
    });

    const main = await create("Main");
    const forbidden = await request(app).post(`/api/v1/ot/surgeries/${main.id}/pre-op`).set(headers(outsiderToken)).send({});
    expect(forbidden.status).toBe(403);
    expect((await request(app).post(`/api/v1/ot/surgeries/${main.id}/start`).set(headers(assistantToken)).send({})).status).toBe(409);
    expect((await request(app).post(`/api/v1/ot/surgeries/${main.id}/complete`).set(headers(adminToken)).send({ postOpNotes: "premature" })).status).toBe(409);
    expect((await request(app).post(`/api/v1/ot/surgeries/${main.id}/pre-op`).set(headers(assistantToken)).send({})).status).toBe(200);
    const preOp = await prisma.surgery.findUniqueOrThrow({ where: { id: main.id } });
    expect(preOp).toMatchObject({ status: "PRE_OP", preOpStartedBy: assistantUser.id });
    expect(preOp.preOpStartedAt).toBeInstanceOf(Date);

    const checklistGate = await request(app).post(`/api/v1/ot/surgeries/${main.id}/start`).set(headers(assistantToken)).send({});
    expect(checklistGate.status).toBe(409);
    expect(checklistGate.body.message).toContain("Pre-op checklist incomplete");
    expect((await request(app).patch(`/api/v1/ot/surgeries/${main.id}/checklist`).set(headers(surgeonToken)).send(checklist)).status).toBe(200);
    const started = await request(app).post(`/api/v1/ot/surgeries/${main.id}/start`).set(headers(assistantToken)).send({});
    expect(started.status).toBe(200);
    expect(await prisma.surgery.findUniqueOrThrow({ where: { id: main.id } })).toMatchObject({
      status: "IN_PROGRESS", startedBy: assistantUser.id,
    });
    expect((await request(app).post(`/api/v1/ot/surgeries/${main.id}/start`).set(headers(adminToken)).send({})).status).toBe(409);

    const roomBlocked = await create("Room conflict");
    await prisma.surgery.update({ where: { id: roomBlocked.id }, data: { preOpChecklistJson: checklist } });
    await request(app).post(`/api/v1/ot/surgeries/${roomBlocked.id}/pre-op`).set(headers(adminToken)).send({});
    const inUse = await request(app).post(`/api/v1/ot/surgeries/${roomBlocked.id}/start`).set(headers(adminToken)).send({});
    expect(inUse.status).toBe(409);
    expect(inUse.body.message).toContain(main.id);

    const invalidRecovery = await request(app).post(`/api/v1/ot/surgeries/${main.id}/recovery`).set(headers(assistantToken)).send({});
    expect(invalidRecovery.status).toBe(422);
    const recovery = await request(app).post(`/api/v1/ot/surgeries/${main.id}/recovery`).set(headers(assistantToken)).send({
      intraoperativeNotes: "No complications during procedure.",
      outcomeNotes: "Patient stable and transferred to recovery.",
    });
    expect(recovery.status).toBe(200);
    expect(await prisma.surgery.findUniqueOrThrow({ where: { id: main.id } })).toMatchObject({
      status: "RECOVERY",
      endedBy: assistantUser.id,
      intraoperativeNotes: "No complications during procedure.",
      outcomeNotes: "Patient stable and transferred to recovery.",
    });
    expect((await request(app).post(`/api/v1/ot/surgeries/${main.id}/complete`).set(headers(adminToken)).send({})).status).toBe(422);
    expect((await request(app).post(`/api/v1/ot/surgeries/${main.id}/complete`).set(headers(adminToken)).send({ postOpNotes: "Discharged to ward." })).status).toBe(200);
    expect((await prisma.surgery.findUniqueOrThrow({ where: { id: main.id } })).status).toBe("COMPLETED");

    const emergency = await create("Emergency", "EMERGENCY");
    await request(app).post(`/api/v1/ot/surgeries/${emergency.id}/pre-op`).set(headers(adminToken)).send({});
    expect((await request(app).post(`/api/v1/ot/surgeries/${emergency.id}/start`).set(headers(adminToken)).send({})).body.message).toContain("written reason");
    const override = await request(app).post(`/api/v1/ot/surgeries/${emergency.id}/start`).set(headers(adminToken)).send({ emergencyOverrideReason: "Immediate life-saving intervention required." });
    expect(override.status).toBe(200);
    expect((await prisma.surgery.findUniqueOrThrow({ where: { id: emergency.id } })).emergencyOverrideReason).toBe("Immediate life-saving intervention required.");
    const overrideAudit = await prisma.auditLog.findFirst({
      where: { entityType: "Surgery", entityId: emergency.id, action: "STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
      select: { newValuesJson: true },
    });
    expect(overrideAudit?.newValuesJson).toMatchObject({
      reason: "Immediate life-saving intervention required.",
      status: "IN_PROGRESS",
    });

    const scheduled = await create("Postponement");
    const futureStart = new Date(Date.now() + 90 * 24 * 60 * 60_000);
    const futureParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(futureStart);
    const part = (type: string) => futureParts.find((item) => item.type === type)?.value ?? "00";
    const targetStart = new Date(`${part("year")}-${part("month")}-${part("day")}T10:00:00+05:00`);
    await prisma.surgery.create({
      data: {
        patientId: patient.id, otRoomId: room.id, surgeryType: `Postponement conflict ${suffix}`,
        surgeonId: surgeon.id, scheduledStart: targetStart, scheduledEnd: new Date(targetStart.getTime() + 60 * 60_000), createdBy: admin.id,
      },
    });
    const conflict = await request(app).post(`/api/v1/ot/surgeries/${scheduled.id}/postpone`).set(headers(adminToken)).send({
      reason: "Try conflicting slot.",
      scheduledStart: targetStart.toISOString(),
      scheduledEnd: new Date(targetStart.getTime() + 60 * 60_000).toISOString(),
    });
    expect(conflict.status).toBe(409);
    const clearTargetStart = new Date(targetStart.getTime() + 24 * 60 * 60_000);
    const postponed = await request(app).post(`/api/v1/ot/surgeries/${scheduled.id}/postpone`).set(headers(adminToken)).send({
      reason: "Required equipment delayed.",
      scheduledStart: clearTargetStart.toISOString(),
      scheduledEnd: new Date(clearTargetStart.getTime() + 60 * 60_000).toISOString(),
    });
    expect(postponed.status).toBe(200);
    expect(postponed.body.data.status).toBe("SCHEDULED");
    expect(postponed.body.data.postponeReason).toBe("Required equipment delayed.");
    const events = await prisma.surgeryStatusEvent.findMany({ where: { surgeryId: scheduled.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.toStatus)).toEqual(expect.arrayContaining(["POSTPONED", "SCHEDULED"]));

    const cancellable = await create("Cancellation");
    expect((await request(app).post(`/api/v1/ot/surgeries/${cancellable.id}/cancel`).set(headers(adminToken)).send({})).status).toBe(422);
    expect((await request(app).post(`/api/v1/ot/surgeries/${cancellable.id}/cancel`).set(headers(adminToken)).send({ reason: "Patient condition changed." })).status).toBe(200);

    const statusEvents = await prisma.surgeryStatusEvent.findMany({ where: { surgeryId: main.id } });
    expect(statusEvents.map((event) => event.toStatus)).toEqual(["PRE_OP", "IN_PROGRESS", "RECOVERY", "COMPLETED"]);
    expect(await prisma.auditLog.count({ where: { entityType: "Surgery", entityId: main.id, action: "STATUS_CHANGE" } })).toBe(4);
    expect(await prisma.notification.count({ where: { relatedEntityType: "Surgery", relatedEntityId: main.id, notificationType: "OT_STATUS_CHANGED", userId: assistantUser.id } })).toBe(4);
    const summaryResponse = await request(app).get("/api/v1/ot/surgeries/summary").set(headers(adminToken));
    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data).toEqual(expect.objectContaining({
      todaysSurgeries: expect.any(Number),
      inProgress: expect.any(Number),
      completedToday: expect.any(Number),
      conflicts: expect.any(Number),
    }));
    expect(summaryResponse.body.data.inProgress).toBeGreaterThan(0);
    expect(summaryResponse.body.data.completedToday).toBeGreaterThan(0);

    const nextDay = new Date(todayAt(8).getTime() + 24 * 60 * 60_000);
    const nextDaySurgery = await prisma.surgery.create({
      data: {
        patientId: patient.id, otRoomId: room.id, surgeryType: `Wrong pre-op day ${suffix}`,
        surgeonId: surgeon.id, scheduledStart: nextDay, scheduledEnd: new Date(nextDay.getTime() + 60 * 60_000), createdBy: admin.id,
      },
    });
    const wrongDay = await request(app).post(`/api/v1/ot/surgeries/${nextDaySurgery.id}/pre-op`).set(headers(adminToken)).send({});
    expect(wrongDay.status).toBe(409);
    expect(wrongDay.body.message).toBe("Pre-op can only start on the scheduled surgery day (hospital time: Asia/Karachi)");
  });
});
