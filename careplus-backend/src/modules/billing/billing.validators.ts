import { z } from "zod";
import { InvoiceItemType, InvoiceStatus, PaymentMethod } from "@prisma/client";

const invoiceItemSchema = z.object({
  itemType: z.nativeEnum(InvoiceItemType),
  description: z.string().trim().min(1),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().positive(),
  discount: z.number().nonnegative().default(0),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).default("FLAT"),
}).superRefine((item, context) => {
  const lineAmount = Math.round(item.quantity * item.unitPrice);
  const discountAmount = item.discountType === "PERCENTAGE"
    ? Math.round(lineAmount * item.discount / 100)
    : Math.round(item.discount);

  if (item.discountType === "PERCENTAGE" && item.discount > 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "Percentage discount cannot exceed 100%" });
  } else if (discountAmount > lineAmount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "Discount cannot exceed the line amount" });
  }
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
  reason: z.string().trim().min(1).max(500),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const listInvoicesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  patientId: z.string().uuid().optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  search: z.string().trim().max(120).optional(),
  itemType: z.nativeEnum(InvoiceItemType).optional(),
});
