import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env.test"), override: true });

import { prisma } from "../src/config/prisma";

function assertTestDb() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbMatch = dbUrl.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbMatch ? dbMatch[1] : "";
  if (!dbName || !dbName.endsWith("_test")) {
    throw new Error(`CRITICAL SAFETY ABORT: Database "${dbName}" does not end with "_test"!`);
  }
}

async function main() {
  assertTestDb();
  const doctors = await prisma.doctor.findMany();
  for (const d of doctors) {
    const sched = ((d.scheduleJson as any) || {});
    sched.daysOff = [];
    const slots: string[] = [];
    for (let h = 8; h < 24; h++) {
      for (let m = 0; m < 60; m += 20) {
        slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    sched.slotsPerDay = slots;
    sched.workingHours = { start: "08:00", end: "23:59" };
    await prisma.doctor.update({ where: { id: d.id }, data: { scheduleJson: sched } });
  }
  console.log("Updated", doctors.length, "doctor schedules successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
