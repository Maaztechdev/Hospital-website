import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { prisma } from "@config/prisma";
import { appointmentsService } from "@modules/appointments/appointments.service";
import { patientsService } from "@modules/patients/patients.service";
import argon2 from "argon2";

describe("OPD Fee Defaulting, Waiver, and Queue Activation Guard", () => {
  let doctor: any;
  let patient: any;
  let adminUser: any;
  let receptionistUser: any;
  let doctorUser: any;
  const testDate = "2030-05-06"; // Future Monday

  beforeAll(async () => {
    adminUser = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } });
    receptionistUser = await prisma.user.findFirst({ where: { role: "RECEPTIONIST", isActive: true } });

    const passwordHash = await argon2.hash("Doctor@12345");
    doctorUser = await prisma.user.create({
      data: {
        email: `opd-guard-doc-${Date.now()}@careplus.local`,
        name: "Dr. OPD Guard Test",
        passwordHash,
        role: "DOCTOR",
      },
    });

    const department = await prisma.department.findFirst();

    doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        departmentId: department!.id,
        specialization: "General Medicine",
        consultationFee: 1500,
        scheduleJson: {
          slotsByDay: {
            Monday: ["10:00", "10:20", "10:40", "11:00"],
          },
          slotsPerDay: ["10:00", "10:20", "10:40", "11:00"],
        },
      },
      include: { user: true },
    });

    patient = await patientsService.create(adminUser.id, {
      firstName: "OPD",
      lastName: "FeePatient",
      gender: "MALE",
      phone: `0300${Date.now().toString().slice(-7)}`,
      age: 30,
      force: true,
    });
  });

  afterAll(async () => {
    if (doctor?.id) {
      await prisma.appointment.deleteMany({ where: { doctorId: doctor.id } });
      await prisma.doctor.delete({ where: { id: doctor.id } });
    }
    if (doctorUser?.id) {
      await prisma.user.delete({ where: { id: doctorUser.id } });
    }
    if (patient?.id) {
      await prisma.invoiceItem.deleteMany({ where: { invoice: { patientId: patient.id } } });
      await prisma.payment.deleteMany({ where: { invoice: { patientId: patient.id } } });
      await prisma.invoice.deleteMany({ where: { patientId: patient.id } });
      await prisma.appointment.deleteMany({ where: { patientId: patient.id } });
      await prisma.patient.delete({ where: { id: patient.id } });
    }
  });

  it("1. Appointment creation generates an invoice by DEFAULT when payment fields are omitted", async () => {
    const actor = { sub: receptionistUser.id, role: receptionistUser.role };

    const appointment = await appointmentsService.create(
      actor as any,
      {
        patientId: patient.id,
        doctorId: doctor.id,
        appointmentDate: testDate,
        timeSlot: "10:00",
        appointmentType: "CONSULTATION",
        priority: "ROUTINE",
        source: "WALK_IN",
        notes: "Test appointment default invoice",
      }
    );

    expect(appointment).toBeDefined();

    const invoice = await prisma.invoice.findFirst({
      where: { appointmentId: appointment.id },
    });
    expect(invoice).toBeDefined();
    expect(Number(invoice?.grandTotal)).toBe(1500);
    expect(Number(invoice?.balanceAmount)).toBe(1500);
  });

  it("2. Queue activation via callNext fails if consultation fee is unpaid and not waived", async () => {
    // Attempting to call next patient whose fee is unpaid
    const doctorActor = { sub: doctorUser.id, role: "DOCTOR" };
    await expect(
      appointmentsService.callNext(doctorActor as any, doctor.id)
    ).rejects.toThrow(/unpaid/i);
  });

  it("3. Fee waiver requires authorized role and reason, writes audit log, and allows queue activation", async () => {
    const receptionistActor = { sub: receptionistUser.id, role: receptionistUser.role };
    const doctorActor = { sub: doctorUser.id, role: "DOCTOR" };

    const appointment = await prisma.appointment.findFirstOrThrow({
      where: { doctorId: doctor.id },
      orderBy: { tokenNumber: "asc" },
    });

    // Non-authorized user (Doctor) cannot waive fee
    await expect(
      appointmentsService.waiveFee(doctorActor as any, appointment.id, "Doctor waiver")
    ).rejects.toThrow(/administrator, receptionist, or billing manager/i);

    // Authorized receptionist waives fee with reason
    const waiverResult = await appointmentsService.waiveFee(
      receptionistActor as any,
      appointment.id,
      "Approved hospital welfare program waiver"
    );

    expect(waiverResult.invoice.status).toBe("PAID");
    expect(Number(waiverResult.invoice.balanceAmount)).toBe(0);

    // Check audit log entry
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        entityId: appointment.id,
        action: "UPDATE",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(auditLog).toBeDefined();
    expect(auditLog?.reason).toContain("FEE_WAIVED");

    // Queue activation now succeeds
    const called = await appointmentsService.callNext(doctorActor as any, doctor.id);
    expect(called).toBeDefined();
    expect(called?.status).toBe("WAITING");
  });
});
