import { z } from "zod";
import { InvoiceDepartment, InvoiceItemType, InvoiceStatus, PaymentMethod, Prisma } from "@prisma/client";
import { roundMoney } from "@common/utils/money";

const invoiceItemSchema = z.object({
  itemType: z.nativeEnum(InvoiceItemType),
  description: z.string().trim().min(1),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().positive(),
  discount: z.number().nonnegative().default(0),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).default("FLAT"),
}).superRefine((item, context) => {
  const lineAmount = roundMoney(new Prisma.Decimal(item.quantity).mul(roundMoney(item.unitPrice)));
  const discount = item.discountType === "PERCENTAGE"
    ? new Prisma.Decimal(item.discount)
    : roundMoney(item.discount);
  const discountAmount = item.discountType === "PERCENTAGE"
    ? roundMoney(lineAmount.mul(discount).div(100))
    : discount;

  if (item.discountType === "PERCENTAGE" && discount.gt(100)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "Percentage discount cannot exceed 100%" });
  } else if (discountAmount.gt(lineAmount)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "Discount cannot exceed the line amount" });
  }
});

export const createInvoiceSchema = z.object({
  patientId: z.string().uuid(),
  department: z.nativeEnum(InvoiceDepartment),
  appointmentId: z.string().uuid().optional(),
  admissionId: z.string().uuid().optional(),
  items: z.array(invoiceItemSchema).min(1),
  discountAmount: z.number().nonnegative().optional(),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  discountReason: z.string().optional(),
  taxAmount: z.number().nonnegative().optional(),
}).superRefine((invoice, context) => {
  const subtotal = invoice.items.reduce((total, item) => {
    const lineAmount = roundMoney(new Prisma.Decimal(item.quantity).mul(roundMoney(item.unitPrice)));
    return total.plus(lineAmount);
  }, new Prisma.Decimal(0));
  const lineDiscountAmount = invoice.items.reduce((total, item) => {
    const lineAmount = roundMoney(new Prisma.Decimal(item.quantity).mul(roundMoney(item.unitPrice)));
    const discountAmount = item.discountType === "PERCENTAGE"
      ? roundMoney(lineAmount.mul(item.discount).div(100))
      : roundMoney(item.discount);
    return total.plus(discountAmount);
  }, new Prisma.Decimal(0));

  if (lineDiscountAmount.plus(invoice.discountAmount ?? 0).gt(subtotal)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["discountAmount"],
      message: "Total discounts cannot exceed invoice subtotal",
    });
  }
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

export const refundInvoiceSchema = z.object({
  paymentMethod: z.nativeEnum(PaymentMethod),
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(500),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date");

export const listInvoicesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  patientId: z.string().uuid().optional(),
  department: z.nativeEnum(InvoiceDepartment).optional(),
  departments: z.string().transform((value) => value.split(",")).pipe(
    z.array(z.nativeEnum(InvoiceDepartment)).min(1).optional(),
  ).optional(),
  dateFrom: dateKeySchema.optional(),
  dateTo: dateKeySchema.optional(),
  createdBy: z.string().uuid().optional(),
  status: z.union([z.nativeEnum(InvoiceStatus), z.literal("OUTSTANDING")]).optional(),
  search: z.string().trim().max(120).optional(),
  itemType: z.nativeEnum(InvoiceItemType).optional(),
}).refine((range) => !range.dateFrom || !range.dateTo || range.dateFrom <= range.dateTo, {
  message: "dateFrom must be on or before dateTo",
});

export const billingStaffQuerySchema = z.object({
  department: z.nativeEnum(InvoiceDepartment).optional(),
});

export const billingDateRangeSchema = z.object({
  dateFrom: dateKeySchema.optional(),
  dateTo: dateKeySchema.optional(),
}).refine((range) => !range.dateFrom || !range.dateTo || range.dateFrom <= range.dateTo, {
  message: "dateFrom must be on or before dateTo",
});
