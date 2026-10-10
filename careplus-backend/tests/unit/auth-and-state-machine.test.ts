import jwt from "jsonwebtoken";
import { assertAppointmentActionAllowed } from "../../src/modules/appointments/appointmentActions";
import { getUpcomingPastPage } from "../../src/modules/appointments/appointmentPagination";
import { generateNextAppointmentToken } from "../../src/common/utils/sequenceGenerators";
import { getDateKeyInTimeZone, isPastTimeSlotForToday } from "../../src/modules/appointments/appointments.service";
import { getAppointmentCreationStatus, getPublicAppointmentCreationStatus } from "../../src/modules/appointments/appointmentCreationPolicy";

describe("JWT access token signing", () => {
  it("signs and verifies a token with the expected payload", () => {
    const secret = "test_access_secret_min_32_characters_long";
    const payload = { sub: "user-123", role: "ADMIN", email: "admin@careplus.local" };
    const token = jwt.sign(payload, secret, { expiresIn: "15m" });

    const decoded = jwt.verify(token, secret) as typeof payload;
    expect(decoded.sub).toBe("user-123");
    expect(decoded.role).toBe("ADMIN");
    expect(decoded.email).toBe("admin@careplus.local");
  });

  it("rejects a token signed with a different secret", () => {
    const token = jwt.sign({ sub: "x" }, "secret-one-that-is-long-enough-1234");
    expect(() => jwt.verify(token, "secret-two-that-is-long-enough-1234")).toThrow();
  });
});

describe("Appointment status transitions (state machine contract)", () => {
  // Mirrors the ALLOWED_TRANSITIONS map in appointments.service.ts —
  // kept here as an executable spec so a change to the map is a deliberate, visible diff.
  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    PENDING_APPROVAL: ["CONFIRMED", "CANCELLED", "EXPIRED"],
    CONFIRMED: ["WAITING", "CANCELLED", "NO_SHOW", "EXPIRED"],
    WAITING: ["IN_CONSULTATION", "CANCELLED", "NO_SHOW", "EXPIRED"],
    IN_CONSULTATION: ["DONE"],
    DONE: [],
    CANCELLED: [],
    NO_SHOW: [],
    EXPIRED: [],
  };

  it("allows PENDING_APPROVAL -> CONFIRMED", () => {
    expect(ALLOWED_TRANSITIONS.PENDING_APPROVAL).toContain("CONFIRMED");
  });

  it("disallows DONE -> any other state (terminal)", () => {
    expect(ALLOWED_TRANSITIONS.DONE).toHaveLength(0);
  });

  it("disallows skipping WAITING -> DONE directly", () => {
    expect(ALLOWED_TRANSITIONS.WAITING).not.toContain("DONE");
  });

  it("allows only approve and reject while pending approval", () => {
    expect(() => assertAppointmentActionAllowed("PENDING_APPROVAL", "APPROVE")).not.toThrow();
    expect(() => assertAppointmentActionAllowed("PENDING_APPROVAL", "REJECT")).not.toThrow();
    expect(() => assertAppointmentActionAllowed("PENDING_APPROVAL", "CANCEL")).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it("allows reschedule and cancel only while confirmed", () => {
    expect(() => assertAppointmentActionAllowed("CONFIRMED", "RESCHEDULE")).not.toThrow();
    expect(() => assertAppointmentActionAllowed("CONFIRMED", "CANCEL")).not.toThrow();
    expect(() => assertAppointmentActionAllowed("IN_CONSULTATION", "CANCEL")).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it("allows completion only during consultation and no actions after terminal states", () => {
    expect(() => assertAppointmentActionAllowed("IN_CONSULTATION", "COMPLETE")).not.toThrow();
    for (const status of ["DONE", "CANCELLED", "NO_SHOW", "EXPIRED"] as const) {
      expect(() => assertAppointmentActionAllowed(status, "CANCEL")).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
});

describe("Appointment creation status policy", () => {
  it("keeps public portal appointments pending approval", () => {
    expect(getPublicAppointmentCreationStatus()).toBe("PENDING_APPROVAL");
  });

  it.each(["ADMIN", "RECEPTIONIST"] as const)("auto-confirms %s bookings", (role) => {
    expect(getAppointmentCreationStatus(role)).toBe("CONFIRMED");
  });

  it.each(["DOCTOR", "LAB_TECHNICIAN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST", "PHARMACIST", "NURSE"] as const)("keeps %s bookings pending approval", (role) => {
    expect(getAppointmentCreationStatus(role)).toBe("PENDING_APPROVAL");
  });
});

describe("Appointment token sequencing", () => {
  it("allocates the next token for a doctor/date without renumbering existing bookings", async () => {
    const doctorId = "doctor-123";
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ counter: 8 }]),
    } as any;

    const result = await generateNextAppointmentToken(tx, doctorId, "2026-10-01");

    expect(result).toBe(8);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [, ...values] = tx.$queryRaw.mock.calls[0];
    expect(values).toContain("2026-10-01");
  });
});

describe("Appointment slot validation", () => {
  it("uses the hospital timezone when checking today's past slots", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-01T08:45:00+05:00"));

    expect(getDateKeyInTimeZone(new Date("2026-10-01T00:00:00+05:00"))).toBe("2026-10-01");
    expect(isPastTimeSlotForToday("2026-10-01", "08:00")).toBe(true);
    expect(isPastTimeSlotForToday("2026-10-01", "09:00")).toBe(false);

    jest.useRealTimers();
  });
});

describe("Appointment upcoming-first pagination", () => {
  it("fills a page with upcoming appointments before taking past appointments", () => {
    expect(getUpcomingPastPage(100, 0, 150)).toEqual({ upcomingSkip: 0, upcomingTake: 100, pastSkip: 0, pastTake: 0 });
  });

  it("splits a page across the upcoming-to-past boundary", () => {
    expect(getUpcomingPastPage(100, 100, 150)).toEqual({ upcomingSkip: 100, upcomingTake: 50, pastSkip: 0, pastTake: 50 });
  });

  it("skips the upcoming range when paging through past appointments", () => {
    expect(getUpcomingPastPage(100, 200, 150)).toEqual({ upcomingSkip: 200, upcomingTake: 0, pastSkip: 50, pastTake: 100 });
  });
});
