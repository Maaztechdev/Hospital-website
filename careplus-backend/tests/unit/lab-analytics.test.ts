import { hospitalDateKey, hospitalDateRange, isLabOrderOverdue } from "../../src/modules/lab/lab.analytics.service";
import { labReportsQuerySchema } from "../../src/modules/lab/lab.validators";

describe("Lab analytics helpers", () => {
  it("uses the hospital timezone for date keys and inclusive report date ranges", () => {
    expect(hospitalDateKey(new Date("2026-10-10T20:00:00.000Z"))).toBe("2026-10-11");
    const range = hospitalDateRange("2026-10-11", "2026-10-11");
    expect(range?.gte?.toISOString()).toBe("2026-10-10T19:00:00.000Z");
    expect(range?.lt?.toISOString()).toBe("2026-10-11T19:00:00.000Z");
  });

  it("flags orders only after their turnaround allowance expires", () => {
    const orderedAt = new Date("2026-10-10T00:00:00.000Z");
    expect(isLabOrderOverdue(orderedAt, 24, new Date("2026-10-11T00:00:00.000Z"))).toBe(false);
    expect(isLabOrderOverdue(orderedAt, 24, new Date("2026-10-11T00:00:00.001Z"))).toBe(true);
  });

  it("accepts all or complete ordered date ranges and rejects partial or reversed ranges", () => {
    expect(labReportsQuerySchema.safeParse({}).success).toBe(true);
    expect(labReportsQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-11" }).success).toBe(true);
    expect(labReportsQuerySchema.safeParse({ from: "2026-10-01" }).success).toBe(false);
    expect(labReportsQuerySchema.safeParse({ from: "2026-10-11", to: "2026-10-01" }).success).toBe(false);
  });
});
