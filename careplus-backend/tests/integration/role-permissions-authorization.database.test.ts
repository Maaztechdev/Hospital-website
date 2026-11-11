import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { invalidateRolePermissionsCache } from "@common/services/rolePermissions.service";

const app = createApp();
const api = "/api/v1";

describe("Integration: RolePermission database authorization, caching, safeguards, and fallbacks", () => {
  let adminToken: string;
  let doctorToken: string;
  let nurseToken: string;
  let receptionistToken: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/")[1]?.split("?")[0] !== "careplus_test") {
      throw new Error("Authorization integration tests require the careplus_test database.");
    }

    // Authenticate test users
    const [adminLogin, doctorLogin, nurseLogin, receptionistLogin] = await Promise.all([
      request(app).post(`${api}/auth/login`).send({ email: "admin@careplus.local", password: "Admin@12345" }),
      request(app).post(`${api}/auth/login`).send({ email: "dr.ahmed@careplus.local", password: "Doctor@12345" }),
      request(app).post(`${api}/auth/login`).send({ email: "nurse@careplus.local", password: "Staff@12345" }),
      request(app).post(`${api}/auth/login`).send({ email: "reception@careplus.local", password: "Staff@12345" }),
    ]);

    expect(adminLogin.status).toBe(200);
    expect(doctorLogin.status).toBe(200);
    expect(nurseLogin.status).toBe(200);
    expect(receptionistLogin.status).toBe(200);

    adminToken = adminLogin.body.data.accessToken;
    doctorToken = doctorLogin.body.data.accessToken;
    nurseToken = nurseLogin.body.data.accessToken;
    receptionistToken = receptionistLogin.body.data.accessToken;
  });

  beforeEach(async () => {
    // Clear any test role permissions and invalidate cache
    await prisma.rolePermission.deleteMany({});
    invalidateRolePermissionsCache();
  });

  afterAll(async () => {
    await prisma.rolePermission.deleteMany({});
    invalidateRolePermissionsCache();
    redis.disconnect();
  });

  it("1. Default behavior unchanged when no rows exist in RolePermission table", async () => {
    // Table is empty
    const count = await prisma.rolePermission.count();
    expect(count).toBe(0);

    // Doctor can view ward admissions by hard-coded baseline
    const docWardRes = await request(app)
      .get(`${api}/wards/admissions`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(docWardRes.status).toBe(200);

    // Nurse is forbidden from reports revenue summary by hard-coded baseline
    const nurseReportsRes = await request(app)
      .get(`${api}/reports/revenue-summary`)
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(nurseReportsRes.status).toBe(403);

    // Admin can access revenue reports by hard-coded baseline
    const adminReportsRes = await request(app)
      .get(`${api}/reports/revenue-summary`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminReportsRes.status).toBe(200);
  });

  it("2. Denying an action blocks it: removing 'view' from DOCTOR on 'ward' returns 403 Forbidden", async () => {
    // Stored permission allows DOCTOR only 'create', omitting 'view'
    await prisma.rolePermission.create({
      data: {
        role: "DOCTOR",
        module: "ward",
        allowedActions: ["create"],
      },
    });
    invalidateRolePermissionsCache();

    // Doctor attempting GET /wards/admissions must now be blocked
    const res = await request(app)
      .get(`${api}/wards/admissions`)
      .set("Authorization", `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain("is not permitted to perform 'view' on 'ward'");
  });

  it("3. Granting a configurable action allows it: granting 'view' on 'reports' to NURSE allows access", async () => {
    // Stored permission grants NURSE 'view' on reports (default baseline is ADMIN only)
    await prisma.rolePermission.create({
      data: {
        role: "NURSE",
        module: "reports",
        allowedActions: ["view"],
      },
    });
    invalidateRolePermissionsCache();

    const res = await request(app)
      .get(`${api}/reports/revenue-summary`)
      .set("Authorization", `Bearer ${nurseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("4. Admin always allowed: Admin is never locked out even if stored records specify empty allowedActions", async () => {
    // Attempt to restrict ADMIN on ward and reports
    await prisma.rolePermission.createMany({
      data: [
        { role: "ADMIN", module: "ward", allowedActions: [] },
        { role: "ADMIN", module: "reports", allowedActions: [] },
      ],
    });
    invalidateRolePermissionsCache();

    const wardRes = await request(app)
      .get(`${api}/wards/admissions`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(wardRes.status).toBe(200);

    const reportsRes = await request(app)
      .get(`${api}/reports/revenue-summary`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(reportsRes.status).toBe(200);
  });

  it("5. Cache invalidates on update: updating permissions via Settings API immediately affects next request", async () => {
    // Step a: Allow DOCTOR full access to ward
    await prisma.rolePermission.create({
      data: {
        role: "DOCTOR",
        module: "ward",
        allowedActions: ["view", "create"],
      },
    });
    invalidateRolePermissionsCache();

    // Warm the cache: doctor accesses ward successfully
    const firstRes = await request(app)
      .get(`${api}/wards/admissions`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(firstRes.status).toBe(200);

    // Step b: Admin updates role permissions via PUT /settings/role-permissions
    const putRes = await request(app)
      .put(`${api}/settings/role-permissions`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        role: "DOCTOR",
        module: "ward",
        allowedActions: ["create"], // 'view' removed
      });
    expect(putRes.status).toBe(200);

    // Step c: Next request immediately experiences the new restriction without waiting for TTL
    const nextRes = await request(app)
      .get(`${api}/wards/admissions`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(nextRes.status).toBe(403);
  });

  it("6. Lookup failure falls back safely: database errors fall back to hard-coded baseline instead of 500", async () => {
    // Invalidate cache so it forces a lookup
    invalidateRolePermissionsCache();

    // Spy on prisma.rolePermission.findMany to simulate database connection failure
    const findManySpy = jest.spyOn(prisma.rolePermission, "findMany").mockRejectedValueOnce(new Error("Simulated DB connection failure"));

    // Doctor accesses GET /wards/admissions (which is permitted in hard-coded baseline)
    const res = await request(app)
      .get(`${api}/wards/admissions`)
      .set("Authorization", `Bearer ${doctorToken}`);

    // Must safely fall back to hard-coded baseline (200 OK) rather than returning 500 error
    expect(res.status).toBe(200);

    findManySpy.mockRestore();
  });

  it("7. Non-configurable actions remain strictly hard-coded and cannot be granted via stored permissions", async () => {
    // Attempt to grant RECEPTIONIST access to 'settings' and 'billing:void'
    await prisma.rolePermission.createMany({
      data: [
        { role: "RECEPTIONIST", module: "settings", allowedActions: ["view", "create", "edit", "delete"] },
        { role: "RECEPTIONIST", module: "billing", allowedActions: ["view", "create", "edit", "delete"] },
      ],
    });
    invalidateRolePermissionsCache();

    // Settings routes are strictly ADMIN only
    const settingsRes = await request(app)
      .get(`${api}/settings/medicine-categories`)
      .set("Authorization", `Bearer ${receptionistToken}`);
    expect(settingsRes.status).toBe(403);

    // Voiding invoices is strictly ADMIN and BILLING_MANAGER only
    const voidRes = await request(app)
      .post(`${api}/billing/invoices/00000000-0000-4000-8000-000000000001/void`)
      .set("Authorization", `Bearer ${receptionistToken}`)
      .send({ reason: "Testing unauthorized void" });
    expect(voidRes.status).toBe(403);
  });
});
