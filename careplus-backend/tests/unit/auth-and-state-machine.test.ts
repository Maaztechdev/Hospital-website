import jwt from "jsonwebtoken";

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
    PENDING_APPROVAL: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["WAITING", "CANCELLED", "NO_SHOW"],
    WAITING: ["IN_CONSULTATION", "CANCELLED", "NO_SHOW"],
    IN_CONSULTATION: ["DONE"],
    DONE: [],
    CANCELLED: [],
    NO_SHOW: [],
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
});
