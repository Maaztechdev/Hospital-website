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
  admissionNotes: z.string().trim().max(5000).optional(),
});

export const recordAdmissionDepositSchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  paymentMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET"]).default("CASH"),
  notes: z.string().trim().max(500).optional(),
});

export const transferBedSchema = z.object({
  toBedId: z.string().uuid(),
  reason: z.string().min(1),
});

export const dischargeSchema = z.object({
  diagnosis: z.string().trim().min(1, "Diagnosis is required"),
  courseInHospital: z.string().trim().optional().default(""),
  medications: z.array(z.string().trim().min(1)).default([]),
  conditionAtDischarge: z.string().trim().min(1, "Condition at discharge is required"),
  followUpDate: z.string().date().optional(),
  referral: z.string().trim().optional().default(""),
  instructions: z.string().trim().min(1, "Patient instructions are required"),
  confirmUnpaidBalance: z.boolean().default(false),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listAdmissionsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.string().optional(),
  patientId: z.string().uuid().optional(),
});
