import { PrismaClient } from "../careplus-backend/node_modules/@prisma/client/default.js";
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.$queryRawUnsafe("SHOW max_connections");
  console.log(rows);
  await prisma.$disconnect();
}
main();
