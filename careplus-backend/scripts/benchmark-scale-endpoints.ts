import { prisma } from "../src/config/prisma";
import { performance } from "perf_hooks";

function assertTestDb() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbMatch = dbUrl.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbMatch ? dbMatch[1] : "";
  if (!dbName || !dbName.endsWith("_test")) {
    throw new Error(`CRITICAL SAFETY ABORT: Database "${dbName}" does not end with "_test"!`);
  }
}

async function runBenchmark() {
  assertTestDb();
  console.log("=== PERFORMANCE & SCALE BENCHMARK (Item 8a) ===");
  console.log("Target database:", process.env.DATABASE_URL?.split("@")[1]);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("Admin user not found");
  const doctor = await prisma.doctor.findFirst();
  if (!doctor) throw new Error("Doctor not found");

  const BENCHMARK_PREFIX = "PERF_BENCH_";
  const PATIENT_COUNT = 5000;
  const APPOINTMENT_COUNT = 20000;

  console.log(`\n1. Seeding ${PATIENT_COUNT} patients...`);
  const patientStartTime = performance.now();

  const patientsData = [];
  const now = new Date();
  for (let i = 1; i <= PATIENT_COUNT; i++) {
    patientsData.push({
      mrNumber: `${BENCHMARK_PREFIX}MR_${String(i).padStart(6, "0")}`,
      firstName: `${BENCHMARK_PREFIX}Patient`,
      lastName: `Benchmark_${i}`,
      phone: `0300${String(1000000 + (i % 8999999))}`,
      gender: i % 2 === 0 ? ("MALE" as const) : ("FEMALE" as const),
      age: 20 + (i % 60),
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Batch insert in chunks of 1000
  for (let c = 0; c < PATIENT_COUNT; c += 1000) {
    await prisma.patient.createMany({
      data: patientsData.slice(c, c + 1000),
      skipDuplicates: true,
    });
  }
  const patientSeedTime = (performance.now() - patientStartTime) / 1000;
  console.log(`   Seeded ${PATIENT_COUNT} patients in ${patientSeedTime.toFixed(2)}s`);

  // Fetch sample patient IDs for appointment generation
  const seededPatients = await prisma.patient.findMany({
    where: { mrNumber: { startsWith: BENCHMARK_PREFIX } },
    select: { id: true },
    take: 1000,
  });
  console.log(`   Fetched ${seededPatients.length} patient references for appointments.`);

  console.log(`\n2. Seeding ${APPOINTMENT_COUNT} appointments...`);
  const apptStartTime = performance.now();
  const appointmentsData = [];
  const baseDate = new Date();
  const statuses = ["CONFIRMED", "WAITING", "IN_CONSULTATION", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

  for (let i = 1; i <= APPOINTMENT_COUNT; i++) {
    const patientRef = seededPatients[i % seededPatients.length];
    const dayOffset = (i % 60) - 30; // 30 days past to 30 days future
    const apptDate = new Date(baseDate.getTime() + dayOffset * 86400000);
    const hour = 9 + (i % 8);
    const minute = (i % 4) * 15;
    const timeSlotStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const timeSlotDate = new Date(`1970-01-01T${timeSlotStr}:00.000Z`);

    appointmentsData.push({
      patientId: patientRef.id,
      doctorId: doctor.id,
      appointmentType: "CONSULTATION" as const,
      gender: "MALE" as const,
      appointmentDate: apptDate,
      timeSlot: timeSlotDate,
      tokenNumber: (i % 100) + 1,
      status: statuses[i % statuses.length],
      source: "WALK_IN" as const,
      reason: `${BENCHMARK_PREFIX}Reason_${i}`,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (let c = 0; c < APPOINTMENT_COUNT; c += 2000) {
    await prisma.appointment.createMany({
      data: appointmentsData.slice(c, c + 2000),
      skipDuplicates: true,
    });
  }
  const apptSeedTime = (performance.now() - apptStartTime) / 1000;
  console.log(`   Seeded ${APPOINTMENT_COUNT} appointments in ${apptSeedTime.toFixed(2)}s`);

  // 3. Benchmark Queries
  console.log("\n3. Benchmarking List Queries at Scale:");

  // Benchmark A: Patient Search by Name (Search query)
  const tA0 = performance.now();
  const searchResults = await prisma.patient.findMany({
    where: {
      deletedAt: null,
      OR: [
        { firstName: { contains: "Benchmark", mode: "insensitive" } },
        { lastName: { contains: "Benchmark_100", mode: "insensitive" } },
      ],
    },
    take: 50,
  });
  const tA = performance.now() - tA0;
  console.log(`   [A] Patient search (ILIKE, 50 rows): ${tA.toFixed(2)} ms (Returned: ${searchResults.length})`);

  // Benchmark B: Patient Paginated List (Page 20, 50 rows)
  const tB0 = performance.now();
  const pageResults = await prisma.patient.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    skip: 1000,
    take: 50,
  });
  const tB = performance.now() - tB0;
  console.log(`   [B] Patient paginated list (skip 1000, take 50): ${tB.toFixed(2)} ms (Returned: ${pageResults.length})`);

  // Benchmark C: Appointments Filtered by Date + Doctor
  const todayStr = new Date().toISOString().slice(0, 10);
  const tC0 = performance.now();
  const dateDoctorAppts = await prisma.$queryRaw<any[]>`
    SELECT a.id, a.token_number, a.status, a.time_slot, p.first_name, p.last_name
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    WHERE a.doctor_id = ${doctor.id}
      AND a.appointment_date = ${todayStr}::date
    ORDER BY a.token_number ASC
    LIMIT 50;
  `;
  const tC = performance.now() - tC0;
  console.log(`   [C] Appointments by doctor & date (token order, 50 rows): ${tC.toFixed(2)} ms (Returned: ${dateDoctorAppts.length})`);

  // Benchmark D: OPD Queue Status Query (CONFIRMED / WAITING)
  const tD0 = performance.now();
  const queueAppts = await prisma.appointment.findMany({
    where: {
      doctorId: doctor.id,
      status: { in: ["CONFIRMED", "WAITING"] },
    },
    orderBy: { tokenNumber: "asc" },
    take: 50,
  });
  const tD = performance.now() - tD0;
  console.log(`   [D] OPD Queue status query (CONFIRMED/WAITING, 50 rows): ${tD.toFixed(2)} ms (Returned: ${queueAppts.length})`);

  // Benchmark E: EXPLAIN ANALYZE on OPD Queue Query to verify index usage
  console.log("\n4. Query Plan Analysis (EXPLAIN ANALYZE):");
  const explainResult: any = await prisma.$queryRawUnsafe(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, token_number, status, appointment_date, time_slot
    FROM appointments
    WHERE doctor_id = '${doctor.id}'
      AND status IN ('CONFIRMED'::"AppointmentStatus", 'WAITING'::"AppointmentStatus")
    ORDER BY token_number ASC
    LIMIT 50;
  `);
  console.log("   Execution plan output:");
  for (const row of explainResult) {
    console.log("   ", row["QUERY PLAN"]);
  }

  // 5. Cleanup
  console.log("\n5. Cleaning up benchmark seed data...");
  const deleteAppts = await prisma.appointment.deleteMany({
    where: { reason: { startsWith: BENCHMARK_PREFIX } },
  });
  const deletePatients = await prisma.patient.deleteMany({
    where: { mrNumber: { startsWith: BENCHMARK_PREFIX } },
  });
  console.log(`   Deleted ${deleteAppts.count} benchmark appointments and ${deletePatients.count} benchmark patients.`);
  console.log("\n=== SCALE BENCHMARK COMPLETED SUCCESSFULLY ===");
}

runBenchmark()
  .catch((e) => {
    console.error("Benchmark failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
