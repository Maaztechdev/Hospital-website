import { z } from "zod";
import { AppointmentType, AppointmentSource, Priority } from "@prisma/client";
import { ageSchema } from "@modules/patients/patients.validators";

export const createAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  appointmentDate: z.string().date(),
  timeSlot: z.string().regex(/^\d{2}:\d{2}$/, "timeSlot must be HH:mm"),
  appointmentType: z.nativeEnum(AppointmentType),
  priority: z.nativeEnum(Priority).optional(),
  source: z.nativeEnum(AppointmentSource).optional(),
  reason: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
});

export const publicAppointmentSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s-]{6,18}$/, "Enter a valid phone number"),
  email: z.string().email().optional(),
  age: ageSchema,
  doctorId: z.string().uuid(),
  departmentId: z.string().uuid(),
  appointmentDate: z.string().date(),
  timeSlot: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().max(1000).optional(),
});

export const rescheduleSchema = z.object({
  appointmentDate: z.string().date(),
  timeSlot: z.string().regex(/^\d{2}:\d{2}$/),
});

export const rejectSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});

export const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const listAppointmentsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  date: z.string().date().optional(),
  doctorId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  status: z.string().optional(),
  sort: z.enum(["date", "recentlyCreated"]).optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});
