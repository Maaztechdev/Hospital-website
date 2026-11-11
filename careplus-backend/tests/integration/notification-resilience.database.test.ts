import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";

const app = createApp();

describe("Notification resilience: clinical workflows must never abort on notification failure", () => {
  let surgeryId: string;
  let doctorToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const surgeon = await prisma.doctor.findFirstOrThrow({ where: { user: { email: "dr.ahmed@careplus.local" } }, include: { user: true } });
    const patient = await prisma.patient.findFirstOrThrow();
    const room = await prisma.otRoom.findFirstOrThrow({ where: { isActive: true } });

    const doctorLogin = await request(app).post("/api/v1/auth/login").send({ email: "dr.ahmed@careplus.local", password: "Doctor@12345" });
    expect(doctorLogin.status).toBe(200);
    doctorToken = doctorLogin.body.data.accessToken;

    const adminLogin = await request(app).post("/api/v1/auth/login").send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.accessToken;

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
        surgeryType: `Notification Resilience Test ${Date.now()}`,
        surgeonId: surgeon.id,
        scheduledStart,
        scheduledEnd: new Date(scheduledStart.getTime() + 3600000),
        status: "SCHEDULED",
        createdBy: surgeon.userId,
      },
    });
    surgeryId = surgery.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.notification.deleteMany({ where: { relatedEntityId: surgeryId } });
    await prisma.surgeryStatusEvent.deleteMany({ where: { surgeryId } });
    await prisma.surgery.deleteMany({ where: { id: surgeryId } });
  });

  it("completes surgery transition successfully even when notification creation throws a foreign key error", async () => {
    // Spy on prisma.notification.create to simulate notifications_user_id_fkey failure
    const notificationSpy = jest.spyOn(prisma.notification, "create").mockRejectedValue(
      new Error('Foreign key constraint failed on table notifications (notifications_user_id_fkey)')
    );

    // Transition surgery to PRE_OP
    const response = await request(app)
      .post(`/api/v1/ot/surgeries/${surgeryId}/pre-op`)
      .set("Authorization", `Bearer ${doctorToken}`);

    // Clinical workflow must succeed with 200, not 500
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("PRE_OP");

    // Database record must have persisted the status update
    const updatedSurgery = await prisma.surgery.findUnique({ where: { id: surgeryId } });
    expect(updatedSurgery?.status).toBe("PRE_OP");

    // Verify that notification creation was indeed attempted and failed
    expect(notificationSpy).toHaveBeenCalled();
  });
});
