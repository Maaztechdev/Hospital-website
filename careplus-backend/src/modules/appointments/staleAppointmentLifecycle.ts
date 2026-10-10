import { AppointmentStatus, PrismaClient } from "@prisma/client";
import { prisma } from "@config/prisma";

const HOSPITAL_TIMEZONE = "Asia/Karachi";

type CandidateStatus = AppointmentStatus | "REVIEW";

export type StaleAppointmentCandidate = {
  id: string;
  patientName: string;
  doctorName: string;
  appointmentDate: string;
  timeSlot: string;
  currentStatus: AppointmentStatus;
  recommendedStatus: CandidateStatus;
  reason: string;
  hasConsultationHistory: boolean;
  hasBillingHistory: boolean;
};

function getHospitalDateKey(date: Date, timeZone = HOSPITAL_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function listStaleAppointmentCandidates(prismaClient: PrismaClient = prisma, now = new Date()) {
  const todayKey = getHospitalDateKey(now);
  const rows = await prismaClient.$queryRaw<Array<{
    id: string;
    patientName: string;
    doctorName: string;
    appointmentDate: string;
    timeSlot: string;
    status: AppointmentStatus;
    hasConsultationHistory: boolean;
    hasBillingHistory: boolean;
  }>>`
    SELECT
      a.id,
      concat_ws(' ', p.first_name, p.last_name) AS "patientName",
      u.name AS "doctorName",
      a.appointment_date::text AS "appointmentDate",
      left(a.time_slot::text, 5) AS "timeSlot",
      a.status,
      (c.id IS NOT NULL OR EXISTS (SELECT 1 FROM consultations pc WHERE pc.patient_id = p.id)) AS "hasConsultationHistory",
      EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id = p.id) AS "hasBillingHistory"
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN doctors d ON d.id = a.doctor_id
    JOIN users u ON u.id = d.user_id
    LEFT JOIN consultations c ON c.appointment_id = a.id
    WHERE a.appointment_date < ${todayKey}::date
      AND a.status IN ('PENDING_APPROVAL', 'CONFIRMED', 'WAITING', 'IN_CONSULTATION')
    ORDER BY a.appointment_date ASC, a.time_slot ASC
  `;

  const candidates: StaleAppointmentCandidate[] = rows.map((row) => {
    const { hasConsultationHistory, hasBillingHistory, patientName, doctorName } = row;

    if (hasConsultationHistory || hasBillingHistory) {
      return {
        id: row.id,
        patientName,
        doctorName,
        appointmentDate: row.appointmentDate,
        timeSlot: row.timeSlot,
        currentStatus: row.status,
        recommendedStatus: "REVIEW",
        reason: "Linked consultation or billing history detected; leaving unchanged for manual review.",
        hasConsultationHistory,
        hasBillingHistory,
      };
    }

    if (row.status === "PENDING_APPROVAL") {
      return {
        id: row.id,
        patientName,
        doctorName,
        appointmentDate: row.appointmentDate,
        timeSlot: row.timeSlot,
        currentStatus: row.status,
        recommendedStatus: "EXPIRED",
        reason: "Past appointment stayed pending approval beyond the booking date.",
        hasConsultationHistory: false,
        hasBillingHistory: false,
      };
    }

    if (row.status === "CONFIRMED" || row.status === "WAITING") {
      return {
        id: row.id,
        patientName,
        doctorName,
        appointmentDate: row.appointmentDate,
        timeSlot: row.timeSlot,
        currentStatus: row.status,
        recommendedStatus: "NO_SHOW",
        reason: "Past appointment was never completed and has no linked history.",
        hasConsultationHistory: false,
        hasBillingHistory: false,
      };
    }

    return {
      id: row.id,
      patientName,
      doctorName,
      appointmentDate: row.appointmentDate,
      timeSlot: row.timeSlot,
      currentStatus: row.status,
      recommendedStatus: "REVIEW",
      reason: "Past consultation without linked history needs human review before changing state.",
      hasConsultationHistory: false,
      hasBillingHistory: false,
    };
  });

  return candidates.filter((candidate) => candidate.recommendedStatus === "REVIEW" || candidate.recommendedStatus === "EXPIRED" || candidate.recommendedStatus === "NO_SHOW");
}

export async function applyStaleAppointmentStatuses(prismaClient: PrismaClient = prisma, now = new Date()) {
  const candidates = await listStaleAppointmentCandidates(prismaClient, now);
  const updates = candidates.filter((candidate) => candidate.recommendedStatus !== "REVIEW");

  for (const candidate of updates) {
    await prismaClient.appointment.update({
      where: { id: candidate.id },
      data: { status: candidate.recommendedStatus as AppointmentStatus },
    });
  }

  return {
    reviewed: candidates.length,
    updated: updates.length,
    skipped: candidates.length - updates.length,
  };
}
