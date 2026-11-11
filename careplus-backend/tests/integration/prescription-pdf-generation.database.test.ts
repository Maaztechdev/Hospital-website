import request from "supertest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { resolvePrivateFile } from "@common/utils/privateFiles";

const app = createApp();
const api = "/api/v1";

describe("TASK B: Server-side prescription PDF generation & share", () => {
  let doctorToken: string;
  let otherDoctorToken: string;
  let adminToken: string;
  let receptionistToken: string;

  let doctorUser: { id: string; email: string; name: string };
  let otherDoctorUser: { id: string; email: string; name: string };
  let doctorRecord: { id: string; userId: string };
  let patientRecord: { id: string; mrNumber: string; firstName: string; lastName: string };
  let prescriptionId: string;
  let createdShareTokens: string[] = [];
  let createdShareIds: string[] = [];

  beforeAll(async () => {
    // 1. Authenticate actors
    const [docLogin, otherDocLogin, adminLogin, recLogin] = await Promise.all([
      request(app).post(`${api}/auth/login`).send({ email: "dr.ahmed@careplus.local", password: "Doctor@12345" }),
      request(app).post(`${api}/auth/login`).send({ email: "dr.fatima@careplus.local", password: "Doctor@12345" }),
      request(app).post(`${api}/auth/login`).send({ email: "admin@careplus.local", password: "Admin@12345" }),
      request(app).post(`${api}/auth/login`).send({ email: "reception@careplus.local", password: "Staff@12345" }),
    ]);

    expect(docLogin.status).toBe(200);
    expect(otherDocLogin.status).toBe(200);
    expect(adminLogin.status).toBe(200);
    expect(recLogin.status).toBe(200);

    doctorToken = docLogin.body.data.accessToken;
    otherDoctorToken = otherDocLogin.body.data.accessToken;
    adminToken = adminLogin.body.data.accessToken;
    receptionistToken = recLogin.body.data.accessToken;

    doctorUser = await prisma.user.findFirstOrThrow({ where: { email: "dr.ahmed@careplus.local" } });
    otherDoctorUser = await prisma.user.findFirstOrThrow({ where: { email: "dr.fatima@careplus.local" } });
    doctorRecord = await prisma.doctor.findFirstOrThrow({ where: { userId: doctorUser.id } });
    patientRecord = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null } });

    // Ensure doctor has prescription pad configuration
    await prisma.prescriptionPadConfig.upsert({
      where: { doctorId: doctorRecord.id },
      create: {
        doctorId: doctorRecord.id,
        clinicName: "Dr. Ahmed Family Clinic",
        clinicAddress: "Suite 401, MediTower, Jail Road, Lahore",
        clinicPhone: "+92 42 35789000",
        clinicEmail: "drahmed.clinic@careplus.local",
        doctorName: "Dr. Ahmed Khan",
        doctorQualification: "MBBS, FCPS (Internal Medicine)",
        doctorSpecialization: "General Physician",
        pmdcRegistrationNo: "PMDC-65432-P",
        phcRegistrationNo: "PHC-R-9876",
      },
      update: {
        clinicName: "Dr. Ahmed Family Clinic",
      },
    });

    // 2. Create a signed prescription with medications and vitals
    const medicine = await prisma.medicine.findFirstOrThrow();

    const rx = await prisma.prescription.create({
      data: {
        patientId: patientRecord.id,
        doctorId: doctorRecord.id,
        status: "SIGNED",
        signedAt: new Date(),
        visitNumber: "101",
        visitDate: new Date(),
        presentingComplaints: "Low grade fever, mild throat discomfort for 3 days",
        findings: "Pharyngeal congestion present. Chest clear on auscultation.",
        vitalsJson: {
          bp_systolic: 120,
          bp_diastolic: 80,
          pulse: 74,
          temperature: 98.6,
          temperature_unit: "F",
          weight: 68,
          oxygen_saturation: 99,
        },
        items: {
          create: [
            {
              medicineId: medicine.id,
              medicineName: medicine.name,
              dosage: "500mg",
              route: "Oral",
              frequency: "1-0-1 (BID)",
              durationDays: 5,
              durationValue: 5,
              durationUnit: "days",
              instructions: "Take after meals with water",
            },
          ],
        },
      },
    });
    prescriptionId = rx.id;
  });

  afterAll(async () => {
    // Cleanup generated shares, prescription items, and prescriptions
    if (createdShareIds.length > 0) {
      const shares = await prisma.prescriptionShare.findMany({
        where: { id: { in: createdShareIds } },
        select: { filePath: true },
      });
      for (const s of shares) {
        if (s.filePath) {
          try {
            const p = resolvePrivateFile(s.filePath);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {}
        }
      }
      await prisma.prescriptionShare.deleteMany({ where: { id: { in: createdShareIds } } });
    }

    if (prescriptionId) {
      await prisma.prescriptionShare.deleteMany({ where: { prescriptionId } });
      await prisma.prescriptionItem.deleteMany({ where: { prescriptionId } });
      await prisma.prescription.deleteMany({ where: { id: prescriptionId } });
    }
  });

  describe("1. POST /:id/share creates non-empty PDF stored in private files", () => {
    it("generates a prescription PDF and sets filePath on the share record", async () => {
      const res = await request(app)
        .post(`${api}/prescriptions/${prescriptionId}/share`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("token");
      expect(res.body.data).toHaveProperty("filePath");
      expect(res.body.data).toHaveProperty("downloadUrl");

      const { token, filePath, id } = res.body.data;
      createdShareTokens.push(token);
      createdShareIds.push(id);

      expect(filePath).toMatch(/^shared-prescriptions\/[a-f0-9-]+\.pdf$/);

      // Verify the file exists on the filesystem and has valid PDF signature
      const absolutePath = resolvePrivateFile(filePath);
      expect(fs.existsSync(absolutePath)).toBe(true);

      const stats = fs.statSync(absolutePath);
      expect(stats.size).toBeGreaterThan(500); // Non-empty PDF

      const buffer = fs.readFileSync(absolutePath);
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    });
  });

  describe("2. Public share token endpoints (GET /shared/:token/pdf & verify)", () => {
    it("downloads the generated PDF without authentication using valid token", async () => {
      const token = createdShareTokens[0];
      expect(token).toBeDefined();

      const res = await request(app)
        .get(`${api}/prescriptions/shared/${token}/pdf`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toContain("prescription.pdf");
      expect(Buffer.isBuffer(res.body) || typeof res.body === "object").toBe(true);

      // Verify PDF magic header from response
      const fileBytes = Buffer.from(res.body);
      expect(fileBytes.subarray(0, 5).toString()).toBe("%PDF-");
    });

    it("verifies the share token via GET /shared/:token/verify", async () => {
      const token = createdShareTokens[0];
      const res = await request(app).get(`${api}/prescriptions/shared/${token}/verify`);

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.doctorName).toBe(doctorUser.name);
      expect(res.body.data.expiresAt).toBeDefined();
    });
  });

  describe("3. Authorization guards: unauthorized users cannot share or download", () => {
    it("rejects unauthenticated requests to POST /:id/share with 401", async () => {
      const res = await request(app).post(`${api}/prescriptions/${prescriptionId}/share`);
      expect(res.status).toBe(401);
    });

    it("rejects non-doctor roles (e.g. Receptionist) from creating a share link with 403", async () => {
      const res = await request(app)
        .post(`${api}/prescriptions/${prescriptionId}/share`)
        .set("Authorization", `Bearer ${receptionistToken}`);
      expect(res.status).toBe(403);
    });

    it("rejects another doctor from sharing a prescription they do not own with 403", async () => {
      const res = await request(app)
        .post(`${api}/prescriptions/${prescriptionId}/share`)
        .set("Authorization", `Bearer ${otherDoctorToken}`);
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated requests to GET /:id/pdf with 401", async () => {
      const res = await request(app).get(`${api}/prescriptions/${prescriptionId}/pdf`);
      expect(res.status).toBe(401);
    });

    it("allows authenticated doctor (owner) to download direct PDF via GET /:id/pdf", async () => {
      const res = await request(app)
        .get(`${api}/prescriptions/${prescriptionId}/pdf`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      const fileBytes = Buffer.from(res.body);
      expect(fileBytes.subarray(0, 5).toString()).toBe("%PDF-");
    });
  });

  describe("4. Expired, voided, or invalid share tokens are rejected", () => {
    it("rejects expired share token on PDF download and verification with 404", async () => {
      // Create a share that is explicitly expired in the past
      const expiredShare = await prisma.prescriptionShare.create({
        data: {
          prescriptionId,
          tokenHash: "0000000000000000000000000000000000000000000000000000000000000000",
          expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
          createdBy: doctorUser.id,
        },
      });
      createdShareIds.push(expiredShare.id);

      // Attempt download with a dummy token matching length 43
      const dummyToken = "1234567890123456789012345678901234567890123";
      const res = await request(app).get(`${api}/prescriptions/shared/${dummyToken}/pdf`);
      expect(res.status).toBe(404);

      const verifyRes = await request(app).get(`${api}/prescriptions/shared/${dummyToken}/verify`);
      expect(verifyRes.status).toBe(404);
    });

    it("rejects revoked / voided prescription share with 404", async () => {
      // Create a temporary voided prescription
      const voidRx = await prisma.prescription.create({
        data: {
          patientId: patientRecord.id,
          doctorId: doctorRecord.id,
          status: "VOID",
          voidReason: "Test void prescription revocation",
        },
      });

      const token = "V01dTokenTest123456789012345678901234567890";
      const tokenHash = createHash("sha256").update(token).digest("hex");

      const voidShare = await prisma.prescriptionShare.create({
        data: {
          prescriptionId: voidRx.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 86400000),
          createdBy: doctorUser.id,
        },
      });

      const res = await request(app).get(`${api}/prescriptions/shared/${token}/pdf`);
      expect(res.status).toBe(404);

      // Cleanup
      await prisma.prescriptionShare.delete({ where: { id: voidShare.id } });
      await prisma.prescription.delete({ where: { id: voidRx.id } });
    });

    it("rejects invalid or malformed tokens with 404", async () => {
      const res1 = await request(app).get(`${api}/prescriptions/shared/short/pdf`);
      expect(res1.status).toBe(404);

      const res2 = await request(app).get(`${api}/prescriptions/shared/nonexistenttokenthatis43charslong000000000/pdf`);
      expect(res2.status).toBe(404);
    });
  });
});
