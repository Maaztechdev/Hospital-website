import { z } from "zod";
import { Priority } from "@prisma/client";

const createLabOrderFields = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid().optional(),
  testId: z.string().uuid(),
  priority: z.nativeEnum(Priority).optional(),
  sampleType: z.string().optional(),
  clinicalNotes: z.string().max(1000).optional(),
  consultationId: z.string().uuid().optional(),
  discountPercent: z.number().finite().min(0).max(100).optional(),
  discountReason: z.string().trim().max(500).optional(),
  referringClinicAccountId: z.string().uuid().optional(),
});

const validateLabDiscount = (
  order: { discountPercent?: number; discountReason?: string },
  context: z.RefinementCtx,
) => {
  if ((order.discountPercent ?? 0) > 0 && !order.discountReason?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A reason is required for a Lab discount", path: ["discountReason"] });
  }
};

export const createLabOrderSchema = createLabOrderFields.superRefine(validateLabDiscount);

export const createLabPackageOrderSchema = createLabOrderFields.omit({ testId: true }).extend({
  packageId: z.string().uuid(),
}).superRefine(validateLabDiscount);

export const updateSampleStatusSchema = z.object({
  status: z.enum(["SAMPLE_COLLECTED", "PROCESSING", "CANCELLED"]),
});

export const rejectSampleSchema = z.object({
  reason: z.enum(["HAEMOLYSED", "INSUFFICIENT_QUANTITY", "WRONG_TUBE", "OTHER"]),
  otherReason: z.string().trim().max(500).optional(),
}).superRefine((sample, context) => {
  if (sample.reason === "OTHER" && !sample.otherReason?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Describe the other rejection reason", path: ["otherReason"] });
  }
});

export const recollectSampleParamSchema = z.object({
  id: z.string().uuid(),
  rejectionId: z.string().uuid(),
});

export const allowSameUserVerificationSchema = z.object({
  allowSameUserEnterVerify: z.boolean(),
});

export const labBillingSettingsSchema = z.object({
  requirePaymentBeforeCollection: z.boolean(),
});

const reportAssetUrl = z.string().trim().max(1000).refine(
  (value) => value === "" || (/^\/(?!\/)/.test(value)) || /^https?:\/\//i.test(value),
  "Use a relative path or an http(s) URL",
);

export const labReportSettingsSchema = z.object({
  logoUrl: reportAssetUrl.optional(),
  labName: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(40).optional(),
  accreditationLine: z.string().trim().max(200).optional(),
  headerText: z.string().trim().max(1000).optional(),
  footerText: z.string().trim().max(1000).optional(),
  pathologistName: z.string().trim().max(200).optional(),
  pathologistSignatureUrl: reportAssetUrl.optional(),
  technicianName: z.string().trim().max(200).optional(),
  technicianSignatureUrl: reportAssetUrl.optional(),
  reportsRetentionNote: z.string().trim().max(1000).optional(),
});

const labCriticalThresholdDefaultSchema = z.object({
  criticalLow: z.number().finite().nullable().optional(),
  criticalHigh: z.number().finite().nullable().optional(),
}).superRefine((threshold, context) => {
  if (threshold.criticalLow != null && threshold.criticalHigh != null && threshold.criticalLow > threshold.criticalHigh) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Critical low cannot exceed critical high", path: ["criticalHigh"] });
  }
});

export const labSettingsSchema = labReportSettingsSchema.extend({
  allowSameUserEnterVerify: z.boolean(),
  requirePaymentBeforeCollection: z.boolean(),
  defaultTurnaroundHours: z.number().int().min(0).max(8760),
  maxDiscountPercent: z.number().min(0).max(100),
  criticalThresholdDefaults: z.record(z.string().uuid(), labCriticalThresholdDefaultSchema).refine(
    (defaults) => Object.keys(defaults).length <= 1000,
    "No more than 1000 critical threshold defaults may be configured",
  ),
});

export const labSettingsAssetParamSchema = z.object({
  assetType: z.enum(["logo", "pathologist-signature", "technician-signature"]),
});

export const publicLabReportParamSchema = z.object({
  orderNumber: z.string().trim().min(1).max(40),
});

export const enterResultSchema = z.object({
  parameters: z.array(z.object({
    parameterId: z.string().uuid(),
    value: z.string().max(2000),
    overriddenInterpretation: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL_LOW", "CRITICAL_HIGH"]).optional(),
    overrideReason: z.string().trim().max(500).optional(),
  })).min(1).max(300).optional(),
  resultValue: z.string().max(2000).optional(),
  unit: z.string().max(100).optional(),
  referenceRange: z.string().max(200).optional(),
  interpretation: z.enum(["NORMAL", "HIGH", "LOW", "CRITICAL"]).optional(),
  technicianNotes: z.string().max(1000).optional(),
  reportRemarks: z.string().max(1000).optional(),
  inventoryOverrideReason: z.string().trim().min(1).max(500).optional(),
}).superRefine((result, context) => {
  if (!result.parameters?.length && result.resultValue == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter values for the test parameters", path: ["parameters"] });
  }
  if (result.parameters?.length && result.resultValue != null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Submit either catalog parameters or a legacy result value, not both", path: ["resultValue"] });
  }
  result.parameters?.forEach((parameter, index) => {
    if (parameter.overriddenInterpretation && !parameter.overrideReason?.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A reason is required when overriding the computed interpretation", path: ["parameters", index, "overrideReason"] });
    }
  });
});

