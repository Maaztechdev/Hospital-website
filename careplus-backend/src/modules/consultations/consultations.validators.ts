import { z } from "zod";
import { getTemperatureRange, VITAL_RANGES } from "@common/validation/vitals";

function nullableOptional<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullable().optional().transform((value) => value ?? undefined);
}

const vitalsSchema = z.object({
  bp_systolic: nullableOptional(z.number().int().min(VITAL_RANGES.systolic.min).max(VITAL_RANGES.systolic.max)),
  bp_diastolic: nullableOptional(z.number().int().min(VITAL_RANGES.diastolic.min).max(VITAL_RANGES.diastolic.max)),
  temperature: nullableOptional(z.number()),
  temperature_unit: z.enum(["F", "C"]).nullable().optional(),
  pulse: nullableOptional(z.number().int().min(VITAL_RANGES.pulse.min).max(VITAL_RANGES.pulse.max)),
  weight: nullableOptional(z.number().min(VITAL_RANGES.weightKg.min).max(VITAL_RANGES.weightKg.max)),
  oxygen_saturation: nullableOptional(z.number().int().min(VITAL_RANGES.oxygenSaturation.min).max(VITAL_RANGES.oxygenSaturation.max)),
  respiratory_rate: nullableOptional(z.number().int().min(VITAL_RANGES.respiratoryRate.min).max(VITAL_RANGES.respiratoryRate.max)),
  height_cm: nullableOptional(z.number().min(VITAL_RANGES.heightCm.min).max(VITAL_RANGES.heightCm.max)),
  estimated: z.boolean().optional(),
  critical_confirmed: z.boolean().optional(),
}).superRefine((vitals, context) => {
  if ((vitals.bp_systolic === undefined) !== (vitals.bp_diastolic === undefined)) {
    context.addIssue({ code: "custom", message: "Enter both systolic and diastolic blood pressure values.", path: ["bp_diastolic"] });
  }
  if (vitals.bp_systolic !== undefined && vitals.bp_diastolic !== undefined && vitals.bp_systolic <= vitals.bp_diastolic) {
    context.addIssue({ code: "custom", message: "Systolic pressure must be greater than diastolic pressure.", path: ["bp_systolic"] });
  }
  if (vitals.temperature !== undefined) {
    const unit = vitals.temperature_unit ?? "F";
    const range = getTemperatureRange(unit);
    if (vitals.temperature < range.min || vitals.temperature > range.max) {
      context.addIssue({ code: "custom", message: `Temperature must be between ${range.min} and ${range.max} °${unit}.`, path: ["temperature"] });
    }
  }
});

export type ConsultationVitalsInput = z.infer<typeof vitalsSchema>;

const consultationFields = {
  chiefComplaint: z.string().max(2000).optional(),
  vitals: vitalsSchema.optional(),
  diagnosis: z.string().max(2000).optional(),
  diagnosisCode: z.string().trim().regex(/^[A-Z][0-9A-Z](?:[0-9A-Z.]*)$/).max(12).optional(),
  findings: z.string().max(4000).optional(),
  clinicalNotes: z.string().max(4000).optional(),
  followUpDate: z.string().date().optional(),
  referral: z.string().max(500).optional(),
};

export const createConsultationSchema = z.object({
  appointmentId: z.string().uuid(),
  ...consultationFields,
});

export const startConsultationSchema = z.object({
  appointmentId: z.string().uuid(),
});

export const updateConsultationSchema = z.object(consultationFields).partial();

export const createConsultationAddendumSchema = z.object({
  note: z.string().trim().min(1).max(4000),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listConsultationsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  appointmentId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
});
