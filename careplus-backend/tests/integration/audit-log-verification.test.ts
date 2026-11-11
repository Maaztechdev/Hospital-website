import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/prisma";

const app = createApp();

describe("Audit Log Comprehensive Verification (Item 8c)", () => {
  let adminToken: string;
  let adminUserId: string;

  beforeAll(async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "admin@careplus.local",
      password: "Admin@12345",
    });
    expect(res.status).toBe(200);
    adminToken = res.body.data.accessToken;
    adminUserId = res.body.data.user.id;
  });

  it("1. Audit log exists for successful LOGIN", async () => {
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "LOGIN",
        userId: adminUserId,
        module: "auth",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit?.entityType).toBe("User");
  });

  it("2. Audit log exists for FAILED LOGIN", async () => {
    const failedEmail = "admin@careplus.local";
    const res = await request(app).post("/api/v1/auth/login").send({
      email: failedEmail,
      password: "WrongPassword999!",
    });
    expect(res.status).toBe(401);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "LOGIN_FAILED",
        module: "auth",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit?.reason).toBe("Incorrect password");
  });

  it("3. Audit log exists for CREATE, DELETE, and RESTORE (Patient)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // CREATE
    const createRes = await request(app)
      .post("/api/v1/patients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        firstName: "Audit",
        lastName: `Test-${suffix}`,
        phone: `0333${Math.floor(1000000 + Math.random() * 9000000)}`,
        gender: "FEMALE",
        age: 28,
      });
    expect(createRes.status).toBe(201);
    const patientId = createRes.body.data.id;

    const createAudit = await prisma.auditLog.findFirst({
      where: {
        action: "CREATE",
        module: "patients",
        entityId: patientId,
      },
    });
    expect(createAudit).toBeTruthy();

    // DELETE (soft delete)
    const deleteRes = await request(app)
      .delete(`/api/v1/patients/${patientId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);

    const deleteAudit = await prisma.auditLog.findFirst({
      where: {
        action: "DELETE",
        module: "patients",
        entityId: patientId,
      },
    });
    expect(deleteAudit).toBeTruthy();

    // RESTORE
    const restoreRes = await request(app)
      .post(`/api/v1/patients/${patientId}/restore`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(restoreRes.status).toBe(200);

    const restoreAudit = await prisma.auditLog.findFirst({
      where: {
        action: "RESTORE",
        module: "patients",
        entityId: patientId,
      },
    });
    expect(restoreAudit).toBeTruthy();
  });

  it("4. Audit log exists for FINALIZE and REFUND (Billing)", async () => {
    const patient = await prisma.patient.findFirst({ where: { deletedAt: null } });
    expect(patient).toBeTruthy();

    // Create & finalize invoice
    const invRes = await request(app)
      .post("/api/v1/billing/invoices")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient!.id,
        department: "RECEPTION",
        items: [
          {
            itemType: "CONSULTATION",
            description: "Consultation Audit Item",
            quantity: 1,
            unitPrice: 1000,
          },
        ],
      });
    if (invRes.status !== 201) console.error("INVOICE ERROR:", invRes.body);
    expect(invRes.status).toBe(201);
    const invoiceId = invRes.body.data.id;

    // Record payment
    const payRes = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        amount: 1000,
        paymentMethod: "CASH",
        notes: "Full payment for audit test",
      });
    expect(payRes.status).toBe(200);

    // Record refund
    const refundRes = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/refunds`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        amount: 500,
        paymentMethod: "CASH",
        reason: "Patient overcharged duplicate service",
      });
    expect(refundRes.status).toBe(200);

    const refundAudit = await prisma.auditLog.findFirst({
      where: {
        module: "billing",
        entityType: "Payment",
        reason: "Patient overcharged duplicate service",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(refundAudit).toBeTruthy();
  });

  it("5. Audit log exists for FEE WAIVER (Appointment)", async () => {
    const doctor = await prisma.doctor.findFirst({ where: { isAvailable: true } });
    const patient = await prisma.patient.findFirst({ where: { deletedAt: null } });
    expect(doctor && patient).toBeTruthy();

    const appt = await prisma.appointment.create({
      data: {
        patientId: patient!.id,
        doctorId: doctor!.id,
        appointmentType: "CONSULTATION",
        gender: "FEMALE",
        appointmentDate: new Date(),
        timeSlot: new Date(),
        tokenNumber: Math.floor(10000 + Math.random() * 80000),
        status: "CONFIRMED",
        source: "WALK_IN",
        createdBy: adminUserId,
      },
    });

    // Create an unpaid invoice for this appointment
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-AUDIT-${Date.now()}`,
        patientId: patient!.id,
        appointmentId: appt.id,
        department: "RECEPTION",
        status: "FINALIZED",
        subtotal: 1500,
        grandTotal: 1500,
        paidAmount: 0,
        balanceAmount: 1500,
        createdBy: adminUserId,
      },
    });

    // Waive fee
    const waiveRes = await request(app)
      .post(`/api/v1/appointments/${appt.id}/waive-fee`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        reason: "Hospital Board Authorized Charity Waiver",
      });
    expect(waiveRes.status).toBe(200);

    const waiverAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: "AppointmentFeeWaiver",
        entityId: appt.id,
      },
    });
    expect(waiverAudit).toBeTruthy();
    expect(waiverAudit?.reason).toContain("Hospital Board Authorized Charity Waiver");
  });

  it("6. Audit log exists for DISCHARGE OVERRIDE (Wards)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-DISCHARGE-${suffix}`,
        firstName: "Discharge",
        lastName: `Override-${suffix}`,
        phone: `0345${Math.floor(1000000 + Math.random() * 9000000)}`,
        gender: "MALE",
        age: 45,
        creator: { connect: { id: adminUserId } },
      },
    });
    const doctor = await prisma.doctor.findFirst();
    const bed = await prisma.bed.findFirst({ where: { status: "AVAILABLE" } });
    expect(patient && doctor && bed).toBeTruthy();

    // Create active admission
    const admission = await prisma.admission.create({
      data: {
        patientId: patient.id,
        bedId: bed!.id,
        attendingDoctorId: doctor!.id,
        admissionDate: new Date(),
        status: "ACTIVE",
        admissionType: "PLANNED",
        admissionReason: "Observation and monitoring",
        createdBy: adminUserId,
      },
    });

    // Create an unpaid invoice with dues
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-DISCHARGE-${Date.now()}`,
        patientId: patient!.id,
        admissionId: admission.id,
        department: "IPD",
        status: "FINALIZED",
        subtotal: 3000,
        grandTotal: 3000,
        paidAmount: 0,
        balanceAmount: 3000,
        createdBy: adminUserId,
      },
    });

    // Discharge with admin override
    const dischargeRes = await request(app)
      .post(`/api/v1/wards/admissions/${admission.id}/discharge`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        diagnosis: "Audit Discharge diagnosis",
        courseInHospital: "Patient treated and improved",
        instructions: "Follow-up in 1 week",
        conditionAtDischarge: "STABLE",
        confirmUnpaidBalance: true,
        overrideReason: "Admin emergency discharge override for indigent patient",
      });
    expect(dischargeRes.status).toBe(200);

    const dischargeAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: "Admission",
        entityId: admission.id,
        action: "DISCHARGE",
      },
    });
    expect(dischargeAudit).toBeTruthy();
    expect(dischargeAudit?.reason).toContain("OVERRIDE_UNPAID_DUES: Admin emergency discharge override for indigent patient");
  });
});
