import { createPrescriptionSchema } from "../../src/modules/prescriptions/prescriptions.validators";
import { getMedicationAllergyMatches, prescriptionItemsSchema } from "../../src/common/validation/prescription";

const validPrescription = {
  consultationId: "123e4567-e89b-42d3-a456-426614174000",
  items: [{
    medicineId: "223e4567-e89b-42d3-a456-426614174000",
    isCatalogItem: true,
    medicineName: "Amoxicillin",
    doseAmount: 1,
    doseUnit: "capsule",
    route: "Oral",
    frequencyCode: "BD",
    durationValue: 5,
    durationUnit: "days",
  }],
};

describe("Prescription item validation", () => {
  it("accepts a complete structured medicine order", () => {
    expect(createPrescriptionSchema.safeParse(validPrescription).success).toBe(true);
  });

  it("validates persisted prescription items with nullable optional fields", () => {
    expect(prescriptionItemsSchema.safeParse([{
      ...validPrescription.items[0],
      instructions: null,
    }]).success).toBe(true);
    expect(prescriptionItemsSchema.safeParse([{
      ...validPrescription.items[0],
      medicineId: null,
      isCatalogItem: false,
      medicineName: "Clinician-entered medicine",
      instructions: null,
    }]).success).toBe(true);
  });

  it("rejects missing, invalid, or unstructured dose and frequency", () => {
    const missingDose = createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [{ ...validPrescription.items[0], doseAmount: undefined }],
    });
    expect(missingDose.success).toBe(false);
    if (!missingDose.success) expect(missingDose.error.issues[0].message).toBe("Dose is missing.");
    expect(createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [{ ...validPrescription.items[0], doseAmount: 0 }],
    }).success).toBe(false);
    expect(createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [{ ...validPrescription.items[0], frequencyCode: "twice daily" }],
    }).success).toBe(false);
    const missingDuration = createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [{ ...validPrescription.items[0], durationValue: undefined }],
    });
    expect(missingDuration.success).toBe(false);
    if (!missingDuration.success) expect(missingDuration.error.issues[0].message).toBe("Duration is missing.");
  });

  it("requires a catalog selection or the explicit Other choice", () => {
    expect(createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [{ ...validPrescription.items[0], medicineId: undefined, isCatalogItem: undefined, medicineName: "dsldkals" }],
    }).success).toBe(false);
    expect(createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [{ ...validPrescription.items[0], medicineId: undefined, isCatalogItem: false, medicineName: "Clinician-entered medicine" }],
    }).success).toBe(true);
    expect(createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [{ ...validPrescription.items[0], medicineId: undefined, isCatalogItem: true }],
    }).success).toBe(false);
  });

  it("shares row validation and reports missing duration and frequency specifically", () => {
    const result = prescriptionItemsSchema.safeParse([{
      ...validPrescription.items[0],
      durationValue: "",
      frequencyCode: undefined,
    }]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toEqual([
      "Frequency is missing.",
      "Duration is missing.",
    ]);
  });

  it("rejects duplicate medicines by linked id or normalized name", () => {
    expect(createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [validPrescription.items[0], { ...validPrescription.items[0], medicineName: " amoxicillin " }],
    }).success).toBe(false);
    expect(createPrescriptionSchema.safeParse({
      ...validPrescription,
      items: [
        { ...validPrescription.items[0], medicineId: "223e4567-e89b-42d3-a456-426614174000" },
        { ...validPrescription.items[0], medicineId: "223e4567-e89b-42d3-a456-426614174000", medicineName: "Different label" },
      ],
    }).success).toBe(false);
  });

  it("matches recorded allergies against medication names and common drug classes", () => {
    expect(getMedicationAllergyMatches(["Penicillin"], "Amoxicillin 500 mg")).toEqual(["Penicillin"]);
    expect(getMedicationAllergyMatches(["Penicillin"], "Augmentin 625 mg", "Amoxicillin + clavulanate")).toEqual(["Penicillin"]);
    expect(getMedicationAllergyMatches(["ibuprofen"], "Ibuprofen")).toEqual(["ibuprofen"]);
    expect(getMedicationAllergyMatches(["latex"], "Amoxicillin")).toEqual([]);
  });
});
