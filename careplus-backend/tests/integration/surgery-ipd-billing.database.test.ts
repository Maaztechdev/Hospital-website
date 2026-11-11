import crypto from "crypto";
import { Role } from "@prisma/client";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { otService } from "@modules/ot/ot.routes";
import { wardsService } from "@modules/wards/wards.service";
import { BadRequestError, ConflictError } from "@common/errors/AppError";
import { AccessTokenPayload } from "@common/middleware/authenticate";

describe("Integration: Surgery IPD Billing and Admission Linking", () => {
  let adminUser: { id: string; role: Role; email: string };
  let surgeonDoctor: { id: string };
  let patientA: { id: string };
  let patientB: { id: string };
  let otRoom: { id: string };
  let wardId: string;
  let roomId: string;
  let bed1Id: string;
  let bed2Id: string;
  let serviceCharge: { id: string };

  const actorAdmin: AccessTokenPayload = {
    sub: "",
    role: "ADMIN",
    email: "",
  };

  const checklist = {
    consent_form_confirmed: true,
    fasting_confirmed: true,
    blood_arranged: true,
    required_reports_reviewed: true,
    identity_verified: true,
    allergies_checked: true,
    pre_op_vitals_recorded: true,
  };

  function getEmergencyWindow(offsetSeconds = 120) {
    const start = new Date(Date.now() + offsetSeconds * 1000);
    const end = new Date(start.getTime() + 15 * 60_000);
    return {
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      priority: "EMERGENCY" as const,
      anesthesiaType: "GENERAL",
    };
  }

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/").filter(Boolean).pop()?.split("?")[0] !== "careplus_test") {
      throw new Error("Tests require the careplus_test database.");
    }

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    adminUser = admin;
    actorAdmin.sub = admin.id;
    actorAdmin.email = admin.email;

    const doctor = await prisma.doctor.findFirstOrThrow({ include: { user: true } });
    surgeonDoctor = doctor;

    const suffix = crypto.randomUUID().slice(0, 8);

    patientA = await prisma.patient.create({
      data: {
        mrNumber: `MR-SurgA-${suffix}`,
        firstName: "SurgeryA",
        lastName: "Patient",
        gender: "MALE",
        phone: `03${Math.floor(100000000 + Math.random() * 900000000).toString().slice(0, 9)}`,
        createdBy: admin.id,
      },
    });

    patientB = await prisma.patient.create({
      data: {
        mrNumber: `MR-SurgB-${suffix}`,
        firstName: "SurgeryB",
        lastName: "Patient",
        gender: "FEMALE",
        phone: `03${Math.floor(100000000 + Math.random() * 900000000).toString().slice(0, 9)}`,
        createdBy: admin.id,
      },
    });

    // OT room will be created in beforeEach per test

    const ward = await prisma.ward.create({
      data: { wardName: `OT Ward ${suffix}`, wardType: "GENERAL", dailyRate: 150, capacity: 5 },
    });
    wardId = ward.id;
    const room = await prisma.room.create({ data: { wardId: ward.id, roomNumber: `R-${suffix}` } });
    roomId = room.id;
    const b1 = await prisma.bed.create({ data: { roomId: room.id, bedNumber: "01", dailyRate: 150, status: "AVAILABLE" } });
    const b2 = await prisma.bed.create({ data: { roomId: room.id, bedNumber: "02", dailyRate: 150, status: "AVAILABLE" } });
    bed1Id = b1.id;
    bed2Id = b2.id;

    // Create an OT ServiceCharge
    const sc = await prisma.serviceCharge.create({
      data: {
        name: `Appendectomy Fee ${suffix}`,
        category: "OT",
        defaultPrice: 25000,
        isActive: true,
        createdBy: admin.id,
      },
    });
    serviceCharge = sc;
  });

  beforeEach(async () => {
    otRoom = await prisma.otRoom.create({
      data: {
        roomName: `OT-Test-${crypto.randomUUID().slice(0, 8)}`,
        isActive: true,
      },
    });
  });

  afterEach(async () => {
    try {
      if (otRoom) {
        const surgeries = await prisma.surgery.findMany({
          where: { otRoomId: otRoom.id },
          select: { id: true },
        });
        const ids = surgeries.map((s) => s.id);
        if (ids.length > 0) {
          await prisma.surgeryStatusEvent.deleteMany({ where: { surgeryId: { in: ids } } });
          await prisma.invoiceItem.deleteMany({ where: { sourceId: { in: ids } } });
          await prisma.surgery.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.otRoom.delete({ where: { id: otRoom.id } });
      }
    } catch {
      // Best-effort cleanup
    }
  });

  afterAll(async () => {
    try {
      const surgeries = await prisma.surgery.findMany({
        where: { patientId: { in: [patientA.id, patientB.id] } },
        select: { id: true },
      });
      const surgeryIds = surgeries.map((s) => s.id);
      await prisma.surgeryStatusEvent.deleteMany({ where: { surgeryId: { in: surgeryIds } } });
      await prisma.invoiceItem.deleteMany({ where: { sourceId: { in: surgeryIds } } });
      await prisma.surgery.deleteMany({ where: { id: { in: surgeryIds } } });

      const admissions = await prisma.admission.findMany({
        where: { patientId: { in: [patientA.id, patientB.id] } },
        select: { id: true },
      });
      const admissionIds = admissions.map((a) => a.id);
      const invoices = await prisma.invoice.findMany({ where: { admissionId: { in: admissionIds } }, select: { id: true } });
      const invoiceIds = invoices.map((i) => i.id);

      await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      await prisma.admission.deleteMany({ where: { id: { in: admissionIds } } });

      if (serviceCharge) await prisma.serviceCharge.delete({ where: { id: serviceCharge.id } });
      await prisma.bedRateHistory.deleteMany({ where: { bedId: { in: [bed1Id, bed2Id] } } });
      await prisma.bed.deleteMany({ where: { id: { in: [bed1Id, bed2Id] } } });
      await prisma.room.delete({ where: { id: roomId } });
      await prisma.ward.delete({ where: { id: wardId } });
      await prisma.patient.deleteMany({ where: { id: { in: [patientA.id, patientB.id] } } });
    } catch {
      // Best-effort cleanup
    }
    redis.disconnect();
  });

  it("rejects scheduling when admissionId belongs to a different patient", async () => {
    // Admit Patient B
    const admitB = await wardsService.admit(actorAdmin, {
      patientId: patientB.id,
      bedId: bed2Id,
      attendingDoctorId: surgeonDoctor.id,
      admissionType: "PLANNED",
      admissionReason: "Observation",
      dailyRate: 150,
      depositAmount: 0,
    });

    const window = getEmergencyWindow(120);

    // Schedule surgery for Patient A but provide Patient B's admission
    await expect(
      otService.schedule(actorAdmin, {
        ...window,
        patientId: patientA.id,
        otRoomId: otRoom.id,
        surgeonId: surgeonDoctor.id,
        surgeryType: "Hernia Repair",
        admissionId: admitB.id,
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it("links active admission automatically and posts OT charge exactly once upon completion", async () => {
    // Admit Patient A
    const admissionA = await wardsService.admit(actorAdmin, {
      patientId: patientA.id,
      bedId: bed1Id,
      attendingDoctorId: surgeonDoctor.id,
      admissionType: "PLANNED",
      admissionReason: "Acute Appendicitis",
      dailyRate: 0,
      depositAmount: 0,
    });

    const ipdInvoiceBefore = await prisma.invoice.findUniqueOrThrow({
      where: { admissionId: admissionA.id },
      include: { items: true },
    });
    expect(Number(ipdInvoiceBefore.grandTotal)).toBe(0);

    const window = getEmergencyWindow(120);

    // Schedule without explicit admissionId -> should auto-link Patient A's active admission
    const scheduled = await otService.schedule(actorAdmin, {
      ...window,
      patientId: patientA.id,
      otRoomId: otRoom.id,
      surgeonId: surgeonDoctor.id,
      surgeryType: "Appendectomy",
    });
    expect(scheduled.admissionId).toBe(admissionA.id);

    // Progress through states
    await otService.updateChecklist(actorAdmin, scheduled.id, checklist);
    await otService.markPreOp(actorAdmin, scheduled.id);
    await otService.start(actorAdmin, scheduled.id, {});
    await otService.moveToRecovery(actorAdmin, scheduled.id, {
      intraoperativeNotes: "Appendix excised cleanly.",
      outcomeNotes: "Stable.",
    });

    // Complete the surgery with custom charge amount 30000
    const completed = await otService.complete(actorAdmin, scheduled.id, {
      postOpNotes: "Patient recovering well in recovery ward.",
      chargeAmount: 30000,
    });
    expect(completed.status).toBe("COMPLETED");

    // Verify InvoiceItem posted to IPD invoice
    const ipdInvoiceAfter = await prisma.invoice.findUniqueOrThrow({
      where: { admissionId: admissionA.id },
      include: { items: true },
    });
    const otLine = ipdInvoiceAfter.items.find((item) => item.itemType === "OT" && item.sourceId === scheduled.id);
    expect(otLine).toBeDefined();
    expect(Number(otLine?.unitPrice)).toBe(30000);
    expect(Number(otLine?.subtotal)).toBe(30000);
    expect(otLine?.sourceType).toBe("SURGERY");
    expect(otLine?.sourceDepartment).toBe("IPD");
    expect(otLine?.serviceCategory).toBe("SERVICES");
    expect(Number(ipdInvoiceAfter.grandTotal)).toBe(30000);
    expect(Number(ipdInvoiceAfter.balanceAmount)).toBe(30000);

    // Verify otCharge is attached on surgery query
    const fetchedSurgery = await otService.getById(actorAdmin, scheduled.id);
    expect((fetchedSurgery as any).otCharge).toBe(30000);

    // Idempotency check: completing twice or retry must not duplicate charge
    const secondCompletion = await otService.complete(actorAdmin, scheduled.id, {
      postOpNotes: "Second attempt",
      chargeAmount: 30000,
    });
    expect(secondCompletion.status).toBe("COMPLETED");

    const ipdInvoiceAfterRetry = await prisma.invoice.findUniqueOrThrow({
      where: { admissionId: admissionA.id },
      include: { items: true },
    });
    const otLines = ipdInvoiceAfterRetry.items.filter((item) => item.itemType === "OT" && item.sourceId === scheduled.id);
    expect(otLines.length).toBe(1);
    expect(Number(ipdInvoiceAfterRetry.grandTotal)).toBe(30000);
  });

  it("does not post any charge when completing outpatient surgery with no admission", async () => {
    const window = getEmergencyWindow(120);

    // Create a new patient specifically without any admission
    const outPatient = await prisma.patient.create({
      data: {
        mrNumber: `MR-DaySurg-${crypto.randomUUID().slice(0, 8)}`,
        firstName: "Day",
        lastName: "Case",
        gender: "MALE",
        phone: `03${Math.floor(100000000 + Math.random() * 900000000).toString().slice(0, 9)}`,
        createdBy: adminUser.id,
      },
    });

    const daySurgery = await otService.schedule(actorAdmin, {
      ...window,
      patientId: outPatient.id,
      otRoomId: otRoom.id,
      surgeonId: surgeonDoctor.id,
      surgeryType: "Minor Cyst Excision",
    });
    expect(daySurgery.admissionId).toBeNull();

    await otService.updateChecklist(actorAdmin, daySurgery.id, checklist);
    await otService.markPreOp(actorAdmin, daySurgery.id);
    await otService.start(actorAdmin, daySurgery.id, {});
    await otService.moveToRecovery(actorAdmin, daySurgery.id, {
      intraoperativeNotes: "Excised.",
      outcomeNotes: "Satisfactory.",
    });
    const dayCompleted = await otService.complete(actorAdmin, daySurgery.id, {
      postOpNotes: "Discharged same day.",
      chargeAmount: 10000,
    });
    expect(dayCompleted.status).toBe("COMPLETED");

    // Verify no invoice items were created
    const postedItem = await prisma.invoiceItem.findFirst({
      where: { sourceId: daySurgery.id },
    });
    expect(postedItem).toBeNull();

    // Cleanup day patient
    await prisma.surgeryStatusEvent.deleteMany({ where: { surgeryId: daySurgery.id } });
    await prisma.surgery.delete({ where: { id: daySurgery.id } });
    await prisma.patient.delete({ where: { id: outPatient.id } });
  });

  it("reverses posted OT charge if surgery is subsequently cancelled", async () => {
    const admissionA = await prisma.admission.findFirstOrThrow({
      where: { patientId: patientA.id, status: "ACTIVE" },
    });

    const window = getEmergencyWindow(120);

    const surg = await otService.schedule(actorAdmin, {
      ...window,
      patientId: patientA.id,
      otRoomId: otRoom.id,
      surgeonId: surgeonDoctor.id,
      surgeryType: "Exploratory Laparotomy",
      admissionId: admissionA.id,
    });

    await otService.updateChecklist(actorAdmin, surg.id, checklist);
    await otService.markPreOp(actorAdmin, surg.id);
    await otService.start(actorAdmin, surg.id, {});
    await otService.moveToRecovery(actorAdmin, surg.id, { intraoperativeNotes: "Complete.", outcomeNotes: "Fine." });
    await otService.complete(actorAdmin, surg.id, { postOpNotes: "Done.", chargeAmount: 15000 });

    const invoiceWithCharge = await prisma.invoice.findUniqueOrThrow({
      where: { admissionId: admissionA.id },
      include: { items: true },
    });
    const chargeItem = invoiceWithCharge.items.find((i) => i.sourceId === surg.id && !i.reversedAt);
    expect(chargeItem).toBeDefined();
    const balanceBeforeCancel = Number(invoiceWithCharge.balanceAmount);

    // Now cancel the surgery with reason
    await otService.cancel(actorAdmin, surg.id, "Emergency case entered or postoperative cancellation");

    const invoiceAfterCancel = await prisma.invoice.findUniqueOrThrow({
      where: { admissionId: admissionA.id },
      include: { items: true },
    });
    // Check that original charge item is marked reversed
    const updatedChargeItem = invoiceAfterCancel.items.find((i) => i.id === chargeItem!.id);
    expect(updatedChargeItem?.reversedAt).not.toBeNull();
    // Check credit line exists
    const creditItem = invoiceAfterCancel.items.find((i) => i.sourceType === "IPD_CREDIT" && Number(i.subtotal) < 0);
    expect(creditItem).toBeDefined();
    expect(Number(creditItem?.subtotal)).toBe(-15000);
    expect(Number(invoiceAfterCancel.balanceAmount)).toBe(balanceBeforeCancel - 15000);
  });

  it("rejects completion charge posting if IPD invoice is already finalized / closed", async () => {
    const admissionA = await prisma.admission.findFirstOrThrow({
      where: { patientId: patientA.id, status: "ACTIVE" },
    });

    const window = getEmergencyWindow(120);

    const surg = await otService.schedule(actorAdmin, {
      ...window,
      patientId: patientA.id,
      otRoomId: otRoom.id,
      surgeonId: surgeonDoctor.id,
      surgeryType: "Wound Debridement",
      admissionId: admissionA.id,
    });

    await otService.updateChecklist(actorAdmin, surg.id, checklist);
    await otService.markPreOp(actorAdmin, surg.id);
    await otService.start(actorAdmin, surg.id, {});
    await otService.moveToRecovery(actorAdmin, surg.id, { intraoperativeNotes: "Cleaned.", outcomeNotes: "Good." });

    // Finalize the IPD invoice
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { admissionId: admissionA.id } });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "FINALIZED" },
    });

    // Attempting to complete with OT charge must fail with ConflictError
    await expect(
      otService.complete(actorAdmin, surg.id, { postOpNotes: "Done.", chargeAmount: 5000 }),
    ).rejects.toThrow(ConflictError);

    // Revert status back to UNPAID for clean teardown
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "UNPAID" },
    });
  });
});
