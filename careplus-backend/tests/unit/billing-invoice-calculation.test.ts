import { createInvoiceSchema, voidInvoiceSchema } from "../../src/modules/billing/billing.validators";
import { calculateInvoiceAmounts, calculateInvoiceItems } from "../../src/modules/billing/billing.service";
import { roundMoney } from "../../src/common/utils/money";

const baseItem = {
  itemType: "CONSULTATION",
  description: "Consultation",
  quantity: 1,
  unitPrice: 1000,
  discount: 0,
};

describe("invoice line validation and PKR calculations", () => {
  it("calculates percentage discounts with decimal PKR precision", () => {
    const [item] = calculateInvoiceItems([{ ...baseItem, discount: 10, discountType: "PERCENTAGE" }]);
    expect(item.discount.toNumber()).toBe(100);
    expect(item.subtotal.toNumber()).toBe(900);
  });

  it("preserves flat discounts as PKR amounts", () => {
    const [item] = calculateInvoiceItems([{ ...baseItem, discount: 10, discountType: "FLAT" }]);
    expect(item.discount.toNumber()).toBe(10);
    expect(item.subtotal.toNumber()).toBe(990);
  });

  it("rejects zero prices and discounts above the line amount", () => {
    expect(() => calculateInvoiceItems([{ ...baseItem, unitPrice: 0 }])).toThrow("Unit price must be greater than zero");
    expect(() => calculateInvoiceItems([{ ...baseItem, discount: 1001 }])).toThrow("Discount cannot exceed the line amount");
    expect(() => calculateInvoiceItems([{ ...baseItem, discount: 101, discountType: "PERCENTAGE" }])).toThrow("Percentage discount cannot exceed 100%");
  });

  it("requires a non-empty description and a positive price at the API boundary", () => {
    const validRequest = { patientId: "d9428888-f536-4b21-bb00-fd3c6d0438d8", department: "RECEPTION", items: [baseItem] };
    expect(createInvoiceSchema.safeParse(validRequest).success).toBe(true);
    expect(createInvoiceSchema.safeParse({ ...validRequest, items: [{ ...baseItem, description: "  " }] }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...validRequest, items: [{ ...baseItem, unitPrice: 0 }] }).success).toBe(false);
  });

  it("allows discounts equal to the subtotal and rejects discounts one paisa over", () => {
    const validRequest = {
      patientId: "d9428888-f536-4b21-bb00-fd3c6d0438d8",
      department: "RECEPTION",
      items: [{ ...baseItem, unitPrice: 100 }],
    };

    expect(createInvoiceSchema.safeParse({ ...validRequest, discountAmount: 100 }).success).toBe(true);
    const overDiscount = createInvoiceSchema.safeParse({ ...validRequest, discountAmount: 100.01 });
    expect(overDiscount.success).toBe(false);
    if (!overDiscount.success) {
      expect(overDiscount.error.issues).toContainEqual(expect.objectContaining({
        path: ["discountAmount"],
        message: "Total discounts cannot exceed invoice subtotal",
      }));
    }
  });

  it("rounds money consistently and calculates invoice totals with fractional prices", () => {
    expect(roundMoney("1.005").toString()).toBe("1.01");

    const items = calculateInvoiceItems([
      { ...baseItem, quantity: 3, unitPrice: 10.25, discount: 12.5, discountType: "PERCENTAGE" },
      { ...baseItem, quantity: 2, unitPrice: 2.35, discount: 0.15, discountType: "FLAT" },
    ]);
    const totals = calculateInvoiceAmounts(items);

    expect(items[0].subtotal.toString()).toBe("26.91");
    expect(items[1].subtotal.toString()).toBe("4.55");
    expect(totals.subtotal.toString()).toBe("35.45");
    expect(totals.discountAmount.toString()).toBe("3.99");
    expect(totals.grandTotal.toString()).toBe("31.46");
  });

  it("requires a non-blank reason when voiding an invoice", () => {
    expect(voidInvoiceSchema.safeParse({ reason: "Duplicate invoice" }).success).toBe(true);
    expect(voidInvoiceSchema.safeParse({ reason: "   " }).success).toBe(false);
  });
});
