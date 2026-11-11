import { describe, it, expect, beforeAll } from "@jest/globals";
import { prisma } from "@config/prisma";
import { wardsService } from "@modules/wards/wards.service";

describe("Discharge with Unpaid Dues Override & Audit Log", () => {
  let admin: any;
  let nurse: any;
  let doctor: any;
  let patient: any;
  let bed: any;
  let admission: any;

  beforeAll(async () => {
    admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } });
    nurse = await prisma.user.findFirst({ where: { role: "NURSE", isActive: true } });
    doctor = await prisma.doctor.findFirst({ include: { user: true } });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-DISC-${suffix}`,
        firstName: "Discharge",
        lastName: `Override-${suffix}`,
        phone: `0345${Math.floor(1000000 + Math.random() * 9000000)}`,
        gender: "MALE",
        age: 38,
        creator: { connect: { id: admin.id } },
      },
    });

    // Find or create an available bed
    bed = await prisma.bed.findFirst({ where: { status: "AVAILABLE" } });
    if (!bed) {
      const ward = await prisma.ward.findFirst();
      const room = await prisma.room.findFirst({ where: { wardId: ward!.id } });
      bed = await prisma.bed.create({
        data: {
          bedNumber: `BED-TEST-${Date.now()}`,
          roomId: room!.id,
          dailyRate: 1000,
          status: "AVAILABLE",
        },
      });
    }

    // Create an admission via wardsService.admit
    admission = await wardsService.admit(
      { sub: admin.id, role: admin.role } as any,
      {
        patientId: patient.id,
        bedId: bed.id,
        attendingDoctorId: doctor.id,
        admissionType: "EMERGENCY",
        admissionReason: "Acute condition for discharge test",
      }
    );

    // Create an unpaid invoice for this patient so outstandingBalance > 0
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-UNPAID-${Date.now()}`,
        patientId: patient.id,
        createdBy: admin.id,
        department: "IPD",
        status: "UNPAID",
        subtotal: 5000,
        grandTotal: 5000,
        paidAmount: 0,
        balanceAmount: 5000,
      },
    });
  });

  it("1. Nurse or Doctor cannot override discharge when unpaid balance remains (403 Forbidden)", async () => {
    const nurseActor = { sub: nurse.id, role: "NURSE" };
    await expect(
      wardsService.discharge(
        nurseActor as any,
        admission.id,
        {
          diagnosis: "Improved",
          courseInHospital: "Treated",
          medications: ["Paracetamol"],
          conditionAtDischarge: "Stable",
          referral: "None",
          instructions: "Rest",
          confirmUnpaidBalance: true,
          overrideReason: "Nurse attempting override",
        } as any
      )
    ).rejects.toThrow(/Only an administrator can override/i);
  });

  it("2. Admin requires confirmUnpaidBalance and overrideReason to discharge with unpaid balance", async () => {
    const adminActor = { sub: admin.id, role: "ADMIN" };

    // Without confirmUnpaidBalance
    await expect(
      wardsService.discharge(
        adminActor as any,
        admission.id,
        {
          diagnosis: "Improved",
          courseInHospital: "Treated",
          medications: ["Paracetamol"],
          conditionAtDischarge: "Stable",
          referral: "None",
          instructions: "Rest",
          confirmUnpaidBalance: false,
          overrideReason: "Valid admin override reason",
        } as any
      )
    ).rejects.toThrow(/unpaid balance remains/i);

    // Without overrideReason
    await expect(
      wardsService.discharge(
        adminActor as any,
        admission.id,
        {
          diagnosis: "Improved",
          courseInHospital: "Treated",
          medications: ["Paracetamol"],
          conditionAtDischarge: "Stable",
          referral: "None",
          instructions: "Rest",
          confirmUnpaidBalance: true,
          overrideReason: "",
        } as any
      )
    ).rejects.toThrow(/override reason is mandatory/i);
  });

  it("3. Admin with valid override reason succeeds and writes audit log", async () => {
    const adminActor = { sub: admin.id, role: "ADMIN" };
    const reasonText = "Indigent patient approved for waiver by hospital board";

    const discharged = await wardsService.discharge(
      adminActor as any,
      admission.id,
      {
        diagnosis: "Fully Recovered",
        courseInHospital: "Antibiotic regimen completed",
        medications: ["Amoxicillin 500mg"],
        conditionAtDischarge: "Healthy",
        referral: "None",
        instructions: "Follow-up in 1 week",
        confirmUnpaidBalance: true,
        overrideReason: reasonText,
      } as any
    );

    expect(discharged.status).toBe("DISCHARGED");

    // Check audit log
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        entityId: admission.id,
        action: "DISCHARGE",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(auditLog).toBeDefined();
    expect(auditLog?.reason).toContain("OVERRIDE_UNPAID_DUES:");
    expect(auditLog?.reason).toContain(reasonText);
    expect((auditLog?.newValuesJson as any)?.outstandingBalance).toBeGreaterThan(0);
  });
});
