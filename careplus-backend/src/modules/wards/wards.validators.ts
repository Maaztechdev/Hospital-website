import { z } from "zod";
import { WardType, AdmissionType } from "@prisma/client";

export const createWardSchema = z.object({
  wardName: z.string().min(1),
  wardType: z.nativeEnum(WardType).default(WardType.GENERAL),
  dailyRate: z.number().positive(),
  capacity: z.number().int().positive(),
  amenities: z.array(z.string().min(1)).default([]),
  isActive: z.boolean().default(true),
});

export const updateWardSchema = createWardSchema;

export const listWardsQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
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

const bulkRoomUpdateSchema = z.object({
  id: z.string().uuid(),
  wardId: z.string().uuid(),
  roomNumber: z.string().min(1),
});

const bulkBedUpdateSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  bedNumber: z.string().min(1),
  bedLabel: z.string().optional().nullable(),
});

const bulkAddBedsSchema = z.object({
  wardId: z.string().uuid(),
  roomNumber: z.string().min(1),
  bedNumbers: z.array(z.string().min(1)).min(1),
});

export const bulkRoomBedSchema = z.object({
  roomUpdates: z.array(bulkRoomUpdateSchema).default([]),
  bedUpdates: z.array(bulkBedUpdateSchema).default([]),
  deleteBedIds: z.array(z.string().uuid()).default([]),
  addBeds: z.array(bulkAddBedsSchema).default([]),
});

export const admitPatientSchema = z.object({
  patientId: z.string().uuid(),
  bedId: z.string().uuid(),
  attendingDoctorId: z.string().uuid(),
  admissionType: z.nativeEnum(AdmissionType, { required_error: "Admission type is required" }),
  admissionReason: z.string().min(1),
  depositAmount: z.number().int().min(0).max(1_000_000),
  dailyRate: z.number().positive().optional(),
  expectedStayDays: z.number().int().min(1).max(365).optional(),
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
