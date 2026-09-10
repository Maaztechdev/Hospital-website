import { z } from "zod";
import { Priority } from "@prisma/client";

export const createLabOrderSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid().optional(),
  testId: z.string().uuid(),
  priority: z.nativeEnum(Priority).optional(),
  sampleType: z.string().optional(),
  clinicalNotes: z.string().max(1000).optional(),
  consultationId: z.string().uuid().optional(),
});

export const updateSampleStatusSchema = z.object({
  status: z.enum(["SAMPLE_COLLECTED", "PROCESSING", "CANCELLED"]),
});

export const enterResultSchema = z.object({
  resultValue: z.string().min(1),
  unit: z.string().optional(),
  referenceRange: z.string().optional(),
  interpretation: z.enum(["NORMAL", "HIGH", "LOW", "CRITICAL"]).optional(),
  technicianNotes: z.string().max(1000).optional(),
});

export const amendResultSchema = enterResultSchema.extend({
  reason: z.string().min(1).max(500),
});

export const uploadReportSchema = z.object({
  fileUrl: z.string().regex(/^\/api\/v1\/files\/lab-reports\/[a-f0-9-]+\.(pdf|jpg|png)$/),
  fileType: z.string().min(1),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listLabOrdersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  patientId: z.string().uuid().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
});

export const createLabTestSchema = z.object({
  testName: z.string().min(1),
  testCode: z.string().min(1),
  category: z.string().optional(),
  price: z.number().nonnegative(),
  unit: z.string().optional(),
  referenceRangeMin: z.number().optional(),
  referenceRangeMax: z.number().optional(),
});
