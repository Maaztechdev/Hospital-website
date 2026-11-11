import { PrismaClient } from "@prisma/client";
import { checkCnicDuplicates } from "./check-cnic-duplicates";

const prisma = new PrismaClient();

async function run() {
  console.log("1. Seeding test admin and duplicate CNIC patients into scratch database...");
  const admin = await prisma.user.create({
    data: {
      email: `admin-dup-${Date.now()}@careplus.local`,
      passwordHash: "dummyhash123",
      name: "Admin Duplicate Checker",
      role: "ADMIN",
    },
  });

  const duplicateCnicFormatted = "35201-1234567-1";
  const duplicateCnicUnformatted = "3520112345671";

  const p1 = await prisma.patient.create({
    data: {
      mrNumber: `MR-SCRATCH-1-${Date.now()}`,
      firstName: "Duplicate",
      lastName: "PatientA",
      gender: "MALE",
      phone: "03001111111",
      cnic: duplicateCnicFormatted,
      createdBy: admin.id,
    },
  });

  const p2 = await prisma.patient.create({
    data: {
      mrNumber: `MR-SCRATCH-2-${Date.now()}`,
      firstName: "Duplicate",
      lastName: "PatientB",
      gender: "FEMALE",
      phone: "03002222222",
      cnic: duplicateCnicUnformatted,
      createdBy: admin.id,
    },
  });

  console.log(`   Created Patient 1: MR=${p1.mrNumber}, CNIC=${p1.cnic}`);
  console.log(`   Created Patient 2: MR=${p2.mrNumber}, CNIC=${p2.cnic}`);

  console.log("\n2. Executing checkCnicDuplicates()...");
  const result = await checkCnicDuplicates();
  console.log("   Result hasDuplicates:", result.hasDuplicates);
  console.log("   Duplicates detected:", JSON.stringify(result.duplicates, null, 2));

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

