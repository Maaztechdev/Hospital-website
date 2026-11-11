process.env.DATABASE_URL = "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public";
import { PrismaClient } from "../careplus-backend/node_modules/@prisma/client/default.js";
const prisma = new PrismaClient();
async function main() {
  const doc = await prisma.doctor.findUnique({
    where: { id: "3877cde8-700a-4854-836a-4da0c6626ece" },
    include: { user: true }
  });
  console.log("Doctor:", doc?.user.name, doc?.user.email);
  await prisma.$disconnect();
}
main();

