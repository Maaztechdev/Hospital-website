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
