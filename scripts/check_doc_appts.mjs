process.env.DATABASE_URL = "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public";
import { PrismaClient } from "../careplus-backend/node_modules/@prisma/client/default.js";
const prisma = new PrismaClient();
async function main() {
  const doc = await prisma.user.findUnique({ where: { email: "dr.ahmed@careplus.local" }, include: { doctorProfile: true } });
  const docId = doc?.doctorProfile?.id;
  const count = await prisma.appointment.count({ where: { doctorId: docId } });
  console.log("Total appointments for Dr. Ahmed:", count);
  const future = await prisma.appointment.findMany({
    where: { doctorId: docId },
    select: { id: true, appointmentDate: true, tokenNumber: true, status: true, patient: { select: { mrNumber: true, firstName: true } } },
    orderBy: { appointmentDate: "desc" },
    take: 10
  });
  console.log("Recent/Future appointments:", future);
  await prisma.$disconnect();
}
main();
