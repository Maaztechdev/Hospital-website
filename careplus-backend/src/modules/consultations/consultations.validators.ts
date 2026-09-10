import { z } from "zod";

const vitalsSchema = z.object({
  bp_systolic: z.number().optional(),
  bp_diastolic: z.number().optional(),
  temperature: z.number().optional(),
  pulse: z.number().optional(),
  weight: z.number().optional(),
  oxygen_saturation: z.number().optional(),
});

export const createConsultationSchema = z.object({
  appointmentId: z.string().uuid(),
  chiefComplaint: z.string().max(2000).optional(),
  vitals: vitalsSchema.optional(),
  diagnosis: z.string().max(2000).optional(),
  clinicalNotes: z.string().max(4000).optional(),
  followUpDate: z.string().date().optional(),
  referral: z.string().max(500).optional(),
});

export const updateConsultationSchema = createConsultationSchema.omit({ appointmentId: true }).partial();

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listConsultationsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  appointmentId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
});
