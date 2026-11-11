import { describe, it, expect, beforeAll } from "@jest/globals";
import { prisma } from "@config/prisma";
import { pharmacyService } from "@modules/pharmacy/pharmacy.service";

describe("Pharmacy Partial Dispense, Zero-Qty Lines, and Negative Qty Rejection", () => {
  let pharmacist: any;
  let patient: any;
  let doctor: any;
  let med1: any;
  let med2: any;
  let batch1: any;
  let batch2: any;
  let prescription: any;

  beforeAll(async () => {
    pharmacist = await prisma.user.findFirst({ where: { role: "PHARMACIST", isActive: true } });
    if (!pharmacist) {
      pharmacist = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } });
    }
    doctor = await prisma.doctor.findFirst({ include: { user: true } });
    patient = await prisma.patient.findFirst({ where: { deletedAt: null } });

    // Find or create test medicines with stock
    med1 = await prisma.medicine.findFirst({ where: { isActive: true } });
    if (!med1) {
      med1 = await prisma.medicine.create({
        data: { name: "Paracetamol 500mg", genericName: "Paracetamol", unitType: "TABLET" },
      });
    }

    med2 = await prisma.medicine.findFirst({ where: { id: { not: med1.id }, isActive: true } });
    if (!med2) {
      med2 = await prisma.medicine.create({
        data: { name: "Amoxicillin 250mg", genericName: "Amoxicillin", unitType: "CAPSULE" },
      });
    }

    // Ensure batches exist with ample stock
    batch1 = await prisma.medicineBatch.findFirst({
      where: { medicineId: med1.id, stockQuantity: { gte: 50 }, isActive: true },
    });
    if (!batch1) {
      batch1 = await prisma.medicineBatch.create({
        data: {
          medicineId: med1.id,
          batchNumber: `BATCH-TEST-1-${Date.now()}`,
          stockQuantity: 100,
          purchasePrice: 10,
          sellingPrice: 15,
          expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        },
      });
    }

    batch2 = await prisma.medicineBatch.findFirst({
      where: { medicineId: med2.id, stockQuantity: { gte: 50 }, isActive: true },
    });
    if (!batch2) {
      batch2 = await prisma.medicineBatch.create({
        data: {
          medicineId: med2.id,
          batchNumber: `BATCH-TEST-2-${Date.now()}`,
          stockQuantity: 100,
          purchasePrice: 20,
          sellingPrice: 30,
          expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        },
      });
    }

    // Create a prescription with two catalog medicines (10 units each via durationDays)
    prescription = await prisma.prescription.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        status: "SIGNED",
        signedAt: new Date(),
        items: {
          create: [
            {
              medicineId: med1.id,
              medicineName: med1.name,
              dosage: "1 tab daily",
              route: "Oral",
              frequency: "OD",
              durationDays: 10,
              quantityDispensed: 0,
              isCatalogItem: true,
            },
            {
              medicineId: med2.id,
              medicineName: med2.name,
              dosage: "1 cap twice daily",
              route: "Oral",
              frequency: "BD",
              durationDays: 10,
              quantityDispensed: 0,
              isCatalogItem: true,
            },
          ],
        },
      },
      include: { items: true },
    });
  });

  it("1. Rejects negative quantities with BadRequestError", async () => {
    const actor = { sub: pharmacist.id, role: pharmacist.role };
    await expect(
      pharmacyService.dispensePrescription(actor as any, prescription.id, {
        items: [
          { prescriptionItemId: prescription.items[0].id, quantity: -2 },
        ],
      })
    ).rejects.toThrow(/negative/i);
  });

  it("2. Partial dispense: dispensing item 1 (quantity 5) and item 2 (quantity 0)", async () => {
    const actor = { sub: pharmacist.id, role: pharmacist.role };
    const stock1Before = (await prisma.medicineBatch.findUnique({ where: { id: batch1.id } }))!.stockQuantity;
    const stock2Before = (await prisma.medicineBatch.findUnique({ where: { id: batch2.id } }))!.stockQuantity;

    const result = await pharmacyService.dispensePrescription(actor as any, prescription.id, {
      items: [
        { prescriptionItemId: prescription.items[0].id, quantity: 5 },
        { prescriptionItemId: prescription.items[1].id, quantity: 0 },
      ],
    });

    expect(result.prescription.status).toBe("PARTIALLY_DISPENSED");

    // Verify stock deduction: only item 1 had stock deducted (5 units); item 2 had 0 deducted
    const stock1After = (await prisma.medicineBatch.findUnique({ where: { id: batch1.id } }))!.stockQuantity;
    const stock2After = (await prisma.medicineBatch.findUnique({ where: { id: batch2.id } }))!.stockQuantity;
    expect(stock1Before - stock1After).toBe(5);
    expect(stock2Before - stock2After).toBe(0);

    // Verify invoice items: zero-qty line does NOT appear on invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id: result.sale.invoiceId },
      include: { items: true },
    });
    expect(invoice?.items).toHaveLength(1);
    expect(invoice?.items[0].quantity).toBe(5);
  });

  it("3. Dispensing remaining quantities completes prescription to DISPENSED", async () => {
    const actor = { sub: pharmacist.id, role: pharmacist.role };

    // Item 1 has 5 remaining, Item 2 has 10 remaining
    const result = await pharmacyService.dispensePrescription(actor as any, prescription.id, {
      items: [
        { prescriptionItemId: prescription.items[0].id, quantity: 5 },
        { prescriptionItemId: prescription.items[1].id, quantity: 10 },
      ],
    });

    expect(result.prescription.status).toBe("DISPENSED");

    const refreshedPrescription = await prisma.prescription.findUnique({
      where: { id: prescription.id },
      include: { items: true },
    });
    expect(refreshedPrescription?.status).toBe("DISPENSED");
    expect(refreshedPrescription?.items.find((i) => i.id === prescription.items[0].id)?.quantityDispensed).toBe(10);
    expect(refreshedPrescription?.items.find((i) => i.id === prescription.items[1].id)?.quantityDispensed).toBe(10);
  });
});
