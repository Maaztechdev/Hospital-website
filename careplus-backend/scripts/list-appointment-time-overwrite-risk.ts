import { PrismaClient } from "@prisma/client";
import { getWeekdayForDateKey } from "../src/modules/appointments/appointments.service";

const prisma = new PrismaClient();

type AppointmentRow = {
  id: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  appointmentDate: string;
  timeSlot: string;
  status: string;
};

async function main() {
  const appointments = await prisma.$queryRaw<AppointmentRow[]>`
    SELECT
      a.id,
      CONCAT(p.first_name, ' ', p.last_name) AS "patientName",
      d.id AS "doctorId",
      u.name AS "doctorName",
      a.appointment_date::date::text AS "appointmentDate",
      a.time_slot AS "timeSlot",
      a.status
    FROM appointments a
    LEFT JOIN patients p ON p.id = a.patient_id
    LEFT JOIN doctors d ON d.id = a.doctor_id
    LEFT JOIN users u ON u.id = d.user_id
    WHERE a.status IN ('IN_CONSULTATION', 'DONE')
    ORDER BY a.appointment_date ASC, a.time_slot ASC
  `;

  const doctors = await prisma.doctor.findMany({
    select: { id: true, scheduleJson: true, user: { select: { name: true } } },
  });

  const affected = [] as Array<{ id: string; patient: string; doctor: string; date: string; timeSlot: string; status: string; configured: boolean }>; 

  for (const appointment of appointments) {
    const doctorRecord = doctors.find((entry) => entry.id === appointment.doctorId);
    const doctorName = doctorRecord?.user.name ?? appointment.doctorName;
    const schedule = doctorRecord?.scheduleJson as { slotsPerDay?: string[]; slotsByDay?: Record<string, string[]>; daysOff?: string[] } | null;
    const dayName = getWeekdayForDateKey(appointment.appointmentDate);
    const configuredSlots = schedule?.slotsByDay?.[dayName] ?? schedule?.slotsPerDay ?? [];
    const isConfigured = configuredSlots.includes(appointment.timeSlot);

    if (!isConfigured) {
      affected.push({
        id: appointment.id,
        patient: appointment.patientName,
        doctor: doctorName,
        date: appointment.appointmentDate,
        timeSlot: appointment.timeSlot,
        status: appointment.status,
        configured: false,
      });
    }
  }

  if (affected.length === 0) {
    console.log("No affected appointments found. No data was changed.");
    return;
  }

  console.log("Affected appointments (read-only listing):");
  console.table(affected);
}

main()
  .catch((error) => {
    console.error("Unable to list affected appointments:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
