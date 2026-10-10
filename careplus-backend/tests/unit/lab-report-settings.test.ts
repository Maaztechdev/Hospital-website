import { applyLabCriticalThresholdDefaults, interpretLabValue, type LabRangeCandidate } from "../../src/modules/lab/lab.resultUtils";
import { labReportSettingsSchema, labSettingsSchema, publicLabReportParamSchema } from "../../src/modules/lab/lab.validators";

describe("lab report settings and public verification validation", () => {
  it("allows an optional accreditation line while requiring the configured lab name", () => {
    expect(labReportSettingsSchema.safeParse({
      labName: "CarePlus Laboratory",
      address: "1 Main Street",
      phone: "+92 300 0000000",
    }).success).toBe(true);
    expect(labReportSettingsSchema.safeParse({ labName: " " }).success).toBe(false);
  });

  it("accepts relative or http(s) report images but rejects executable schemes", () => {
    expect(labReportSettingsSchema.safeParse({
      labName: "CarePlus Laboratory",
      logoUrl: "/api/v1/files/lab-logo.png",
      pathologistSignatureUrl: "https://careplus.example/signature.png",
    }).success).toBe(true);
    expect(labReportSettingsSchema.safeParse({
      labName: "CarePlus Laboratory",
      logoUrl: "javascript:alert(1)",
    }).success).toBe(false);
    expect(labReportSettingsSchema.safeParse({
      labName: "CarePlus Laboratory",
      logoUrl: "//external.example/logo.png",
    }).success).toBe(false);
  });

  it("requires a bounded report number for the public authenticity lookup", () => {
    expect(publicLabReportParamSchema.safeParse({ orderNumber: "LAB-2026-000123" }).success).toBe(true);
    expect(publicLabReportParamSchema.safeParse({ orderNumber: "" }).success).toBe(false);
  });

  it("validates Lab rules and per-parameter critical threshold defaults", () => {
    const base = {
      labName: "CarePlus Laboratory",
      allowSameUserEnterVerify: false,
      requirePaymentBeforeCollection: false,
      defaultTurnaroundHours: 24,
      maxDiscountPercent: 10,
      criticalThresholdDefaults: {
        "3f6603ab-8a2f-470b-a2e3-5f1be2e6be85": { criticalLow: 4, criticalHigh: 20 },
      },
    };
    expect(labSettingsSchema.safeParse(base).success).toBe(true);
    expect(labSettingsSchema.safeParse({ ...base, maxDiscountPercent: 101 }).success).toBe(false);
    expect(labSettingsSchema.safeParse({
      ...base,
      criticalThresholdDefaults: { "3f6603ab-8a2f-470b-a2e3-5f1be2e6be85": { criticalLow: 21, criticalHigh: 20 } },
    }).success).toBe(false);
  });

  it("uses parameter defaults only for critical bounds missing from a selected reference range", () => {
    const referenceRange: LabRangeCandidate = {
      gender: "ANY",
      ageMinDays: null,
      ageMaxDays: null,
      low: 5,
      high: 15,
      criticalLow: null,
      criticalHigh: 25,
    };
    const resolved = applyLabCriticalThresholdDefaults(referenceRange, { criticalLow: 3, criticalHigh: 30 });
    expect(resolved).toMatchObject({ criticalLow: 3, criticalHigh: 25 });
    expect(interpretLabValue(2, resolved)).toBe("CRITICAL_LOW");
    expect(applyLabCriticalThresholdDefaults(null, { criticalLow: 3, criticalHigh: 30 })).toBeNull();
  });
});
