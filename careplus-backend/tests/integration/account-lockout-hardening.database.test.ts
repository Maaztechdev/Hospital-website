import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const password = "ValidUserPassword@123";

describe("Account lockout abuse mitigation and admin unlock", () => {
  const suffix = Date.now().toString();
  const victimEmail = `victim-${suffix}@careplus.test`;
  const adminEmail = `admin-unlock-${suffix}@careplus.test`;
  let victimUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let adminUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let adminToken: string;

  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    [victimUser, adminUser] = await Promise.all([
      prisma.user.create({
        data: { name: "Victim User", email: victimEmail, passwordHash, role: "DOCTOR", isActive: true },
      }),
      prisma.user.create({
        data: { name: "Unlock Admin", email: adminEmail, passwordHash, role: "ADMIN", isActive: true },
      }),
    ]);

    const adminLogin = await request(app).post("/api/v1/auth/login").send({ email: adminEmail, password });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.accessToken;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { relatedEntityId: victimUser.id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: victimUser.id } });
    await prisma.user.deleteMany({ where: { id: { in: [victimUser.id, adminUser.id] } } });
    await redis.del(`lockout:${victimEmail}`);
  });

  it("locks account after max failed attempts, records audit log + notifies admins, and allows admin unlock", async () => {
    // 1. Send 5 failed login attempts for victimUser
    for (let i = 1; i <= 4; i++) {
      const res = await request(app).post("/api/v1/auth/login").send({ email: victimEmail, password: "WrongPassword" });
      expect(res.status).toBe(401);
    }

    // 5th attempt locks the account (423)
    const lockRes = await request(app).post("/api/v1/auth/login").send({ email: victimEmail, password: "WrongPassword" });
    expect(lockRes.status).toBe(423);

    // 2. Verify audit log was recorded on lockout
    const lockAudit = await prisma.auditLog.findFirst({
      where: { entityType: "User", entityId: victimUser.id, action: "STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(lockAudit).toBeDefined();
    expect(lockAudit?.newValuesJson).toMatchObject({ status: "LOCKED" });

    // 3. Verify notification to admins was created
    const adminNotification = await prisma.notification.findFirst({
      where: { relatedEntityId: victimUser.id, notificationType: "ACCOUNT_LOCKED" },
    });
    expect(adminNotification).toBeDefined();
    expect(adminNotification?.title).toContain("Account Locked");

    // 4. Victim cannot log in even with correct password while locked
    const lockedAttempt = await request(app).post("/api/v1/auth/login").send({ email: victimEmail, password });
    expect(lockedAttempt.status).toBe(423);

    // 5. Non-admin cannot unlock (simulate with unauthenticated or wrong role)
    const unauthorizedUnlock = await request(app).post(`/api/v1/users/${victimUser.id}/unlock`);
    expect(unauthorizedUnlock.status).toBe(401);

    // 6. Admin unlocks victim's account
    const unlockRes = await request(app)
      .post(`/api/v1/users/${victimUser.id}/unlock`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(unlockRes.status).toBe(200);

    // 7. Verify unlock audit log
    const unlockAudit = await prisma.auditLog.findFirst({
      where: { entityType: "User", entityId: victimUser.id, action: "STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(unlockAudit?.newValuesJson).toMatchObject({ status: "UNLOCKED" });

    // 8. Victim can now immediately log in with correct password
    const successLogin = await request(app).post("/api/v1/auth/login").send({ email: victimEmail, password });
    expect(successLogin.status).toBe(200);
    expect(successLogin.body.data.accessToken).toBeDefined();
  });
});
