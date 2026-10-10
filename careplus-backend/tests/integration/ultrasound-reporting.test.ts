import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import argon2 from "argon2";

const app = createApp();
const api = "/api/v1";

describe("Integration: ultrasound reporting workflow", () => {
  let doctorToken: string;
  let techToken: string;
  let patientId: string;

  beforeAll(async () => {
    const doctor = await prisma.user.upsert({
      where: { email: "ultrasound-doctor@careplus.local" },
      update: {},
      create: { name: "Ultrasound Doctor", email: "ultrasound-doctor@careplus.local", passwordHash: await argon2.hash("Doctor@12345"), role: "DOCTOR" },
    });
    await prisma.doctor.upsert({
      where: { userId: doctor.id },
      update: {},
      create: { userId: doctor.id, consultationFee: 1500, isAvailable: true },
    });
    const tech = await prisma.user.upsert({
      where: { email: "ultrasoundtech@careplus.local" },
      update: {},
      create: { name: "Ultrasound Tech", email: "ultrasoundtech@careplus.local", passwordHash: await argon2.hash("Staff@12345"), role: "ULTRASOUND_TECH" },
    });

    const patient = await prisma.patient.upsert({
      where: { mrNumber: "MR-ULTRA-001" },
      update: {},
      create: { mrNumber: "MR-ULTRA-001", firstName: "Ultra", lastName: "Patient", age: 32, gender: "MALE", phone: "03000000001", createdBy: doctor.id },
    });
    patientId = patient.id;

    const doctorLogin = await request(app).post(`${api}/auth/login`).send({ email: "ultrasound-doctor@careplus.local", password: "Doctor@12345" });
    expect(doctorLogin.status).toBe(200);
    doctorToken = doctorLogin.body.data.accessToken;

    const techLogin = await request(app).post(`${api}/auth/login`).send({ email: "ultrasoundtech@careplus.local", password: "Staff@12345" });
    expect(techLogin.status).toBe(200);
    techToken = techLogin.body.data.accessToken;
  });

  afterAll(async () => {
    await prisma.ultrasoundReport.deleteMany({ where: { patient: { mrNumber: "MR-ULTRA-001" } } });
    await prisma.patient.deleteMany({ where: { mrNumber: "MR-ULTRA-001" } });
    await prisma.doctor.deleteMany({ where: { user: { email: { in: ["ultrasound-doctor@careplus.local"] } } } });
    await prisma.user.deleteMany({ where: { email: { in: ["ultrasound-doctor@careplus.local", "ultrasoundtech@careplus.local"] } } });
    await redis.quit();
  });

  it("lists templates, creates a pending order, and queue includes it for ultrasound tech", async () => {
    const templatesResponse = await request(app).get(`${api}/ultrasound/templates`).set("Authorization", `Bearer ${doctorToken}`);
    expect(templatesResponse.status).toBe(200);
    expect(templatesResponse.body.data.length).toBeGreaterThan(0);

    const orderResponse = await request(app)
      .post(`${api}/ultrasound/orders`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ patientId, examinationType: "USG KUB (Kidneys, Ureters, Urinary Bladder)" });

    expect(orderResponse.status).toBe(201);
    expect(orderResponse.body.data.status).toBe("PENDING");

    const queueResponse = await request(app).get(`${api}/ultrasound/queue`).set("Authorization", `Bearer ${techToken}`);
    expect(queueResponse.status).toBe(200);
    expect(queueResponse.body.data.some((item: { patientId: string }) => item.patientId === patientId)).toBe(true);
  });

  it("denies queue access to non-tech roles", async () => {
    const response = await request(app).get(`${api}/ultrasound/queue`).set("Authorization", `Bearer ${doctorToken}`);
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it("saves and completes a report for the technician", async () => {
    const firstQueue = await request(app).get(`${api}/ultrasound/queue`).set("Authorization", `Bearer ${techToken}`);
    const order = firstQueue.body.data[0];

    const reportCreate = await request(app)
      .put(`${api}/ultrasound/reports/${order.id}`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({
        examinationType: order.examinationType,
        sectionValues: { "Right Kidney": { size: "4.8" } },
        conclusion: "Normal USG KUB study.",
        status: "COMPLETED",
      });

    expect(reportCreate.status).toBe(200);
    expect(reportCreate.body.data.status).toBe("COMPLETED");

    const reportGet = await request(app).get(`${api}/ultrasound/reports/${order.id}`).set("Authorization", `Bearer ${techToken}`);
    expect(reportGet.status).toBe(200);
    expect(reportGet.body.data.sectionValues).toBeTruthy();
  });
});
