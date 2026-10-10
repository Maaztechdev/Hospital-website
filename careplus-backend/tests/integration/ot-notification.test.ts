import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();

describe("Integration: OT checklist notifications", () => {
  let surgeryId: string;
  let surgeonUserId: string;
  let doctorToken: string;

  beforeAll(async () => {
    const surgeon = await prisma.doctor.findFirstOrThrow({ where: { user: { email: "dr.ahmed@careplus.local" } }, include: { user: true } });
    const patient = await prisma.patient.findFirstOrThrow();
    const room = await prisma.otRoom.findFirstOrThrow({ where: { isActive: true } });
    surgeonUserId = surgeon.userId;
    const login = await request(app).post("/api/v1/auth/login").send({ email: "dr.ahmed@careplus.local", password: "Doctor@12345" });
    expect(login.status).toBe(200);
    doctorToken = login.body.data.accessToken;
    const hospitalDateParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const datePart = (type: string) => hospitalDateParts.find((part) => part.type === type)?.value ?? "00";
    const scheduledStart = new Date(`${datePart("year")}-${datePart("month")}-${datePart("day")}T10:00:00+05:00`);
    const surgery = await prisma.surgery.create({
      data: {
        patientId: patient.id,
        otRoomId: room.id,
        surgeryType: `Notification regression ${Date.now()}`,
        surgeonId: surgeon.id,
        scheduledStart,
        scheduledEnd: new Date(scheduledStart.getTime() + 3600000),
        preOpChecklistJson: { consent: false },
        createdBy: surgeonUserId,
      },
    });
    surgeryId = surgery.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { relatedEntityId: surgeryId } });
    await prisma.surgery.deleteMany({ where: { id: surgeryId } });
    redis.disconnect();
  });

  it("delivers incomplete-checklist notification to the surgeon user", async () => {
    const preOp = await request(app)
      .post(`/api/v1/ot/surgeries/${surgeryId}/pre-op`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(preOp.status).toBe(200);
    const response = await request(app)
      .post(`/api/v1/ot/surgeries/${surgeryId}/start`)
      .set("Authorization", `Bearer ${doctorToken}`);

    expect(response.status).toBe(409);
    const notification = await prisma.notification.findFirst({ where: { relatedEntityId: surgeryId, notificationType: "OT_CHECKLIST_INCOMPLETE" } });
    expect(notification?.userId).toBe(surgeonUserId);
  });
});