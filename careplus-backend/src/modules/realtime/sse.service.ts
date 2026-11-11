import { Response } from "express";
import { logger } from "@config/logger";
import { Role } from "@prisma/client";

export interface RealtimeClient {
  id: string;
  userId: string;
  role: Role;
  doctorId?: string;
  res: Response;
  lastPing: number;
}

export type RealtimeEventType =
  | "appointment:updated"
  | "appointment:created"
  | "queue:updated"
  | "consultation:started"
  | "consultation:completed"
  | "prescription:created"
  | "prescription:dispensed"
  | "ward:admission_updated"
  | "ward:bed_updated"
  | "ward:round_recorded"
  | "lab:order_updated"
  | "ultrasound:order_updated";

export interface RealtimeEvent {
  type: RealtimeEventType;
  payload?: Record<string, unknown>;
  targetRoles?: Role[];
  targetDoctorId?: string;
  targetUserId?: string;
}

class SseService {
  private clients: Map<string, RealtimeClient> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.pingInterval = setInterval(() => this.heartbeat(), 15000);
    if (this.pingInterval && typeof this.pingInterval.unref === "function") {
      this.pingInterval.unref();
    }
  }

  addClient(client: RealtimeClient) {
    this.clients.set(client.id, client);
    logger.debug({ clientId: client.id, userId: client.userId, role: client.role }, "SSE client connected");

    // Send initial connected event
    client.res.write(`event: connected\ndata: ${JSON.stringify({ clientId: client.id, timestamp: Date.now() })}\n\n`);

    client.res.on("close", () => {
      this.removeClient(client.id);
    });
  }

  removeClient(clientId: string) {
    this.clients.delete(clientId);
    logger.debug({ clientId }, "SSE client disconnected");
  }

  private heartbeat() {
    const now = Date.now();
    for (const [id, client] of this.clients.entries()) {
      try {
        client.res.write(`: ping ${now}\n\n`);
      } catch (err) {
        this.removeClient(id);
      }
    }
  }

  broadcast(event: RealtimeEvent) {
    const data = JSON.stringify({ type: event.type, payload: event.payload, timestamp: Date.now() });
    const message = `event: ${event.type}\ndata: ${data}\n\n`;

    for (const [id, client] of this.clients.entries()) {
      // Role scoping:
      if (event.targetRoles && event.targetRoles.length > 0) {
        if (!event.targetRoles.includes(client.role) && client.role !== "ADMIN") {
          continue;
        }
      }

      // Doctor scoping:
      if (event.targetDoctorId && client.role === "DOCTOR") {
        if (client.doctorId && client.doctorId !== event.targetDoctorId) {
          continue;
        }
      }

      // User scoping:
      if (event.targetUserId && client.userId !== event.targetUserId && client.role !== "ADMIN") {
        continue;
      }

      try {
        client.res.write(message);
      } catch (err) {
        this.removeClient(id);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const sseService = new SseService();

