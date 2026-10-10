import { prisma } from "@config/prisma";
import { findDuplicateAppointmentTokens } from "@common/utils/sequenceGenerators";

async function main() {
  const duplicates = await findDuplicateAppointmentTokens(prisma);

  if (duplicates.length === 0) {
    console.log("No duplicate appointment tokens found.");
    return;
  }

  console.log(`Found ${duplicates.length} duplicate token groups.`);
  console.table(
    duplicates.map((item) => ({
      doctorId: item.doctorId,
      appointmentDate: item.appointmentDate,
      tokenNumber: item.tokenNumber,
      duplicateCount: item.duplicateCount,
    }))
  );
}

main().catch((error) => {
  console.error("Failed to inspect duplicate appointment tokens:", error);
  process.exitCode = 1;
});
