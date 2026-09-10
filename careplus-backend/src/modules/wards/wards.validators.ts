import { z } from "zod";
import { WardType, AdmissionType } from "@prisma/client";

export const createWardSchema = z.object({
  wardName: z.string().min(1),
  wardType: z.nativeEnum(WardType),
});

export const createRoomSchema = z.object({
  wardId: z.string().uuid(),
  roomNumber: z.string().min(1),
});

export const createBedSchema = z.object({
  roomId: z.string().uuid(),
  bedNumber: z.string().min(1),
  bedLabel: z.string().optional(),
  dailyRate: z.number().nonnegative().default(0),
});

export const admitPatientSchema = z.object({
  patientId: z.string().uuid(),
  bedId: z.string().uuid(),
  attendingDoctorId: z.string().uuid(),
  admissionType: z.nativeEnum(AdmissionType).optional(),
  admissionReason: z.string().min(1),
  depositAmount: z.number().nonnegative().optional(),
});

export const transferBedSchema = z.object({
  toBedId: z.string().uuid(),
  reason: z.string().min(1),
});

export const dischargeSchema = z.object({
  dischargeSummary: z.string().min(1),
  dischargeNotes: z.string().optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listAdmissionsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.string().optional(),
  patientId: z.string().uuid().optional(),
});
