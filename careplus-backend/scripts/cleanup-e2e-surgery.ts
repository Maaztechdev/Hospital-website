import "../tests/setupEnv";
import { PrismaClient } from "@prisma/client";

const [surgeryId] = process.argv.slice(2);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  if (process.env.NODE_ENV !== "test" || !uuidPattern.test(surgeryId ?? "")) {
    throw new Error("Cleanup requires test mode and a valid surgery ID.");
  }
  const prisma = new PrismaClient();
  try {
    const surgery = await prisma.surgery.findFirst({ where: { id: surgeryId }, select: { id: true } });
    if (!surgery) throw new Error("The test-created surgery was not found.");
    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { relatedEntityType: "Surgery", relatedEntityId: surgeryId } }),
      prisma.auditLog.deleteMany({ where: { entityType: "Surgery", entityId: surgeryId } }),
      prisma.surgery.delete({ where: { id: surgeryId } }),
    ]);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
