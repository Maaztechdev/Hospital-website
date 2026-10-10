import { z } from "zod";

export const pharmacySettingsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500),
  phone: z.string().trim().max(40),
  currency: z.literal("PKR"),
  defaultReceiptFormat: z.enum(["a4", "receipt"]),
  cashierMaxDiscountPercent: z.number().min(0).max(100),
  lossAlertThreshold: z.number().nonnegative().max(100000000),
  defaultLowStockLevel: z.number().int().nonnegative().max(1000000),
});

export const pharmacyAdminPinSchema = z.object({
  currentPin: z.string().regex(/^\d{4,12}$/).optional(),
  newPin: z.string().regex(/^\d{4,12}$/),
}).strict();

export const createMedicineSchema = z.object({
  name: z.string().min(1),
  genericName: z.string().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  strength: z.string().optional(),
  form: z.string().optional(),
  unitType: z.enum(["TABLET", "CAPSULE", "SYRUP", "INJECTION", "STRIP"]).default("TABLET"),
  manufacturer: z.string().trim().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  initialBatch: z.object({
    batchNumber: z.string().trim().min(1).max(100),
    expiryDate: z.string().date(),
    purchasePrice: z.number().nonnegative(),
    sellingPrice: z.number().nonnegative(),
    stockQuantity: z.number().int().nonnegative(),
    reorderLevel: z.number().int().nonnegative().optional(),
  }).optional(),
});
export const updateMedicineSchema = createMedicineSchema.omit({ initialBatch: true });

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
  batchId: z.string().uuid().optional(),
  medicineId: z.string().uuid().optional(),
  batchNumber: z.string().trim().min(1).max(100).optional(),
  expiryDate: z.string().date().optional(),
  quantity: z.number().int().positive(),
  purchasePrice: z.number().nonnegative().optional(),
  sellingPrice: z.number().nonnegative().optional(),
  reorderLevel: z.number().int().nonnegative().optional(),
  supplierName: z.string().trim().max(200).optional(),
  invoiceReference: z.string().trim().max(100).optional(),
}).superRefine((data, context) => {
  if (data.batchId) {
    if (data.medicineId || data.batchNumber || data.expiryDate) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Use either an existing batch ID or new batch details, not both." });
    }
  } else {
    if (!data.medicineId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["medicineId"], message: "Medicine is required for a new batch." });
    if (!data.batchNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ["batchNumber"], message: "Batch number is required for a new batch." });
    if (!data.expiryDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiryDate"], message: "Expiry date is required for a new batch." });
    if (data.purchasePrice === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["purchasePrice"], message: "Cost price is required for a new batch." });
    if (data.sellingPrice === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sellingPrice"], message: "Selling price is required for a new batch." });
  }
});

export const dispenseSchema = z.object({
  prescriptionItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export const dispensePrescriptionSchema = z.object({
  items: z.array(z.object({
    prescriptionItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1).max(100).superRefine((items, context) => {
    const ids = new Set<string>();
    items.forEach((item, index) => {
      if (ids.has(item.prescriptionItemId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "prescriptionItemId"], message: "Each prescription line may only be dispensed once." });
      }
      ids.add(item.prescriptionItemId);
    });
  }),
});

export const pharmacySaleSchema = z.object({
  items: z.array(z.object({
    medicineId: z.string().uuid(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative().optional(),
    discount: z.number().nonnegative().default(0),
  })).min(1),
  tax: z.number().nonnegative().default(0),
  paymentMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "CREDIT"]),
  paidNow: z.number().nonnegative().optional(),
  paidNowMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET"]).optional(),
  patientId: z.string().uuid().optional(),
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(50).optional(),
  discountReason: z.string().trim().max(500).optional(),
});

export const pharmacyLedgerAccountsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  type: z.enum(["RECEIVABLE", "PAYABLE"]).optional(),
  patientId: z.string().uuid().optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const pharmacyLedgerAccountSchema = z.object({
  type: z.enum(["RECEIVABLE", "PAYABLE"]).default("RECEIVABLE"),
  patientId: z.string().uuid().optional(),
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(50).optional(),
});

export const pharmacyLedgerPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET"]),
  notes: z.string().trim().max(500).optional(),
});

export const pharmacyLedgerAdjustmentSchema = z.object({
  amount: z.number().refine((amount) => amount !== 0, "Adjustment amount cannot be zero."),
  notes: z.string().trim().min(1).max(500),
});

export const pharmacyLedgerAccountParamSchema = z.object({ accountId: z.string().uuid() });

export const discountAuditQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  cashier: z.string().trim().max(200).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const pharmacySaleVoidSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const pharmacySaleReturnSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  items: z.array(z.object({
    saleItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
    returnToStock: z.boolean().default(true),
  })).min(1).superRefine((items, context) => {
    const ids = new Set<string>();
    items.forEach((item, index) => {
      if (ids.has(item.saleItemId)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "saleItemId"], message: "Each sale line may be included only once." });
      ids.add(item.saleItemId);
    });
  }),
});

export const pharmacySaleAdjustmentQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  type: z.enum(["VOID", "RETURN"]).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const pharmacyInvoiceListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const pharmacyReportQuerySchema = z.object({
  period: z.enum(["today", "yesterday", "week", "month", "all", "custom"]).default("today"),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  expiryDays: z.coerce.number().int().refine((value) => [30, 60, 90].includes(value)).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  categoriesPage: z.coerce.number().int().min(1).default(1),
  topMedicinesPage: z.coerce.number().int().min(1).default(1),
  lowStockPage: z.coerce.number().int().min(1).default(1),
  expiringPage: z.coerce.number().int().min(1).default(1),
  expiredPage: z.coerce.number().int().min(1).default(1),
  cashiersPage: z.coerce.number().int().min(1).default(1),
  paymentMethodsPage: z.coerce.number().int().min(1).default(1),
});

export const returnSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});

export const adjustSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int(),
  reason: z.string().trim().min(1).max(500),
});

export const markDamagedExpiredSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int().positive(),
  type: z.enum(["DAMAGED", "EXPIRED"]),
  reason: z.string().trim().min(1).max(500),
});

export const idParamSchema = z.object({ id: z.string().uuid() });
export const pharmacyInvoiceParamSchema = z.object({ invoiceId: z.string().uuid() });

export const listMedicinesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  lowStock: z.enum(["true", "false"]).optional(),
  nearExpiry: z.enum(["true", "false"]).optional(),
  categoryId: z.string().uuid().optional(),
});
