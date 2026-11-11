import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/prisma";
import argon2 from "argon2";

const app = createApp();

describe("Login rate limit policy", () => {
  const testIp = "198.51.100.55";
  const userA = "ratelimit.user.a@careplus.local";
  const userB = "ratelimit.user.b@careplus.local";
  const userC = "ratelimit.user.c@careplus.local";
  const userD = "ratelimit.user.d@careplus.local";
  const password = "ValidPassword@123";

  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    for (const email of [userA, userB, userC, userD]) {
      await prisma.user.upsert({
        where: { email },
        create: {
          name: email.split("@")[0],
          email,
          passwordHash,
          role: "ADMIN",
          isActive: true,
        },
        update: { passwordHash, isActive: true },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [userA, userB, userC, userD] } },
    });
    await prisma.$disconnect();
  });

  it("10 failed logins for User A do not block User B from the same IP, and successful logins do not count", async () => {
    // 1. User A fails 10 times from testIp (initially 401, then 423 account locked)
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({ email: userA, password: "WrongPassword" });
      expect([401, 423]).toContain(res.status);
    }

    // 2. User A's 11th failed attempt is blocked with 429
    const blockedRes = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({ email: userA, password: "WrongPassword" });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.message).toContain("Too many login attempts for this account");

    // 3. User B from the same IP is NOT blocked (gets 401 for bad password, not 429)
    const userBRes = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({ email: userB, password: "WrongPassword" });
    expect(userBRes.status).toBe(401);
    expect(userBRes.status).not.toBe(429);

    // 4. Successful login for User C does not count against limit
    for (let i = 0; i < 3; i++) {
      const userCSuccess = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({ email: userC, password });
      expect(userCSuccess.status).toBe(200);
      expect(userCSuccess.body.data.accessToken).toBeDefined();
    }
  });

  it("blocks an account when 20 failed attempts are spread across 20 distinct IPs (global per-account cap)", async () => {
    // Send 20 failed logins for User D from 20 different IPs (1 failure per IP)
    for (let i = 1; i <= 20; i++) {
      const distinctIp = `198.51.100.${i}`;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", distinctIp)
        .send({ email: userD, password: "WrongPassword" });
      expect([401, 423]).toContain(res.status);
    }

    // 21st attempt from a completely new IP is blocked with 429 because account failure cap is reached
    const blockedRes = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "198.51.100.99")
      .send({ email: userD, password: "WrongPassword" });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.message).toContain("Too many failed login attempts for this account");
  });
});