export const amendResultSchema = enterResultSchema.and(z.object({
  reason: z.string().trim().min(1).max(500),
}));

export const uploadReportSchema = z.object({
  fileUrl: z.string().regex(/^\/api\/v1\/files\/lab-reports\/[a-f0-9-]+\.pdf$/),
  fileType: z.literal("application/pdf"),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listLabOrdersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  patientId: z.string().uuid().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
});

export const labReportsQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).superRefine((range, context) => {
  if (Boolean(range.from) !== Boolean(range.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provide both custom report dates", path: ["to"] });
  }
  if (range.from && range.to && range.from > range.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The report start date must be on or before its end date", path: ["from"] });
  }
});

export const createLabTestSchema = z.object({
  testName: z.string().trim().min(1).max(160),
  testCode: z.string().trim().min(1).max(40),
  category: z.string().trim().max(80).optional(),
  sampleType: z.string().trim().max(100).optional(),
  price: z.number().nonnegative(),
  unit: z.string().trim().max(40).optional(),
  referenceRangeMin: z.number().optional(),
  referenceRangeMax: z.number().optional(),
  turnaroundTimeHours: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  isSendOut: z.boolean().optional(),
  referenceLabSupplierId: z.string().uuid().nullable().optional(),
  sendOutCost: z.number().finite().min(0).nullable().optional(),
  parameters: z.array(z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
    unit: z.string().trim().max(40).optional(),
    displayOrder: z.number().int().nonnegative(),
    resultType: z.enum(["NUMERIC", "TEXT", "CHOICE"]),
    decimalPlaces: z.number().int().min(0).max(8),
    ranges: z.array(z.object({
      id: z.string().uuid().optional(),
      gender: z.enum(["MALE", "FEMALE", "ANY"]),
      ageMinDays: z.number().int().nonnegative().nullable().optional(),
      ageMaxDays: z.number().int().nonnegative().nullable().optional(),
      low: z.number().nullable().optional(),
      high: z.number().nullable().optional(),
      criticalLow: z.number().nullable().optional(),
      criticalHigh: z.number().nullable().optional(),
      notes: z.string().trim().max(500).optional(),
    }).superRefine((range, context) => {
      if (range.ageMinDays != null && range.ageMaxDays != null && range.ageMinDays > range.ageMaxDays) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Minimum age cannot exceed maximum age", path: ["ageMaxDays"] });
      }
      if (range.low != null && range.high != null && range.low > range.high) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Low value cannot exceed high value", path: ["high"] });
      }
      if (range.criticalLow != null && range.criticalHigh != null && range.criticalLow > range.criticalHigh) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Critical low cannot exceed critical high", path: ["criticalHigh"] });
      }
    })),
  }).superRefine((parameter, context) => {
    if (parameter.resultType !== "NUMERIC" && parameter.ranges.some((range) =>
      range.low != null || range.high != null || range.criticalLow != null || range.criticalHigh != null,
    )) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Numeric reference limits require a numeric result type", path: ["ranges"] });
    }
  })).optional(),
}).superRefine((test, context) => {
  if (test.isSendOut && !test.referenceLabSupplierId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Select the reference lab for a send-out test", path: ["referenceLabSupplierId"] });
  }
  if (test.isSendOut && test.sendOutCost == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the outsourced cost for a send-out test", path: ["sendOutCost"] });
  }
  if (test.referenceRangeMin != null && test.referenceRangeMax != null && test.referenceRangeMin > test.referenceRangeMax) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Reference minimum cannot exceed maximum", path: ["referenceRangeMax"] });
  }
  const parameterNames = test.parameters?.map((parameter) => parameter.name.toLocaleLowerCase()) ?? [];
  if (new Set(parameterNames).size !== parameterNames.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Parameter names must be unique within a test", path: ["parameters"] });
  }
});

export const updateLabTestSchema = createLabTestSchema;

export const listLabTestsQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});

export const labPackageSchema = z.object({
  name: z.string().trim().min(1).max(160),
  price: z.number().nonnegative(),
  testIds: z.array(z.string().uuid()).min(1).max(100),
  isActive: z.boolean().optional(),
}).superRefine((value, context) => {
  if (new Set(value.testIds).size !== value.testIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A test may only appear once in a package", path: ["testIds"] });
  }
});

export const listLabPackagesQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});

export const labLedgerQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  type: z.enum(["RECEIVABLE", "PAYABLE"]).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const createLabLedgerAccountSchema = z.object({
  partyType: z.enum(["CLINIC", "REFERENCE_LAB"]),
  partyName: z.string().trim().min(1).max(200),
  partyPhone: z.string().trim().max(50).optional(),
});

export const labLedgerAccountParamSchema = z.object({ accountId: z.string().uuid() });

export const labLedgerPaymentSchema = z.object({
  amount: z.number().finite().positive(),
  paymentMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET"]),
  notes: z.string().trim().max(500).optional(),
});
