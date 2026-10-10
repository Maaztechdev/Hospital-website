import { assertDiscountLimit } from "../../src/modules/pharmacy/pharmacy.service";

describe("pharmacy discount approval policy", () => {
  it("allows discounts at or below the configured cashier maximum", () => {
    expect(() => assertDiscountLimit(10, 10, false)).not.toThrow();
    expect(() => assertDiscountLimit(7.5, 10, false)).not.toThrow();
  });

  it("rejects discounts above the configured maximum without admin approval", () => {
    expect(() => assertDiscountLimit(10.01, 10, false)).toThrow("requires Admin approval");
  });

  it("allows a discount above the configured maximum after Admin approval", () => {
    expect(() => assertDiscountLimit(25, 10, true)).not.toThrow();
  });
});
