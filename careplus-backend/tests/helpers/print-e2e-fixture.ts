import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/careplus_test?schema=public",
    },
  },
});

export async function createPrintE2EFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const admin = await prisma.user.findUnique({ where: { email: "admin@careplus.local" } });
  const doctorUser = await prisma.user.findUnique({ where: { email: "dr.ahmed@careplus.local" } });
  if (!admin || !doctorUser) throw new Error("Seeded admin and doctor users are required for print E2E fixtures");
  const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUser.id } });
  if (!doctor) throw new Error("The seeded doctor profile is required for print E2E fixtures");

  const patient = await prisma.patient.create({
    data: {
      mrNumber: `MR-PRINT-${suffix}`,
      firstName: "Print E2E",
      lastName: "Patient",
      age: 42,
      gender: "OTHER",
      phone: `0300${Date.now().toString().slice(-7)}`,
      allergies: ["Penicillin"],
      createdBy: admin.id,
      isTest: true,
    },
  });
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      departmentId: doctor.departmentId,
      appointmentDate: new Date(),
      timeSlot: new Date("1970-01-01T10:00:00.000Z"),
      tokenNumber: Number(Date.now().toString().slice(-8)),
      appointmentType: "CONSULTATION",
      status: "COMPLETED",
      source: "WALK_IN",
      createdBy: admin.id,
      isTest: true,
    },
  });
  const consultation = await prisma.consultation.create({
    data: {
      appointmentId: appointment.id,
      patientId: patient.id,
      doctorId: doctor.id,
      diagnosis: "Print E2E diagnosis",
      chiefComplaint: "Print E2E complaint",
      prescriptionStatus: "SIGNED",
    },
  });
  const prescription = await prisma.prescription.create({
    data: {
      consultationId: consultation.id,
      patientId: patient.id,
      doctorId: doctor.id,
      status: "SIGNED",
      signedAt: new Date(),
      items: {
        create: {
          medicineName: `Print E2E Medicine ${suffix}`,
          isCatalogItem: false,
          requiresPharmacistReview: true,
          dosage: "1 tablet",
          doseAmount: 1,
          doseUnit: "tablet",
          route: "Oral",
          frequency: "OD - once daily",
          frequencyCode: "OD",
          durationDays: 3,
          durationValue: 3,
          durationUnit: "days",
        },
      },
    },
  });
  const ward = await prisma.ward.create({ data: { wardName: `Print E2E ${suffix}`, wardType: "GENERAL", dailyRate: 5000, capacity: 1 } });
  const room = await prisma.room.create({ data: { wardId: ward.id, roomNumber: `PE-${suffix}` } });
  const bed = await prisma.bed.create({ data: { roomId: room.id, bedNumber: "P-1", dailyRate: 5000, status: "OCCUPIED" } });
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `PRINT-${suffix}`,
      patientId: patient.id,
      createdBy: admin.id,
      status: "UNPAID",
      grandTotal: 100,
      balanceAmount: 100,
    },
  });
  const admission = await prisma.admission.create({
    data: {
      patientId: patient.id,
      bedId: bed.id,
      attendingDoctorId: doctor.id,
      admissionType: "PLANNED",
      admissionReason: "Print document fixture",
      createdBy: admin.id,
    },
  });
  return {
    patientId: patient.id,
    patientName: `${patient.firstName} ${patient.lastName}`,
    admissionId: admission.id,
    appointmentId: appointment.id,
    consultationId: consultation.id,
    prescriptionId: prescription.id,
    medicineName: `Print E2E Medicine ${suffix}`,
    bedId: bed.id,
    roomId: room.id,
    wardId: ward.id,
    invoiceId: invoice.id,
  };
}

export async function deletePrintE2EFixture(fixture: Awaited<ReturnType<typeof createPrintE2EFixture>>) {
  await prisma.auditLog.deleteMany({ where: { entityId: fixture.admissionId } });
  await prisma.invoice.deleteMany({ where: { id: fixture.invoiceId } });
  await prisma.prescription.deleteMany({ where: { id: fixture.prescriptionId } });
  await prisma.consultation.deleteMany({ where: { id: fixture.consultationId } });
  await prisma.admission.deleteMany({ where: { id: fixture.admissionId } });
  await prisma.appointment.deleteMany({ where: { id: fixture.appointmentId } });
  await prisma.bed.deleteMany({ where: { id: fixture.bedId } });
  await prisma.room.deleteMany({ where: { id: fixture.roomId } });
  await prisma.ward.deleteMany({ where: { id: fixture.wardId } });
  await prisma.patient.deleteMany({ where: { id: fixture.patientId } });
}

export async function disconnectPrintE2EFixture() {
  await prisma.$disconnect();
}
