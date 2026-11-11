process.env.DATABASE_URL = "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public";
import { PrismaClient } from "../careplus-backend/node_modules/@prisma/client/default.js";
const prisma = new PrismaClient();
async function main() {
  const appts = await prisma.appointment.findMany({
    where: { patient: { mrNumber: "MR-2026-000063" } },
    include: { patient: true, doctor: true },
    orderBy: { createdAt: "asc" }
  });
  console.log("Appointments for MR-2026-000063:", appts.map(a => ({
    id: a.id,
    token: a.tokenNumber,
    date: a.appointmentDate,
    time: a.timeSlot,
    status: a.status,
    doctorId: a.doctorId
  })));
  await prisma.$disconnect();
}
main();

