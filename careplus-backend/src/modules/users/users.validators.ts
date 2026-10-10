import { z } from "zod";
import { Role } from "@prisma/client";

export const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(20).optional(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number"),
  role: z.nativeEnum(Role),
  departmentId: z.string().uuid().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(7).max(20).optional(),
  role: z.nativeEnum(Role).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  search: z.string().optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

const profileText = z.preprocess((value) => value === "" ? undefined : value, z.string().trim().max(255).optional());

export const staffProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  qualification: profileText,
  specialization: profileText,
  registrationNumber: profileText,
  pmdcRegistrationNo: profileText,
  phcRegistrationNo: profileText,
  consultationFee: z.preprocess((value) => value === "" || value === undefined ? undefined : Number(value), z.number().finite().nonnegative().optional()),
});

export function validateStaffProfileForRole(role: string, profile: z.infer<typeof staffProfileSchema>) {
  const errors: Record<string, string> = {};
  if (role === "DOCTOR") {
    if (!profile.qualification) errors.qualification = "Qualification is required for doctors";
    if (!profile.specialization) errors.specialization = "Specialization is required for doctors";
    if (!profile.pmdcRegistrationNo && !profile.registrationNumber) errors.pmdcRegistrationNo = "PM&DC registration number is required for doctors";
  }
  if (["PHARMACIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"].includes(role) && !profile.registrationNumber) {
    errors.registrationNumber = "Registration or license number is required for this role";
  }
  return errors;
}
