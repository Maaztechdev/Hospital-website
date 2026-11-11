import request from "supertest";
import path from "node:path";
import fs from "node:fs/promises";
import { createApp } from "../../src/app";
import { env } from "@config/env";

const app = createApp();

describe("File Access Security Review", () => {
  const testLogoId = "11111111-2222-3333-4444-555555555555";
  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  const hospitalProfileDir = path.join(uploadRoot, "hospital-profile");
  const testLogoPath = path.join(hospitalProfileDir, `${testLogoId}.png`);

  beforeAll(async () => {
    await fs.mkdir(hospitalProfileDir, { recursive: true });
    // Minimal 1x1 PNG bytes
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);
    await fs.writeFile(testLogoPath, pngBytes);
  });

  afterAll(async () => {
    try {
      await fs.unlink(testLogoPath);
    } catch {}
  });

  describe("Public Logo Endpoints (/hospital-profile/* and /pharmacy-profile/*)", () => {
    it("allows unauthenticated access to legitimate hospital logo image", async () => {
      const res = await request(app).get(`/api/v1/files/hospital-profile/${testLogoId}.png`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/png/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toContain("sandbox");
    });

    it("rejects non-image document requests on hospital-profile with 404", async () => {
      const res = await request(app).get(`/api/v1/files/hospital-profile/${testLogoId}.pdf`);
      expect(res.status).toBe(404);
    });

    it("rejects directory listing requests without trailing file name with 404", async () => {
      const res1 = await request(app).get("/api/v1/files/hospital-profile/");
      expect(res1.status).toBe(404);

      const res2 = await request(app).get("/api/v1/files/pharmacy-profile/");
      expect(res2.status).toBe(404);
    });

    it("blocks path traversal attempts attempting to read outside directory", async () => {
      const res1 = await request(app).get("/api/v1/files/hospital-profile/..%2fpackage.json");
      expect(res1.status).toBe(404);

      const res2 = await request(app).get("/api/v1/files/hospital-profile/../../.env");
      expect(res2.status).toBe(404);

      const res3 = await request(app).get("/api/v1/files/pharmacy-profile/....//....//etc/passwd");
      expect(res3.status).toBe(404);
    });
  });

  describe("Patient Documents and Protected Files Access Control", () => {
    it("blocks unauthenticated access to lab reports with 401", async () => {
      const res = await request(app).get("/api/v1/files/lab-reports/00000000-0000-4000-8000-000000000001.pdf");
      expect(res.status).toBe(401);
    });

    it("blocks unauthenticated access to ultrasound images with 401", async () => {
      const res = await request(app).get("/api/v1/files/ultrasound-images/00000000-0000-4000-8000-000000000001.png");
      expect(res.status).toBe(401);
    });

    it("blocks unauthenticated access to doctor signatures with 401", async () => {
      const res = await request(app).get("/api/v1/files/doctor-signatures/00000000-0000-4000-8000-000000000001.png");
      expect(res.status).toBe(401);
    });

    it("blocks unauthenticated access to prescription pads with 401", async () => {
      const res = await request(app).get("/api/v1/files/prescription-pad/00000000-0000-4000-8000-000000000001.png");
      expect(res.status).toBe(401);
    });
  });
});
