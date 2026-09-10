import { z } from "zod";

export const createMedicineSchema = z.object({
  name: z.string().min(1),
  genericName: z.string().optional(),
  strength: z.string().optional(),
  form: z.string().optional(),
  categoryId: z.string().uuid().optional(),
});

export const addBatchSchema = z.object({
  medicineId: z.string().uuid(),
  batchNumber: z.string().min(1),
  expiryDate: z.string().date(),
  purchasePrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  stockQuantity: z.number().int().nonnegative(),
  reorderLevel: z.number().int().nonnegative().optional(),
  supplierId: z.string().uuid().optional(),
});

export const stockInSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int().positive(),
  reason: z.string().optional(),
});

export const dispenseSchema = z.object({
  prescriptionItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export const pharmacySaleSchema = z.object({
  items: z.array(z.object({
    medicineId: z.string().uuid(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative().optional(),
    discount: z.number().nonnegative().default(0),
  })).min(1),
  tax: z.number().nonnegative().default(0),
  paymentMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET"]),
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(50).optional(),
});

export const returnSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int().positive(),
  reason: z.string().min(1),
});

export const adjustSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int(),
  reason: z.string().min(1),
});

export const markDamagedExpiredSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int().positive(),
  type: z.enum(["DAMAGED", "EXPIRED"]),
  reason: z.string().min(1),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listMedicinesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  lowStock: z.enum(["true", "false"]).optional(),
  nearExpiry: z.enum(["true", "false"]).optional(),
});
