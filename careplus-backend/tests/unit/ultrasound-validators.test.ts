import { ultrasoundTemplateDefaults } from "../../src/modules/ultrasound/ultrasoundTemplateDefaults";
import { completeUltrasoundSchema, createUltrasoundOrderSchema, ultrasoundAnalyticsRangeSchema, ultrasoundAuditTrailQuerySchema, ultrasoundPricingSchema, ultrasoundScanCatalogSchema, updateUltrasoundTemplateSchema } from "../../src/modules/ultrasound/ultrasound.validators";
import { assertAmendmentReason, assertUltrasoundTransitionAllowed, isUltrasoundTransitionAllowed } from "../../src/modules/ultrasound/ultrasoundWorkflow";

describe("ultrasound reporting validation", () => {
  it("accepts every seeded structured scan template", () => {
    for (const template of ultrasoundTemplateDefaults) {
      expect(updateUltrasoundTemplateSchema.safeParse({ sections: template.sections }).success).toBe(true);
    }
  });

  it("requires an image caption for each submitted image", () => {
    const result = completeUltrasoundSchema.safeParse({
      findings: "Normal study.",
      impression: "No abnormality detected.",
      structuredData: { liver: { status: "NORMAL", notes: "" } },
      imageUrls: ["/api/v1/files/image/scan.png"],
      imageCaptions: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate template field keys", () => {
    const result = updateUltrasoundTemplateSchema.safeParse({
      sections: [
        { key: "liver", label: "Liver", type: "organ" },
        { key: "liver", label: "Liver notes", type: "text" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allows only the documented ultrasound status transitions", () => {
    const validTransitions = [
      ["ORDERED", "SCHEDULED"],
      ["SCHEDULED", "IN_PROGRESS"],
      ["IN_PROGRESS", "REPORTED"],
      ["REPORTED", "VERIFIED"],
      ["VERIFIED", "DELIVERED"],
      ["VERIFIED", "FINALIZED"],
      ["ORDERED", "CANCELLED"],
      ["SCHEDULED", "CANCELLED"],
      ["IN_PROGRESS", "CANCELLED"],
    ] as const;
    validTransitions.forEach(([from, to]) => expect(isUltrasoundTransitionAllowed(from, to)).toBe(true));
  });

  it("rejects skipped, reversed, and terminal status transitions", () => {
    const invalidTransitions = [
      ["ORDERED", "IN_PROGRESS"],
      ["SCHEDULED", "REPORTED"],
      ["IN_PROGRESS", "VERIFIED"],
      ["REPORTED", "DELIVERED"],
      ["REPORTED", "CANCELLED"],
      ["VERIFIED", "CANCELLED"],
      ["DELIVERED", "CANCELLED"],
      ["CANCELLED", "ORDERED"],
      ["FINALIZED", "DELIVERED"],
      ["FINALIZED", "CANCELLED"],
    ] as const;
    invalidTransitions.forEach(([from, to]) => {
      expect(isUltrasoundTransitionAllowed(from, to)).toBe(false);
      expect(() => assertUltrasoundTransitionAllowed(from, to)).toThrow(/Cannot move ultrasound order/);
    });
  });

  it("requires a reason before a verified report can be amended", () => {
    expect(() => assertAmendmentReason("VERIFIED")).toThrow(/amendment reason is required/i);
    expect(() => assertAmendmentReason("VERIFIED", "Corrected measurement")).not.toThrow();
    expect(() => assertAmendmentReason("REPORTED")).not.toThrow();
  });

  it("rejects an ultrasound discount greater than its fee", () => {
    const result = createUltrasoundOrderSchema.safeParse({
      patientId: "d1111111-1111-4111-8111-111111111111",
      examType: "Abdomen",
      feeAmount: 1000,
      discountAmount: 1000.01,
    });
    expect(result.success).toBe(false);
  });

  it("requires a reason for amount and percentage discounts and caps percentage discounts", () => {
    const base = { patientId: "d1111111-1111-4111-8111-111111111111", examType: "Abdomen", feeAmount: 1000 };
    expect(createUltrasoundOrderSchema.safeParse({ ...base, discountAmount: 10, discountType: "PERCENTAGE" }).success).toBe(false);
    expect(createUltrasoundOrderSchema.safeParse({ ...base, discountAmount: 101, discountType: "PERCENTAGE", discountReason: "Approved" }).success).toBe(false);
    expect(createUltrasoundOrderSchema.safeParse({ ...base, discountAmount: 10, discountType: "PERCENTAGE", discountReason: "Approved" }).success).toBe(true);
  });

  it("accepts only the complete, unique scan catalog", () => {
    const catalog = (["Obstetric", "Abdomen", "KUB", "Renal", "Pelvis", "Thyroid", "Breast", "Doppler", "Other"] as const)
      .map((name) => ({ name, fee: 0, enabled: true }));
    expect(ultrasoundScanCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(ultrasoundScanCatalogSchema.safeParse(catalog.slice(1)).success).toBe(false);
  });

  it("rejects reversed analytics date ranges", () => {
    expect(ultrasoundAnalyticsRangeSchema.safeParse({ from: "2026-10-13", to: "2026-10-12" }).success).toBe(false);
    expect(ultrasoundAnalyticsRangeSchema.safeParse({ from: "2026-10-12", to: "2026-10-13" }).success).toBe(true);
  });

  it("validates ultrasound audit filters and date ordering", () => {
    expect(ultrasoundAuditTrailQuerySchema.safeParse({ action: "ULTRASOUND_REPORT_VERIFIED", from: "2026-10-12", to: "2026-10-13" }).success).toBe(true);
    expect(ultrasoundAuditTrailQuerySchema.safeParse({ from: "2026-10-13", to: "2026-10-12" }).success).toBe(false);
    expect(ultrasoundAuditTrailQuerySchema.safeParse({ action: "NOT_A_REAL_ACTION" }).success).toBe(false);
  });

  it("rejects audit pricing updates with a discount greater than the fee", () => {
    expect(ultrasoundPricingSchema.safeParse({ feeAmount: 500, discountAmount: 500 }).success).toBe(true);
    expect(ultrasoundPricingSchema.safeParse({ feeAmount: 500, discountAmount: 501 }).success).toBe(false);
  });
});
