import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

async function main() {
  console.log("=== CarePlus Backup & Restore Verification ===");

  const sourceDb = "careplus_test";
  const targetDb = "careplus_restore_verify_test";

  // Critical safety assertion
  if (!sourceDb.endsWith("_test") || !targetDb.endsWith("_test")) {
    throw new Error("ABORT: Both source and target databases must end with '_test' to guarantee safety.");
  }

  const baseConn = "postgresql://careplus:carepluspass123@localhost:5432";
  const sourcePgUrl = `${baseConn}/${sourceDb}`;
  const targetPgUrl = `${baseConn}/${targetDb}`;
  const sourcePrismaUrl = `${sourcePgUrl}?schema=public`;
  const targetPrismaUrl = `${targetPgUrl}?schema=public`;

  console.log(`1. Ensuring clean target database: ${targetDb}...`);
  execSync(`psql "${baseConn}/postgres" -c "DROP DATABASE IF EXISTS \\"${targetDb}\\";"`, { stdio: "inherit" });
  execSync(`psql "${baseConn}/postgres" -c "CREATE DATABASE \\"${targetDb}\\";"`, { stdio: "inherit" });

  const dumpFile = path.resolve(__dirname, "../../scratch/backup-verify-test.sql");
  fs.mkdirSync(path.dirname(dumpFile), { recursive: true });

  console.log(`2. Running pg_dump on ${sourceDb}...`);
  execSync(`pg_dump --format=plain --no-owner --no-privileges --clean --if-exists --file="${dumpFile}" "${sourcePgUrl}"`, {
    stdio: "inherit",
  });
  const dumpStats = fs.statSync(dumpFile);
  console.log(`   Dump created: ${(dumpStats.size / 1024).toFixed(1)} KB`);

  console.log(`3. Restoring into ${targetDb} via psql...`);
  execSync(`psql --set ON_ERROR_STOP=1 --single-transaction "${targetPgUrl}" --file="${dumpFile}"`, {
    stdio: "inherit",
  });

  console.log(`4. Verifying table row counts between ${sourceDb} and ${targetDb}...`);
  const sourcePrisma = new PrismaClient({ datasources: { db: { url: sourcePrismaUrl } } });
  const targetPrisma = new PrismaClient({ datasources: { db: { url: targetPrismaUrl } } });

  const tables = [
    { name: "User", countFn: (p: PrismaClient) => p.user.count() },
    { name: "Department", countFn: (p: PrismaClient) => p.department.count() },
    { name: "Patient", countFn: (p: PrismaClient) => p.patient.count() },
    { name: "Appointment", countFn: (p: PrismaClient) => p.appointment.count() },
    { name: "Consultation", countFn: (p: PrismaClient) => p.consultation.count() },
    { name: "Prescription", countFn: (p: PrismaClient) => p.prescription.count() },
    { name: "LabTest", countFn: (p: PrismaClient) => p.labTest.count() },
    { name: "Medicine", countFn: (p: PrismaClient) => p.medicine.count() },
    { name: "MedicineBatch", countFn: (p: PrismaClient) => p.medicineBatch.count() },
    { name: "Ward", countFn: (p: PrismaClient) => p.ward.count() },
  ];

  const results: Array<{ table: string; source: number; restored: number; match: boolean }> = [];

  for (const t of tables) {
    const sCount = await t.countFn(sourcePrisma);
    const tCount = await t.countFn(targetPrisma);
    results.push({
      table: t.name,
      source: sCount,
      restored: tCount,
      match: sCount === tCount,
    });
  }

  await sourcePrisma.$disconnect();
  await targetPrisma.$disconnect();

  console.table(results);

  const allMatch = results.every((r) => r.match);
  if (!allMatch) {
    throw new Error("Row count mismatch between source and restored database!");
  }
  console.log("✓ All table row counts match perfectly between source and restored database!");

  console.log(`5. Cleaning up temporary test database and dump file...`);
  fs.unlinkSync(dumpFile);
  execSync(`psql "${baseConn}/postgres" -c "DROP DATABASE IF EXISTS \\"${targetDb}\\";"`, { stdio: "inherit" });

  console.log(`✓ Backup & restore verification successfully PASSED.`);
}

main().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
