import {
  labInventoryAdjustmentSchema,
  labInventoryBatchSchema,
  labInventoryItemSchema,
  labInventoryMappingSchema,
} from "../../src/modules/lab/labInventory.validators";

describe("Lab inventory validation", () => {
  it("accepts fractional stock quantities and shared supplier IDs", () => {
    expect(labInventoryItemSchema.safeParse({
      name: "CBC reagent",
      category: "REAGENT",
      unit: "mL",
      reorderLevel: 20.5,
      supplierId: "3f6603ab-8a2f-470b-a2e3-5f1be2e6be85",
    }).success).toBe(true);
    expect(labInventoryBatchSchema.safeParse({
      itemId: "3f6603ab-8a2f-470b-a2e3-5f1be2e6be85",
      batchNumber: "R-100",
      expiryDate: "2027-12-31",
      quantity: 2.75,
      purchasePrice: 100,
    }).success).toBe(true);
  });

  it("rejects unsupported item types, negative quantities, and incomplete mappings", () => {
    expect(labInventoryItemSchema.safeParse({
      name: "Other",
      category: "MEDICINE",
      unit: "piece",
      reorderLevel: 0,
    }).success).toBe(false);
    expect(labInventoryBatchSchema.safeParse({
      itemId: "3f6603ab-8a2f-470b-a2e3-5f1be2e6be85",
      batchNumber: "R-100",
      expiryDate: "2027-12-31",
      quantity: 0,
      purchasePrice: 100,
    }).success).toBe(false);
    expect(labInventoryMappingSchema.safeParse({
      testId: "3f6603ab-8a2f-470b-a2e3-5f1be2e6be85",
      itemId: "3f6603ab-8a2f-470b-a2e3-5f1be2e6be85",
      quantityPerTestRun: 0,
    }).success).toBe(false);
  });

  it("requires an adjustment reason and non-zero stock change", () => {
    const batchId = "3f6603ab-8a2f-470b-a2e3-5f1be2e6be85";
    expect(labInventoryAdjustmentSchema.safeParse({ batchId, quantity: -1, reason: "Damaged reagent" }).success).toBe(true);
    expect(labInventoryAdjustmentSchema.safeParse({ batchId, quantity: 0, reason: "No change" }).success).toBe(false);
    expect(labInventoryAdjustmentSchema.safeParse({ batchId, quantity: -1, reason: " " }).success).toBe(false);
  });
});
