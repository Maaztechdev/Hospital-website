import { PrismaClient } from "@prisma/client";
import { applyStaleAppointmentStatuses, listStaleAppointmentCandidates } from "../src/modules/appointments/staleAppointmentLifecycle";

const prisma = new PrismaClient();

async function main() {
  const shouldApply = process.argv.includes("--apply");
  const candidates = await listStaleAppointmentCandidates(prisma, new Date());

  if (candidates.length === 0) {
    console.log("No stale appointment rows found. No data was changed.");
    return;
  }

  console.log("Stale / review candidate appointments (read-only preview):");
  console.table(candidates.map((candidate) => ({
    id: candidate.id,
    patient: candidate.patientName,
    doctor: candidate.doctorName,
    date: candidate.appointmentDate,
    time: candidate.timeSlot,
    status: candidate.currentStatus,
    recommended: candidate.recommendedStatus,
    reason: candidate.reason,
  })));

  if (!shouldApply) {
    console.log("No data was modified. Re-run with --apply to update only the safe stale rows without linked billing/consultation history.");
    return;
  }

  const result = await applyStaleAppointmentStatuses(prisma, new Date());
  console.log(`Applied stale status updates: ${result.updated} row(s) changed; ${result.skipped} row(s) kept for review.`);
}

main()
  .catch((error) => {
    console.error("Unable to review stale appointments:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
