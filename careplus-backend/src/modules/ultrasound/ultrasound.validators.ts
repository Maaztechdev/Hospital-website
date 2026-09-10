import { z } from "zod";
import { Priority, UltrasoundOrderStatus } from "@prisma/client";

export const idParamSchema = z.object({ id: z.string().uuid() });
export const patientParamSchema = z.object({ patientId: z.string().uuid() });

export const createUltrasoundOrderSchema = z.object({
  patientId: z.string().uuid(),
  examType: z.string().min(1).max(120),
  priority: z.nativeEnum(Priority).optional(),
  notes: z.string().max(2000).optional(),
  consultationId: z.string().uuid().optional(),
});

export const scheduleUltrasoundSchema = z.object({
  scheduledAt: z.coerce.date(),
  technicianId: z.string().uuid().optional(),
});

export const completeUltrasoundSchema = z.object({
  findings: z.string().min(1).max(10000),
  impression: z.string().min(1).max(5000),
  imageUrls: z.array(z.string().url()).max(30).optional(),
});

export const listUltrasoundOrdersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.nativeEnum(UltrasoundOrderStatus).optional(),
  patientId: z.string().uuid().optional(),
  technicianId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
