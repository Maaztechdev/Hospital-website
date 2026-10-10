import { z } from "zod";
import { DOSE_UNITS, DURATION_UNITS, FREQUENCY_CODES, ROUTE_OPTIONS, prescriptionItemsSchema } from "@common/validation/prescription";

const prescriptionPadDataSchema = z.object({
  visitNumber: z.string().trim().max(100).optional(),
  visitDate: z.string().date().optional(),
  visitTime: z.string().trim().max(30).optional(),
  relationship: z.string().trim().max(20).optional(),
  patientAddress: z.string().trim().max(500).optional(),
  patientContact: z.string().trim().max(40).optional(),
  patientAge: z.number().int().nonnegative().max(150).optional(),
  patientGender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  patientWeight: z.string().trim().max(40).optional(),
  vitals: z.record(z.string(), z.unknown()).optional(),
  allergies: z.string().max(2000).optional(),
  presentingComplaints: z.string().max(4000).optional(),
  history: z.string().max(4000).optional(),
  findings: z.string().max(4000).optional(),
  investigations: z.string().max(4000).optional(),
  rxText: z.string().max(20000).optional(),
  refillNumber: z.number().int().min(0).max(4).optional(),
});

export const createPrescriptionSchema = z.object({
  consultationId: z.string().uuid(),
  items: prescriptionItemsSchema,
  padData: prescriptionPadDataSchema.optional(),
  allergyOverrides: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});

export const voidPrescriptionSchema = z.object({
  reason: z.string().min(1).max(500),
});

const templateItemSchema = z.object({
  medicine: z.string().trim().min(1).max(200),
  medicineId: z.string().max(100).optional(),
  isCatalogItem: z.boolean().optional(),
  doseAmount: z.string().min(1).max(20),
  doseUnit: z.enum(DOSE_UNITS),
  route: z.enum(ROUTE_OPTIONS),
  frequencyCode: z.enum(FREQUENCY_CODES),
  durationValue: z.string().min(1).max(20),
  durationUnit: z.enum(DURATION_UNITS),
  instructions: z.string().max(500).optional(),
});

export const prescriptionTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  items: z.array(templateItemSchema).min(1).max(100),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listPrescriptionsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  patientId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "SIGNED", "COMPLETED", "DISPENSED", "VOID"]).optional(),
});
