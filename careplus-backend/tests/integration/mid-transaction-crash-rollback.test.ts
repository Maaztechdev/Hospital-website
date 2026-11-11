import { prisma } from "../../src/config/prisma";
import { Prisma } from "@prisma/client";

describe("Mid-Operation Crash and Atomic Transaction Rollback (Item 8b)", () => {
  let adminUserId: string;

  beforeAll(async () => {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    expect(admin).toBeTruthy();
    adminUserId = admin!.id;
  });

  it("1. Mid-operation crash during Payment recording rolls back completely (no half-saved invoice/payment records)", async () => {
    const patient = await prisma.patient.findFirst({ where: { deletedAt: null } });
    expect(patient).toBeTruthy();

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-ROLLBACK-${Date.now()}`,
        patientId: patient!.id,
        department: "RECEPTION",
        status: "FINALIZED",
        subtotal: 5000,
        grandTotal: 5000,
        paidAmount: 0,
        balanceAmount: 5000,
        createdBy: adminUserId,
      },
    });

    const initialPaymentsCount = await prisma.payment.count({ where: { invoiceId: invoice.id } });
    expect(initialPaymentsCount).toBe(0);

    // Simulate mid-transaction crash after payment record is staged/created
    let transactionFailed = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Create payment
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: 2500,
            paymentMethod: "CASH",
            type: "PAYMENT",
            createdBy: adminUserId,
          },
        });

        // Step 2: Simulate sudden backend process crash / power loss / exception
        throw new Error("SIMULATED_BACKEND_CRASH_MID_PAYMENT");
      });
    } catch (err: any) {
      if (err.message === "SIMULATED_BACKEND_CRASH_MID_PAYMENT") {
        transactionFailed = true;
      }
    }

    expect(transactionFailed).toBe(true);

    // Verify atomic rollback: NO payment row exists, invoice balance untouched
    const afterPaymentsCount = await prisma.payment.count({ where: { invoiceId: invoice.id } });
    expect(afterPaymentsCount).toBe(0);

    const checkInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(Number(checkInvoice.paidAmount)).toBe(0);
    expect(Number(checkInvoice.balanceAmount)).toBe(5000);
  });

  it("2. Mid-operation crash during Pharmacy Dispense rolls back stock and prescription status", async () => {
    const medicine = await prisma.medicine.findFirst({
      where: { batches: { some: { stockQuantity: { gt: 10 } } } },
      include: { batches: true },
    });
    expect(medicine).toBeTruthy();
    const batch = medicine!.batches[0];
    const initialBatchQty = batch.stockQuantity;

    const patient = await prisma.patient.findFirst({ where: { deletedAt: null } });
    const doctor = await prisma.doctor.findFirst();
    expect(patient && doctor).toBeTruthy();

    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient!.id,
        doctorId: doctor!.id,
        appointmentType: "CONSULTATION",
        gender: "MALE",
        appointmentDate: new Date(),
        timeSlot: new Date(),
        tokenNumber: Math.floor(10000 + Math.random() * 80000),
        status: "CONFIRMED",
        source: "WALK_IN",
        createdBy: adminUserId,
      },
    });

    const consultation = await prisma.consultation.create({
      data: {
        appointmentId: appointment.id,
        patientId: patient!.id,
        doctorId: doctor!.id,
        prescriptionStatus: "SIGNED",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        patientId: patient!.id,
        doctorId: doctor!.id,
        consultationId: consultation.id,
        status: "SIGNED",
        items: {
          create: [
            {
              medicineId: medicine!.id,
              medicineName: medicine!.name,
              doseAmount: 1,
              doseUnit: "tablet",
              route: "oral",
              frequencyCode: "TID",
              durationValue: 3,
              durationUnit: "days",
              dosage: "1 tablet",
              frequency: "TID",
              durationDays: 3,
            },
          ],
        },
      },
    });

    // Simulate mid-dispense crash after batch stock deduction
    let transactionFailed = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Decrement stock
        await tx.medicineBatch.update({
          where: { id: batch.id },
          data: { stockQuantity: { decrement: 5 } },
        });

        // Step 2: Simulate crash before prescription status update and invoice generation
        throw new Error("SIMULATED_BACKEND_CRASH_MID_DISPENSE");
      });
    } catch (err: any) {
      if (err.message === "SIMULATED_BACKEND_CRASH_MID_DISPENSE") {
        transactionFailed = true;
      }
    }

    expect(transactionFailed).toBe(true);

    // Verify atomic rollback: Batch quantity NOT decremented, prescription still SIGNED
    const checkBatch = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(checkBatch.stockQuantity).toBe(initialBatchQty);

    const checkPrescription = await prisma.prescription.findUniqueOrThrow({ where: { id: prescription.id } });
    expect(checkPrescription.status).toBe("SIGNED");
  });

  it("3. Mid-operation crash during Ward Admission rolls back bed occupancy and admission record", async () => {
    const bed = await prisma.bed.findFirst({ where: { status: "AVAILABLE" } });
    expect(bed).toBeTruthy();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-CRASH-${suffix}`,
        firstName: "CrashTest",
        lastName: `Admit-${suffix}`,
        phone: `0312${Math.floor(1000000 + Math.random() * 9000000)}`,
        gender: "MALE",
        age: 40,
        creator: { connect: { id: adminUserId } },
      },
    });
    const doctor = await prisma.doctor.findFirst();
    expect(doctor).toBeTruthy();

    let transactionFailed = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Update bed to OCCUPIED
        await tx.bed.update({
          where: { id: bed!.id },
          data: { status: "OCCUPIED" },
        });

        // Step 2: Create admission
        await tx.admission.create({
          data: {
            patientId: patient.id,
            bedId: bed!.id,
            attendingDoctorId: doctor!.id,
            admissionDate: new Date(),
            status: "ACTIVE",
            admissionType: "EMERGENCY",
            admissionReason: "Simulated admission crash test",
            createdBy: adminUserId,
          },
        });

        // Step 3: Simulate crash before IPD invoice creation & audit log
        throw new Error("SIMULATED_BACKEND_CRASH_MID_ADMIT");
      });
    } catch (err: any) {
      if (err.message === "SIMULATED_BACKEND_CRASH_MID_ADMIT") {
        transactionFailed = true;
      }
    }

    expect(transactionFailed).toBe(true);

    // Verify atomic rollback: Bed remains AVAILABLE, no admission record was saved
    const checkBed = await prisma.bed.findUniqueOrThrow({ where: { id: bed!.id } });
    expect(checkBed.status).toBe("AVAILABLE");

    const checkAdmission = await prisma.admission.findFirst({ where: { patientId: patient.id } });
    expect(checkAdmission).toBeNull();
  });
});
