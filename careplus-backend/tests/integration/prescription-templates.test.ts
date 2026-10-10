import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const password = "TemplateDoctor@12345";

describe("Integration: doctor prescription templates", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let user: Awaited<ReturnType<typeof prisma.user.create>>;
  let doctor: Awaited<ReturnType<typeof prisma.doctor.create>>;

  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    user = await prisma.user.create({ data: { name: "Template Doctor", email: `template-doctor-${suffix}@test.local`, passwordHash, role: "DOCTOR" } });
    doctor = await prisma.doctor.create({ data: { userId: user.id, consultationFee: 100 } });
  });

  afterAll(async () => {
    if (doctor) await prisma.prescriptionTemplate.deleteMany({ where: { doctorId: doctor.id } });
    if (user) {
      await prisma.auditLog.deleteMany({ where: { userId: user.id, module: "prescriptions" } });
      await prisma.doctor.delete({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    redis.disconnect();
  });

  it("rejects incomplete prescription items and unselected free text through the API", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password });
    expect(login.status).toBe(200);
    const headers = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const validItem = {
      medicineId: "223e4567-e89b-42d3-a456-426614174000",
      isCatalogItem: true,
      medicineName: "Amoxicillin 500 mg",
      doseAmount: 1,
      doseUnit: "capsule",
      route: "Oral",
      frequencyCode: "OD",
      durationValue: 3,
      durationUnit: "days",
    };
    const invalidItems = [
      { ...validItem, doseAmount: undefined },
      { ...validItem, doseAmount: 0 },
      { ...validItem, durationValue: undefined },
      { ...validItem, frequencyCode: undefined },
      { ...validItem, medicineId: undefined, isCatalogItem: undefined, medicineName: "dsldkals" },
    ];
    const responses = await Promise.all(invalidItems.map((item) =>
      request(app).post("/api/v1/prescriptions").set(headers).send({
        consultationId: "123e4567-e89b-42d3-a456-426614174000",
        items: [item],
      }),
    ));
    expect(responses.map((response) => response.status)).toEqual([422, 422, 422, 422, 422]);
    expect(JSON.stringify(responses[0].body.errors)).toContain("Dose is missing.");
    expect(JSON.stringify(responses[1].body.errors)).toContain("Dose must be greater than zero.");
    expect(JSON.stringify(responses[2].body.errors)).toContain("Duration is missing.");
    expect(JSON.stringify(responses[3].body.errors)).toContain("Frequency is missing.");
    expect(JSON.stringify(responses[4].body.errors)).toMatch(/catalog medicine/i);
  });

  it("creates, lists, updates, and deletes a per-doctor template", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password });
    expect(login.status).toBe(200);
    const headers = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const item = {
      medicine: "Paracetamol 500 mg",
      doseAmount: "1",
      doseUnit: "tablet",
      route: "Oral",
      frequencyCode: "TDS",
      durationValue: "3",
      durationUnit: "days",
    };
    const created = await request(app).post("/api/v1/prescriptions/templates").set(headers).send({ name: "Fever", items: [item] });
    expect(created.status).toBe(201);
    const templateId = created.body.data.id as string;
    expect(created.body.data.items).toEqual([item]);

    const listed = await request(app).get("/api/v1/prescriptions/templates").set(headers);
    expect(listed.body.data).toHaveLength(1);

    const duplicate = await request(app).post("/api/v1/prescriptions/templates").set(headers).send({ name: "Fever", items: [item] });
    expect(duplicate.status).toBe(409);

    const updated = await request(app).put(`/api/v1/prescriptions/templates/${templateId}`).set(headers).send({ name: "Acute fever", items: [item] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Acute fever");

    const deleted = await request(app).delete(`/api/v1/prescriptions/templates/${templateId}`).set(headers);
    expect(deleted.status).toBe(200);
    expect((await request(app).get("/api/v1/prescriptions/templates").set(headers)).body.data).toEqual([]);
  });
});
