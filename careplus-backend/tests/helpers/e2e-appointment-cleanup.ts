import { PrismaClient } from "@prisma/client";

export async function cleanupLifecycleAppointment(appointmentId: string) {
  const databaseUrl = process.env.DATABASE_URL;
  const databaseName = databaseUrl ? new URL(databaseUrl).pathname.split("/").pop()?.split("?")[0] : undefined;
  if (!databaseName?.endsWith("_test")) {
    throw new Error("Refusing to clean up an appointment outside a dedicated test database");
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: { id: true, patientId: true, patient: { select: { firstName: true, lastName: true, phone: true } } },
      });
      if (!appointment) return;
      const { firstName, lastName, phone } = appointment.patient;
      if (firstName !== "Lifecycle" || !lastName.startsWith("E2E ") || !phone.startsWith("0300")) {
        throw new Error("Refusing to remove an appointment not owned by the appointment lifecycle E2E fixture");
      }

      await tx.auditLog.deleteMany({ where: { entityType: "Appointment", entityId: appointment.id } });
      await tx.notification.deleteMany({ where: { relatedEntityId: appointment.id } });
      await tx.appointment.delete({ where: { id: appointment.id } });
      const [patientCounts, pharmacyAccount] = await Promise.all([
        tx.patient.findUniqueOrThrow({
        where: { id: appointment.patientId },
        select: { _count: { select: {
          appointments: true,
          consultations: true,
          prescriptions: true,
          labOrders: true,
          labLedgerAccounts: true,
          ultrasoundOrders: true,
          ultrasoundReports: true,
          invoices: true,
          admissions: true,
          surgeries: true,
          ledgerEntries: true,
        } } },
        }),
        tx.pharmacyLedgerAccount.findUnique({
          where: { patientId: appointment.patientId },
          select: { id: true },
        }),
      ]);
      if (pharmacyAccount || Object.values(patientCounts._count).some((count) => count !== 0)) {
        throw new Error("Lifecycle E2E patient has other clinical records; refusing to delete it");
      }
      await tx.patient.delete({ where: { id: appointment.patientId } });
    });
  } finally {
    await prisma.$disconnect();
  }
}
