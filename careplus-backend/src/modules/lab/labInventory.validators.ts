import { z } from "zod";

const quantity = z.number().finite().positive().max(1_000_000_000);

export const labInventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(["REAGENT", "TUBE", "STRIP", "KIT", "OTHER"]),
  unit: z.string().trim().min(1).max(40),
  reorderLevel: z.number().finite().nonnegative().max(1_000_000_000),
  supplierId: z.string().uuid().nullable().optional(),
}).strict();

export const labInventoryBatchSchema = z.object({
  itemId: z.string().uuid(),
  batchNumber: z.string().trim().min(1).max(100),
  expiryDate: z.string().date(),
  quantity,
  purchasePrice: z.number().finite().nonnegative().max(1_000_000_000),
  supplierId: z.string().uuid().nullable().optional(),
}).strict();

export const labInventoryMappingSchema = z.object({
  testId: z.string().uuid(),
  itemId: z.string().uuid(),
  quantityPerTestRun: quantity,
}).strict();

export const labInventoryAdjustmentSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().finite().refine((value) => value !== 0 && Math.abs(value) <= 1_000_000_000),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const labInventoryQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["name", "low_stock", "expiry"]).optional(),
});

export const labInventoryParamsSchema = z.object({
  id: z.string().uuid(),
});
