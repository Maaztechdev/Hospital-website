import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const password = "RefreshRotation@12345";

describe("Integration: refresh token rotation", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let user: Awaited<ReturnType<typeof prisma.user.create>>;

  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        name: "Refresh Rotation Test",
        email: `refresh-rotation-${suffix}@test.local`,
        passwordHash: await argon2.hash(password),
        role: "ADMIN",
      },
    });
  });

  afterAll(async () => {
    if (user) {
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    redis.disconnect();
  });

  it("rotates a valid token once and rejects both replayed and invalid refresh tokens", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password });
    expect(login.status).toBe(200);
    const original = login.body.data.refreshToken as string;

    const refreshed = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: original });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
    expect(refreshed.body.data.refreshToken).toBeTruthy();
    expect(refreshed.body.data.refreshToken).not.toBe(original);

    const replayed = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: original });
    expect(replayed.status).toBe(401);
    expect(replayed.body.message).toBe("Invalid or expired refresh token");

    const invalid = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "invalid.refresh.token" });
    expect(invalid.status).toBe(401);
    expect(invalid.body.message).toBe("Invalid or expired refresh token");
  });

  it("allows only one concurrent exchange of the same refresh token", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password });
    expect(login.status).toBe(200);
    const refreshToken = login.body.data.refreshToken as string;

    const results = await Promise.all([
      request(app).post("/api/v1/auth/refresh").send({ refreshToken }),
      request(app).post("/api/v1/auth/refresh").send({ refreshToken }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  });
});
