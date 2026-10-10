import { isFutureSurgeryStart } from "../../src/modules/ot/ot.time";

describe("OT scheduling hospital timezone boundaries", () => {
  it("compares a Pakistan-local timestamp as an absolute instant near the UTC date boundary", () => {
    const localStart = new Date("2026-10-06T23:50:00+05:00");
    expect(localStart.toISOString()).toBe("2026-10-06T18:50:00.000Z");
    expect(isFutureSurgeryStart(localStart, new Date("2026-10-06T18:49:00.000Z"))).toBe(true);
    expect(isFutureSurgeryStart(localStart, new Date("2026-10-06T18:51:00.000Z"))).toBe(false);
  });
});
