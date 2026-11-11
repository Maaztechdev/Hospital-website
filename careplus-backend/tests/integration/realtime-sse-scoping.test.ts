import { describe, it, expect, beforeAll } from "@jest/globals";
import { sseService, RealtimeClient } from "@modules/realtime/sse.service";

describe("Realtime SSE Service Role and Doctor Scoping", () => {
  let doctorClient: RealtimeClient;
  let otherDoctorClient: RealtimeClient;
  let nurseClient: RealtimeClient;
  let adminClient: RealtimeClient;

  let doctorMessages: string[] = [];
  let otherDoctorMessages: string[] = [];
  let nurseMessages: string[] = [];
  let adminMessages: string[] = [];

  const mockRes = (messages: string[]) => ({
    write: (msg: string) => {
      messages.push(msg);
      return true;
    },
    on: () => {},
  } as any);

  beforeAll(() => {
    doctorClient = {
      id: "client-doc-1",
      userId: "user-doc-1",
      role: "DOCTOR",
      doctorId: "doctor-1",
      res: mockRes(doctorMessages),
      lastPing: Date.now(),
    };

    otherDoctorClient = {
      id: "client-doc-2",
      userId: "user-doc-2",
      role: "DOCTOR",
      doctorId: "doctor-2",
      res: mockRes(otherDoctorMessages),
      lastPing: Date.now(),
    };

    nurseClient = {
      id: "client-nurse-1",
      userId: "user-nurse-1",
      role: "NURSE",
      res: mockRes(nurseMessages),
      lastPing: Date.now(),
    };

    adminClient = {
      id: "client-admin-1",
      userId: "user-admin-1",
      role: "ADMIN",
      res: mockRes(adminMessages),
      lastPing: Date.now(),
    };

    sseService.addClient(doctorClient);
    sseService.addClient(otherDoctorClient);
    sseService.addClient(nurseClient);
    sseService.addClient(adminClient);
  });

  it("1. Broadcasts event targeted to DOCTOR role only to doctors and admin", () => {
    doctorMessages.length = 0;
    otherDoctorMessages.length = 0;
    nurseMessages.length = 0;
    adminMessages.length = 0;

    sseService.broadcast({
      type: "queue:updated",
      targetRoles: ["DOCTOR"],
      payload: { queueLength: 3 },
    });

    expect(doctorMessages.length).toBeGreaterThan(0);
    expect(otherDoctorMessages.length).toBeGreaterThan(0);
    expect(adminMessages.length).toBeGreaterThan(0); // Admin receives all
    expect(nurseMessages.length).toBe(0); // Nurse is excluded
  });

  it("2. Doctor-scoped event only delivered to specific doctor and admin", () => {
    doctorMessages.length = 0;
    otherDoctorMessages.length = 0;
    nurseMessages.length = 0;
    adminMessages.length = 0;

    sseService.broadcast({
      type: "appointment:updated",
      targetRoles: ["DOCTOR"],
      targetDoctorId: "doctor-1",
      payload: { appointmentId: "app-123" },
    });

    expect(doctorMessages.length).toBeGreaterThan(0);
    expect(otherDoctorMessages.length).toBe(0); // Other doctor excluded
    expect(nurseMessages.length).toBe(0); // Nurse excluded
    expect(adminMessages.length).toBeGreaterThan(0); // Admin receives all
  });

  it("3. Ward event targeted to NURSE and DOCTOR only delivered to them and admin", () => {
    doctorMessages.length = 0;
    otherDoctorMessages.length = 0;
    nurseMessages.length = 0;
    adminMessages.length = 0;

    sseService.broadcast({
      type: "ward:admission_updated",
      targetRoles: ["NURSE", "DOCTOR"],
      payload: { admissionId: "adm-456" },
    });

    expect(nurseMessages.length).toBeGreaterThan(0);
    expect(doctorMessages.length).toBeGreaterThan(0);
    expect(otherDoctorMessages.length).toBeGreaterThan(0);
    expect(adminMessages.length).toBeGreaterThan(0);
  });
});

