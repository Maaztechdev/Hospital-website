import { z } from "zod";
import { InvoiceItemType, PaymentMethod } from "@prisma/client";

const invoiceItemSchema = z.object({
  itemType: z.nativeEnum(InvoiceItemType),
  description: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
});

export const createInvoiceSchema = z.object({
  patientId: z.string().uuid(),
  items: z.array(invoiceItemSchema).min(1),
  discountAmount: z.number().nonnegative().optional(),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  discountReason: z.string().optional(),
  taxAmount: z.number().nonnegative().optional(),
});

export const recordPaymentSchema = z.object({
  paymentMethod: z.nativeEnum(PaymentMethod),
  amount: z.number().positive(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listInvoicesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  patientId: z.string().uuid().optional(),
  status: z.string().optional(),
});
