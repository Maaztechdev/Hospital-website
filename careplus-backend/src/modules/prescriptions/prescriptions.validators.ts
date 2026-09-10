import { z } from "zod";

const prescriptionItemSchema = z.object({
  medicineId: z.string().uuid().optional(),
  medicineName: z.string().min(1),
  dosage: z.string().min(1),
  route: z.string().min(1),
  frequency: z.string().min(1),
  durationDays: z.number().int().positive(),
  instructions: z.string().max(500).optional(),
});

export const createPrescriptionSchema = z.object({
  consultationId: z.string().uuid(),
  items: z.array(prescriptionItemSchema).min(1),
});

export const voidPrescriptionSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listPrescriptionsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  patientId: z.string().uuid().optional(),
  status: z.string().optional(),
});
