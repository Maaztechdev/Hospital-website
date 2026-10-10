import { createInvoiceSchema, voidInvoiceSchema } from "../../src/modules/billing/billing.validators";
import { calculateInvoiceItems } from "../../src/modules/billing/billing.service";

const baseItem = {
  itemType: "CONSULTATION",
  description: "Consultation",
  quantity: 1,
  unitPrice: 1000,
  discount: 0,
};

describe("invoice line validation and PKR calculations", () => {
  it("calculates percentage discounts on the backend and rounds to whole PKR", () => {
    const [item] = calculateInvoiceItems([{ ...baseItem, discount: 10, discountType: "PERCENTAGE" }]);
    expect(item.discount).toBe(100);
    expect(item.subtotal).toBe(900);
  });

  it("preserves flat discounts as PKR amounts", () => {
    const [item] = calculateInvoiceItems([{ ...baseItem, discount: 10, discountType: "FLAT" }]);
    expect(item.discount).toBe(10);
    expect(item.subtotal).toBe(990);
  });

  it("rejects zero prices and discounts above the line amount", () => {
    expect(() => calculateInvoiceItems([{ ...baseItem, unitPrice: 0 }])).toThrow("Unit price must be greater than zero");
    expect(() => calculateInvoiceItems([{ ...baseItem, discount: 1001 }])).toThrow("Discount cannot exceed the line amount");
    expect(() => calculateInvoiceItems([{ ...baseItem, discount: 101, discountType: "PERCENTAGE" }])).toThrow("Percentage discount cannot exceed 100%");
  });

  it("requires a non-empty description and a positive price at the API boundary", () => {
    const validRequest = { patientId: "d9428888-f536-4b21-bb00-fd3c6d0438d8", items: [baseItem] };
    expect(createInvoiceSchema.safeParse(validRequest).success).toBe(true);
    expect(createInvoiceSchema.safeParse({ ...validRequest, items: [{ ...baseItem, description: "  " }] }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...validRequest, items: [{ ...baseItem, unitPrice: 0 }] }).success).toBe(false);
  });

  it("requires a non-blank reason when voiding an invoice", () => {
    expect(voidInvoiceSchema.safeParse({ reason: "Duplicate invoice" }).success).toBe(true);
    expect(voidInvoiceSchema.safeParse({ reason: "   " }).success).toBe(false);
  });
});
