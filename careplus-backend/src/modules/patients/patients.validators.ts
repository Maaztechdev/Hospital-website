import { z } from "zod";
import { Gender, BloodGroup } from "@prisma/client";

export const ageSchema = z.coerce.number({ invalid_type_error: "Age must be a number" }).int("Age must be a whole number").min(0, "Age must be between 0 and 120").max(120, "Age must be between 0 and 120");

export const createPatientSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  age: ageSchema,
  gender: z.nativeEnum(Gender),
  phone: z.string().min(7).max(20),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  cnic: z.string().max(20).optional(),
  bloodGroup: z.nativeEnum(BloodGroup).optional(),
  allergies: z.array(z.string()).optional(),
  allergiesReviewed: z.boolean().optional(),
  chronicConditions: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  chronicConditionsReviewed: z.boolean().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export const updatePatientSchema = createPatientSchema.partial();

export const listPatientsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
});

export const mergePatientsSchema = z.object({
  primaryPatientId: z.string().uuid(),
  duplicatePatientId: z.string().uuid(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const clinicalHistoryUpdateSchema = z.object({
  allergies: z.array(z.string().trim().min(1).max(200)).max(50),
  allergiesReviewed: z.literal(true),
  chronicConditions: z.array(z.string().trim().min(1).max(200)).max(50),
  chronicConditionsReviewed: z.literal(true),
});
