import { canTransitionLabSampleStatus, canVerifyLabResult } from "../../src/modules/lab/lab.workflowUtils";

describe("lab verification and sample workflow", () => {
  it.each([
    ["ORDERED", "SAMPLE_COLLECTED", true],
    ["SAMPLE_COLLECTED", "PROCESSING", true],
    ["PROCESSING", "CANCELLED", true],
    ["ORDERED", "PROCESSING", false],
    ["SAMPLE_COLLECTED", "SAMPLE_COLLECTED", false],
    ["COMPLETED", "CANCELLED", false],
    ["VERIFIED", "SAMPLE_COLLECTED", false],
    ["CANCELLED", "PROCESSING", false],
  ] as const)("transition %s → %s is %s", (current, next, allowed) => {
    expect(canTransitionLabSampleStatus(current, next)).toBe(allowed);
  });

  it("blocks the result author from verifying unless the explicit setting is enabled", () => {
    expect(canVerifyLabResult("user-1", "user-1", false)).toBe(false);
    expect(canVerifyLabResult("user-1", "user-2", false)).toBe(true);
    expect(canVerifyLabResult("user-1", "user-1", true)).toBe(true);
    expect(canVerifyLabResult(null, "user-1", false)).toBe(false);
  });
});
