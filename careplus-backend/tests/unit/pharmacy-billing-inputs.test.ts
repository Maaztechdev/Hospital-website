import { createMedicineSchema, pharmacySaleSchema, stockInSchema } from "../../src/modules/pharmacy/pharmacy.validators";

describe("pharmacy billing inputs", () => {
  const patientId = "79c0f44c-0bd6-4cd8-a73f-0f85e08a260b";

  it("accepts an optional medicine barcode", () => {
    expect(createMedicineSchema.safeParse({ name: "Paracetamol", barcode: "8901234567890" }).success).toBe(true);
    expect(createMedicineSchema.safeParse({ name: "Paracetamol", barcode: null }).success).toBe(true);
    expect(createMedicineSchema.safeParse({ name: "Paracetamol", barcode: "x".repeat(101) }).success).toBe(false);
  });

  it("validates initial batch metadata and both stock-in modes", () => {
    const medicine = createMedicineSchema.safeParse({
      name: "Paracetamol",
      unitType: "TABLET",
      manufacturer: "Manufacturer",
      initialBatch: { batchNumber: "B-01", expiryDate: "2027-12-31", purchasePrice: 12, sellingPrice: 18, stockQuantity: 5 },
    });
    const newBatch = stockInSchema.safeParse({
      medicineId: "79c0f44c-0bd6-4cd8-a73f-0f85e08a260c",
      batchNumber: "B-02",
      expiryDate: "2027-12-31",
      quantity: 3,
      purchasePrice: 10,
      sellingPrice: 16,
      invoiceReference: "SUP-001",
    });
    const existingBatch = stockInSchema.safeParse({ batchId: "79c0f44c-0bd6-4cd8-a73f-0f85e08a260c", quantity: 3 });

    expect(medicine.success).toBe(true);
    expect(newBatch.success).toBe(true);
    expect(existingBatch.success).toBe(true);
    expect(stockInSchema.safeParse({ quantity: 1 }).success).toBe(false);
  });

  it("accepts an existing patient link on a pharmacy sale", () => {
    const result = pharmacySaleSchema.safeParse({
      items: [{ medicineId: "79c0f44c-0bd6-4cd8-a73f-0f85e08a260c", quantity: 2, discount: 10 }],
      tax: 0,
      paymentMethod: "CASH",
      patientId,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.patientId).toBe(patientId);
  });

  it("rejects invalid patient IDs and invalid sale quantities", () => {
    const invalidPatient = pharmacySaleSchema.safeParse({
      items: [{ medicineId: "79c0f44c-0bd6-4cd8-a73f-0f85e08a260c", quantity: 1 }],
      tax: 0,
      paymentMethod: "CASH",
      patientId: "not-a-uuid",
    });
    const invalidQuantity = pharmacySaleSchema.safeParse({
      items: [{ medicineId: "79c0f44c-0bd6-4cd8-a73f-0f85e08a260c", quantity: 0 }],
      tax: 0,
      paymentMethod: "CASH",
    });

    expect(invalidPatient.success).toBe(false);
    expect(invalidQuantity.success).toBe(false);
  });
});
