import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "@config/env";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { sseService } from "./sse.service";
import { authenticate, AccessTokenPayload } from "@common/middleware/authenticate";
import { Role } from "@prisma/client";

const router = Router();
const inMemoryTickets = new Map<string, { data: string; expiresAt: number }>();

// Periodic in-memory cleanup
setInterval(() => {
  const now = Date.now();
  for (const [tkt, item] of inMemoryTickets.entries()) {
    if (item.expiresAt < now) inMemoryTickets.delete(tkt);
  }
}, 60000).unref();

/**
 * POST /api/v1/events/ticket
 * Generates a short-lived (30s), single-use ticket for establishing an SSE connection.
 * Eliminates placing long-lived JWT access tokens in URL query strings.
 */
router.post("/ticket", authenticate, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const ticket = `ssetkt_${randomUUID().replace(/-/g, "")}`;
  const data = JSON.stringify({
    userId: req.user.sub,
    role: req.user.role,
  });

  try {
    await redis.setex(`sse:ticket:${ticket}`, 30, data);
  } catch {
    inMemoryTickets.set(ticket, { data, expiresAt: Date.now() + 30000 });
  }

  res.json({ success: true, ticket, expiresIn: 30 });
});

/**
 * GET /api/v1/events/stream
 * Connects to the SSE stream. Authenticates strictly via:
 * 1) Short-lived single-use one-time ticket (?ticket=...), burned immediately upon read
 * 2) HttpOnly access cookie (sent via withCredentials: true)
 * 3) Authorization header (Bearer ...)
 *
 * NOTE: Long-lived tokens in query strings (?token=...) are explicitly REJECTED.
 */
router.get("/stream", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const cookieHeader = req.headers.cookie;
  const ticketParam = typeof req.query.ticket === "string" ? req.query.ticket : undefined;

  let userId: string | undefined;
  let role: Role | undefined;

  // 1. One-time ticket verification (burned immediately)
  if (ticketParam) {
    let ticketData: string | null = null;
    try {
      ticketData = await redis.getdel(`sse:ticket:${ticketParam}`);
    } catch {
      const mem = inMemoryTickets.get(ticketParam);
      if (mem && mem.expiresAt > Date.now()) {
        ticketData = mem.data;
        inMemoryTickets.delete(ticketParam);
      }
    }

    if (ticketData) {
      try {
        const parsed = JSON.parse(ticketData);
        userId = parsed.userId;
        role = parsed.role;
      } catch {}
    }
  }

  // 2. Cookie authentication (withCredentials: true)
  if (!userId && cookieHeader) {
    const match = cookieHeader.match(/careplus_access_token=([^;]+)/);
    if (match) {
      const token = decodeURIComponent(match[1]);
      try {
        const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
        userId = payload.sub;
        role = payload.role as Role;
      } catch {}
    }
  }

  // 3. Authorization header (Bearer)
  if (!userId && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
      userId = payload.sub;
      role = payload.role as Role;
    } catch {}
  }

  if (!userId || !role) {
    res.status(401).json({ success: false, message: "Unauthorized for SSE stream" });
    return;
  }

  let doctorId: string | undefined;
  if (role === "DOCTOR") {
    const doctor = await prisma.doctor.findFirst({ where: { userId } });
    doctorId = doctor?.id;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const clientId = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  sseService.addClient({
    id: clientId,
    userId,
    role,
    doctorId,
    res,
    lastPing: Date.now(),
  });
});

export default router;
