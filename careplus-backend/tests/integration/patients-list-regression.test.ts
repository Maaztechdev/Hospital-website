import { randomUUID } from "crypto";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { signAccessToken } from "../../src/modules/auth/token.utils";

describe("GET /api/v1/patients regression test (AppointmentStatus enum & lastVisit calculation)", () => {
  afterAll(async () => {
    redis.disconnect();
  });

  it("lists and searches patients with COMPLETED appointments without 22P02 enum crash", async () => {
    const app = createApp();
    const suffix = randomUUID();
    const userIds: string[] = [];
    const doctorIds: string[] = [];
    const patientIds: string[] = [];
    const appointmentIds: string[] = [];

    try {
      // 1. Create an admin user for authentication
      const admin = await prisma.user.create({
        data: {
          name: "Patient Test Admin",
          email: `patient-admin-${suffix}@careplus.test`,
          passwordHash: "test-hash",
          role: "ADMIN",
        },
      });
      userIds.push(admin.id);

      const doctorUser = await prisma.user.create({
        data: {
          name: "Patient Test Doctor",
          email: `patient-doc-${suffix}@careplus.test`,
          passwordHash: "test-hash",
          role: "DOCTOR",
        },
      });
      userIds.push(doctorUser.id);

      const doctor = await prisma.doctor.create({
        data: {
          userId: doctorUser.id,
          consultationFee: 150,
        },
      });
      doctorIds.push(doctor.id);

      // 2. Create a patient
      const patient = await prisma.patient.create({
        data: {
          mrNumber: `MR-REG-${suffix.slice(0, 8)}`,
          firstName: "Regression",
          lastName: `Patient-${suffix.slice(0, 4)}`,
          gender: "MALE",
          phone: `03${suffix.replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`,
          createdBy: admin.id,
        },
      });
      patientIds.push(patient.id);

      // 3. Create an appointment with status: COMPLETED for this patient
      const appointment = await prisma.appointment.create({
        data: {
          patientId: patient.id,
          doctorId: doctor.id,
          appointmentDate: new Date(),
          timeSlot: new Date("1970-01-01T10:00:00.000Z"),
          tokenNumber: 1,
          appointmentType: "NEW_VISIT",
          gender: patient.gender,
          status: "COMPLETED",
          priority: "ROUTINE",
          createdBy: admin.id,
        },
      });
      appointmentIds.push(appointment.id);

      const token = signAccessToken({
        sub: admin.id,
        role: "ADMIN",
        email: admin.email,
      });

      // 4. Test GET /api/v1/patients (list)
      const listRes = await request(app)
        .get("/api/v1/patients?page=1&limit=20")
        .set("Authorization", `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);

      const foundInList = listRes.body.data.find((p: any) => p.id === patient.id);
      expect(foundInList).toBeDefined();
      expect(foundInList.lastVisit).not.toBeNull();

      // 5. Test GET /api/v1/patients?search= (search)
      const searchRes = await request(app)
        .get(`/api/v1/patients?search=Regression`)
        .set("Authorization", `Bearer ${token}`);

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      expect(Array.isArray(searchRes.body.data)).toBe(true);
      const foundInSearch = searchRes.body.data.find((p: any) => p.id === patient.id);
      expect(foundInSearch).toBeDefined();
      expect(foundInSearch.firstName).toBe("Regression");
    } finally {
      if (appointmentIds.length > 0) {
        await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      }
      if (patientIds.length > 0) {
        await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
      }
      if (doctorIds.length > 0) {
        await prisma.doctor.deleteMany({ where: { id: { in: doctorIds } } });
      }
      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    }
  });
});
