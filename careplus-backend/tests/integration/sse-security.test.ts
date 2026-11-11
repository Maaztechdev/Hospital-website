import request from "supertest";
import http from "node:http";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import jwt from "jsonwebtoken";
import { env } from "@config/env";

const app = createApp();

describe("SSE Authentication Security", () => {
  let adminToken: string;
  let adminUserId: string;

  beforeAll(async () => {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!admin) throw new Error("Admin user required");
    adminUserId = admin.id;
    adminToken = jwt.sign(
      { sub: admin.id, role: admin.role, email: admin.email },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "15m" }
    );
  });

  it("1. Generates single-use ticket via authenticated POST /events/ticket", async () => {
    const res = await request(app)
      .post("/api/v1/events/ticket")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.ticket).toMatch(/^ssetkt_[a-f0-9]+$/);
    expect(res.body.expiresIn).toBe(30);
  });

  it("2. Explicitly rejects long-lived JWT token in query string (?token=...)", async () => {
    const res = await request(app)
      .get(`/api/v1/events/stream?token=${adminToken}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("3. Rejects unauthenticated request without ticket, cookie, or header with 401", async () => {
    const res = await request(app)
      .get("/api/v1/events/stream");

    expect(res.status).toBe(401);
  });

  it("4. Connects successfully using single-use ticket and burns it immediately", async () => {
    // Generate fresh ticket
    const ticketRes = await request(app)
      .post("/api/v1/events/ticket")
      .set("Authorization", `Bearer ${adminToken}`);

    const ticket = ticketRes.body.ticket;
    expect(ticket).toBeDefined();

    // First use: connects and burns
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as any).port;

    const streamRes = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const clientReq = http.get(`http://127.0.0.1:${port}/api/v1/events/stream?ticket=${ticket}`, (res) => {
        resolve({ statusCode: res.statusCode || 0, headers: res.headers });
        res.destroy();
      });
      clientReq.on("error", reject);
    });

    await new Promise<void>((r) => server.close(() => r()));

    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.headers["content-type"]).toContain("text/event-stream");

    // Second use of the same ticket: MUST be rejected with 401 (ticket was burned)
    const secondRes = await request(app)
      .get(`/api/v1/events/stream?ticket=${ticket}`);

    expect(secondRes.status).toBe(401);
  });
});

