import { z } from "zod";
import { UltrasoundOrderStatus } from "@prisma/client";

export const idParamSchema = z.object({ id: z.string().uuid() });
export const patientParamSchema = z.object({ patientId: z.string().uuid() });

export const createUltrasoundOrderSchema = z.object({
  patientId: z.string().uuid(),
  examType: z.string().min(1).max(120),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).optional(),
  feeAmount: z.number().nonnegative().max(100000000).optional(),
  discountAmount: z.number().nonnegative().max(100000000).optional(),
  discountType: z.enum(["AMOUNT", "PERCENTAGE"]).optional(),
  discountReason: z.string().trim().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  consultationId: z.string().uuid().optional(),
  admissionId: z.string().uuid().optional(),
}).superRefine(({ feeAmount = 0, discountAmount = 0, discountType, discountReason }, context) => {
  if (discountType === "PERCENTAGE" && discountAmount > 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discountAmount"], message: "Percentage discount cannot exceed 100%" });
  }
  if (discountType !== "PERCENTAGE" && discountAmount > feeAmount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discountAmount"], message: "Discount cannot exceed the ultrasound fee" });
  }
  if (discountAmount > 0 && !discountReason?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discountReason"], message: "A reason is required for an ultrasound discount" });
  }
});

export const ultrasoundAnalyticsRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).superRefine(({ from, to }, context) => {
  if (from && to && from > to) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "End date must be on or after start date" });
  }
});

export const ultrasoundAuditActionValues = [
  "ULTRASOUND_ORDER_CREATED",
  "ULTRASOUND_ORDER_SCHEDULED",
  "ULTRASOUND_ORDER_ASSIGNED",
  "ULTRASOUND_STATUS_CHANGED",
  "ULTRASOUND_FINDINGS_EDITED",
  "ULTRASOUND_REPORT_VERIFIED",
  "ULTRASOUND_REPORT_AMENDED",
  "ULTRASOUND_REPORT_PRINTED",
  "ULTRASOUND_IMAGES_ADDED",
  "ULTRASOUND_IMAGES_REMOVED",
  "ULTRASOUND_ORDER_CANCELLED",
  "ULTRASOUND_PRICE_DISCOUNT_CHANGED",
  "CREATE",
  "UPDATE",
  "STATUS_CHANGE",
] as const;

export const ultrasoundAuditTrailQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  userId: z.string().uuid().optional(),
  action: z.enum(ultrasoundAuditActionValues).optional(),
  search: z.string().trim().max(160).optional(),
}).superRefine(({ from, to }, context) => {
  if (from && to && from > to) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "End date must be on or after start date" });
  }
});

export const ultrasoundPricingSchema = z.object({
  feeAmount: z.number().nonnegative().max(100000000),
  discountAmount: z.number().nonnegative().max(100000000),
  reason: z.string().trim().max(1000).optional(),
}).superRefine(({ feeAmount, discountAmount }, context) => {
  if (discountAmount > feeAmount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discountAmount"], message: "Discount cannot exceed the ultrasound fee" });
  }
});

export const ultrasoundScanCatalogSchema = z.array(z.object({
  name: z.enum(["Obstetric", "Abdomen", "KUB", "Renal", "Pelvis", "Thyroid", "Breast", "Doppler", "Other"]),
  fee: z.number().finite().nonnegative().max(100000000),
  enabled: z.boolean(),
})).length(9).superRefine((items, context) => {
  if (new Set(items.map((item) => item.name)).size !== items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Scan type names must be unique" });
  }
});

export const scheduleUltrasoundSchema = z.object({
  scheduledAt: z.coerce.date(),
  technicianId: z.string({ required_error: "Please assign a staff member" }).uuid("Please select a valid staff member"),
});

const ultrasoundTemplateFieldSchema = z.object({
  key: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(120),
  type: z.enum(["organ", "text", "number", "date", "select", "estimatedDueDate", "gestationalAge"]),
  unit: z.string().max(24).optional(),
  options: z.array(z.string().min(1).max(80)).max(30).optional(),
  calculatedFrom: z.string().max(80).optional(),
  patientGender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
}).strict();

const structuredValueSchema = z.union([
  z.string().max(5000),
  z.number().finite(),
  z.boolean(),
  z.object({ status: z.enum(["NORMAL", "ABNORMAL"]), notes: z.string().max(2000) }).strict(),
  z.null(),
]);

export const completeUltrasoundSchema = z.object({
  findings: z.string().min(1).max(20000),
  impression: z.string().max(5000).optional(),
  structuredData: z.record(structuredValueSchema).optional(),
  imageUrls: z.array(z.string().refine((value) => /^https?:\/\//.test(value) || value.startsWith("/api/v1/files/"), "Image URL must be a valid uploaded file reference")).max(30).optional(),
  imageCaptions: z.array(z.string().max(200)).max(30).optional(),
}).superRefine((input, context) => {
  if (input.imageUrls?.length && (!input.imageCaptions || input.imageCaptions.length !== input.imageUrls.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["imageCaptions"], message: "Each ultrasound image must have a matching caption" });
  }
});

export const reviewUltrasoundSchema = z.object({
  findings: z.string().min(1).max(20000).optional(),
  impression: z.string().min(1).max(5000).optional(),
  structuredData: z.record(structuredValueSchema).optional(),
  amendmentReason: z.string().trim().min(1).max(1000).optional(),
  expectedUpdatedAt: z.string().optional(),
}).refine(({ findings, impression, structuredData }) => findings !== undefined || impression !== undefined || structuredData !== undefined, {
  message: "Provide at least one report field to update",
});

export const updateUltrasoundTemplateSchema = z.object({
  sections: z.array(ultrasoundTemplateFieldSchema).min(1).max(60),
}).superRefine(({ sections }, context) => {
  const keys = new Set<string>();
  sections.forEach((field, index) => {
    if (keys.has(field.key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "key"], message: "Template field keys must be unique" });
    }
    keys.add(field.key);
    if (field.type === "select" && !field.options?.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "options"], message: "Select fields require at least one option" });
    }
    if ((field.type === "estimatedDueDate" || field.type === "gestationalAge") && !field.calculatedFrom) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "calculatedFrom"], message: "Calculated fields require a source field" });
    }
  });
});

export const listUltrasoundOrdersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.nativeEnum(UltrasoundOrderStatus).optional(),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).optional(),
  examType: z.string().max(120).optional(),
  sort: z.enum(["priority", "time"]).optional(),
  patientId: z.string().uuid().optional(),
  technicianId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
