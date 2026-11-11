process.env.DATABASE_URL = "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public";
import { PrismaClient } from "../careplus-backend/node_modules/@prisma/client/default.js";
const prisma = new PrismaClient();
async function main() {
  const appt = await prisma.appointment.findFirst({
    where: { patient: { mrNumber: "MR-2026-000063" } },
    include: { patient: true, doctor: true },
  });
  console.log("Appointment in careplus_test:", appt);
  await prisma.$disconnect();
}
main();

