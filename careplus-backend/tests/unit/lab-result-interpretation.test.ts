import { formatLabReferenceRange, interpretLabValue, resolveLabReferenceRange } from "../../src/modules/lab/lab.resultUtils";
import { amendResultSchema, enterResultSchema, rejectSampleSchema } from "../../src/modules/lab/lab.validators";

const ranges = [
  { gender: "ANY" as const, ageMinDays: null, ageMaxDays: null, low: 4, high: 10, criticalLow: 2, criticalHigh: 20 },
  { gender: "FEMALE" as const, ageMinDays: 365 * 18, ageMaxDays: null, low: 5, high: 9, criticalLow: 3, criticalHigh: 18 },
  { gender: "ANY" as const, ageMinDays: 0, ageMaxDays: 365 * 17, low: 3, high: 12, criticalLow: null, criticalHigh: null },
];

describe("lab result range interpretation", () => {
  it("prefers age- and gender-matched ranges and falls back to any gender", () => {
    expect(resolveLabReferenceRange(ranges, "FEMALE", 365 * 30)?.low).toBe(5);
    expect(resolveLabReferenceRange(ranges, "MALE", 365 * 30)?.low).toBe(4);
    expect(resolveLabReferenceRange(ranges, "OTHER", 365 * 10)?.low).toBe(3);
  });

  it("does not resolve an age-limited range if patient age is unknown", () => {
    expect(resolveLabReferenceRange(ranges, "OTHER", null)?.ageMinDays).toBeNull();
  });

  it.each([
    [2, "CRITICAL_LOW"],
    [3.9, "LOW"],
    [4, "NORMAL"],
    [10, "NORMAL"],
    [10.1, "HIGH"],
    [20, "CRITICAL_HIGH"],
  ] as const)("classifies %s against normal and critical limits", (value, expected) => {
    const range = resolveLabReferenceRange(ranges, "MALE", 365 * 30);
    expect(interpretLabValue(value, range)).toBe(expected);
  });

  it("formats both normal and critical thresholds for the report", () => {
    const range = resolveLabReferenceRange(ranges, "MALE", 365 * 30);
    expect(formatLabReferenceRange(range)).toBe("4 – 10 (critical: ≤ 2 / ≥ 20)");
    expect(interpretLabValue(10, null)).toBeNull();
  });

  it("requires a reason whenever an interpretation is overridden", () => {
    const parameter = { parameterId: "00000000-0000-4000-8000-000000000001", value: "5", overriddenInterpretation: "HIGH" as const };
    expect(enterResultSchema.safeParse({ parameters: [parameter] }).success).toBe(false);
    expect(enterResultSchema.safeParse({ parameters: [{ ...parameter, overrideReason: "Manual review" }] }).success).toBe(true);
  });

  it("requires a non-blank reason to amend a report", () => {
    expect(amendResultSchema.safeParse({ resultValue: "6", reason: "   " }).success).toBe(false);
    expect(amendResultSchema.safeParse({ resultValue: "6", reason: "Corrected transcription" }).success).toBe(true);
  });

  it("requires a description for an OTHER sample rejection", () => {
    expect(rejectSampleSchema.safeParse({ reason: "OTHER" }).success).toBe(false);
    expect(rejectSampleSchema.safeParse({ reason: "HAEMOLYSED" }).success).toBe(true);
    expect(rejectSampleSchema.safeParse({ reason: "OTHER", otherReason: "Clotted specimen" }).success).toBe(true);
  });
});
