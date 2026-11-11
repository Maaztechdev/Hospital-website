import { prisma } from "../src/config/prisma";
import { performance } from "perf_hooks";

async function main() {
  console.log("=== SCALE BENCHMARK & QUERY PLAN AUDIT ===");
  const targetDb = process.env.DATABASE_URL?.split("@")[1] || "careplus_test";
  console.log("Target Database:", targetDb);

  // 1. Get or create 3 doctors
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("Admin required");

  let doctors = await prisma.doctor.findMany({ take: 3, include: { user: true } });
  if (doctors.length < 3) {
    console.log(`Only ${doctors.length} doctors found, ensuring 3 doctors exist...`);
    for (let i = doctors.length + 1; i <= 3; i++) {
      const docUser = await prisma.user.upsert({
        where: { email: `dr.bench.${i}@careplus.local` },
        update: {},
        create: {
          email: `dr.bench.${i}@careplus.local`,
          name: `Dr. Bench ${i}`,
          passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
          role: "DOCTOR",
        },
      });
      await prisma.doctor.upsert({
        where: { userId: docUser.id },
        update: {},
        create: {
          userId: docUser.id,
          specialization: "General Medicine",
          consultationFee: 1500,
          isAvailable: true,
        },
      });
    }
    doctors = await prisma.doctor.findMany({ take: 3, include: { user: true } });
  }

  const doc1 = doctors[0];
  const doc2 = doctors[1];
  const doc3 = doctors[2];
  console.log(`Using 3 doctors: ${doc1.user.name} (${doc1.id}), ${doc2.user.name} (${doc2.id}), ${doc3.user.name} (${doc3.id})`);

  const BENCHMARK_PREFIX = "SCALE_";
  const PATIENT_COUNT = 5000;
  const APPOINTMENT_COUNT = 25000;

  // Check if already seeded
  const existingPatients = await prisma.patient.count({ where: { mrNumber: { startsWith: BENCHMARK_PREFIX } } });
  const existingAppts = await prisma.appointment.count({ where: { reason: { startsWith: BENCHMARK_PREFIX } } });

  if (existingPatients < PATIENT_COUNT) {
    console.log(`\nSeeding ${PATIENT_COUNT} benchmark patients...`);
    const t0 = performance.now();
    const patientsData = [];
    const now = new Date();
    for (let i = 1; i <= PATIENT_COUNT; i++) {
      const padded = String(i).padStart(6, "0");
      patientsData.push({
        mrNumber: `${BENCHMARK_PREFIX}MR_${padded}`,
        firstName: i % 2 === 0 ? `Fatima_${i}` : `Muhammad_${i}`,
        lastName: `Khan_${i}`,
        phone: `0300${String(1000000 + i)}`,
        cnic: `35201-${String(1000000 + i)}-1`,
        normalizedCnic: `35201${String(1000000 + i)}1`,
        gender: i % 2 === 0 ? ("FEMALE" as const) : ("MALE" as const),
        age: 18 + (i % 65),
        createdBy: admin.id,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (let c = 0; c < PATIENT_COUNT; c += 1000) {
      await prisma.patient.createMany({
        data: patientsData.slice(c, c + 1000),
        skipDuplicates: true,
      });
    }
    console.log(`Seeded ${PATIENT_COUNT} patients in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
  } else {
    console.log(`\n${existingPatients} benchmark patients already present.`);
  }

  // Fetch patient IDs
  const allBenchPatients = await prisma.patient.findMany({
    where: { mrNumber: { startsWith: BENCHMARK_PREFIX } },
    select: { id: true },
  });
  console.log(`Available benchmark patients: ${allBenchPatients.length}`);

  if (existingAppts < APPOINTMENT_COUNT) {
    console.log(`\nSeeding ${APPOINTMENT_COUNT} benchmark appointments spread over 3 doctors and 30 days...`);
    const t0 = performance.now();
    const docList = [doc1.id, doc2.id, doc3.id];
    const statuses = ["CONFIRMED", "WAITING", "IN_CONSULTATION", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
    const now = new Date();
    const appointmentsData = [];
    let apptCount = 0;
    for (let day = 0; day < 50 && apptCount < APPOINTMENT_COUNT; day++) {
      const dayOffset = day - 40; // 40 days past, 10 days future
      const apptDate = new Date(Date.now() + dayOffset * 86400000);
      for (let d = 0; d < 3 && apptCount < APPOINTMENT_COUNT; d++) {
        const doctorId = docList[d];
        for (let slot = 0; slot < 200 && apptCount < APPOINTMENT_COUNT; slot++) {
          apptCount++;
          const patientId = allBenchPatients[apptCount % allBenchPatients.length].id;
          const hour = 8 + Math.floor(slot / 60);
          const minute = slot % 60;
          const timeSlotDate = new Date(`1970-01-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
          let status: "CONFIRMED" | "WAITING" | "IN_CONSULTATION" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
          if (dayOffset < 0) {
            status = apptCount % 10 === 0 ? "CANCELLED" : apptCount % 15 === 0 ? "NO_SHOW" : "COMPLETED";
          } else if (dayOffset === 0) {
            status = apptCount % 3 === 0 ? "CONFIRMED" : apptCount % 3 === 1 ? "WAITING" : "IN_CONSULTATION";
          } else {
            status = apptCount % 2 === 0 ? "COMPLETED" : "CANCELLED";
          }
          appointmentsData.push({
            patientId,
            doctorId,
            appointmentType: "CONSULTATION" as const,
            gender: apptCount % 2 === 0 ? ("FEMALE" as const) : ("MALE" as const),
            appointmentDate: apptDate,
            timeSlot: timeSlotDate,
            tokenNumber: (slot % 200) + 1,
            status,
            source: "WALK_IN" as const,
            reason: `${BENCHMARK_PREFIX}Appt_${apptCount}`,
            createdBy: admin.id,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    // Clear any partial benchmark appointments first
    await prisma.appointment.deleteMany({ where: { reason: { startsWith: BENCHMARK_PREFIX } } });

    for (let c = 0; c < APPOINTMENT_COUNT; c += 2000) {
      await prisma.appointment.createMany({
        data: appointmentsData.slice(c, c + 2000),
        skipDuplicates: true,
      });
    }
    const insertedAppts = await prisma.appointment.count({ where: { reason: { startsWith: BENCHMARK_PREFIX } } });
    console.log(`Seeded ${insertedAppts} appointments in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
  } else {
    console.log(`\n${existingAppts} benchmark appointments already present.`);
  }

  // Ensure sample invoices exist for patient invoice benchmark
  const testPatient = allBenchPatients[0];
  const invoiceCount = await prisma.invoice.count({ where: { patientId: testPatient.id } });
  if (invoiceCount < 5) {
    for (let k = 1; k <= 5; k++) {
      await prisma.invoice.create({
        data: {
          invoiceNumber: `INV-BENCH-${Date.now()}-${k}`,
          patient: { connect: { id: testPatient.id } },
          grandTotal: 1500,
          subtotal: 1500,
          paidAmount: 1500,
          balanceAmount: 0,
          status: "PAID",
          department: "RECEPTION",
          createdBy: admin.id,
        },
      });
    }
  }

  // Count total rows currently in DB
  const totalPatients = await prisma.patient.count();
  const totalAppts = await prisma.appointment.count();
  const totalInvoices = await prisma.invoice.count();
  console.log(`\nCurrent Database Row Counts:`);
  console.log(`  - Patients: ${totalPatients}`);
  console.log(`  - Appointments: ${totalAppts}`);
  console.log(`  - Invoices: ${totalInvoices}`);

  // 2. Run ANALYZE to ensure PostgreSQL query planner has current table statistics
  console.log("\nRunning PostgreSQL ANALYZE on target tables...");
  await prisma.$executeRawUnsafe(`ANALYZE patients;`);
  await prisma.$executeRawUnsafe(`ANALYZE appointments;`);
  await prisma.$executeRawUnsafe(`ANALYZE invoices;`);
  console.log("ANALYZE complete.");

  // Helper to format explain output
  async function runExplain(title: string, sql: string) {
    console.log(`\n=======================================================`);
    console.log(`EXPLAIN (ANALYZE, BUFFERS): ${title}`);
    console.log(`=======================================================`);
    console.log(`SQL Query:\n${sql.trim()}\n`);
    const rows = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
    for (const r of rows) {
      console.log(r["QUERY PLAN"]);
    }
  }

  // Query 1: OPD Queue today
  // Appointments for doctor 1 for today with CONFIRMED or WAITING status ordered by token_number
  const todayDateStr = new Date().toISOString().slice(0, 10);
  await runExplain(
    "1. OPD Queue Today (Doctor + Date + Status + Token Ordering)",
    `SELECT a.id, a.token_number, a.status, a.time_slot, p.first_name, p.last_name, p.mr_number
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.doctor_id = '${doc1.id}'
       AND a.appointment_date = '${todayDateStr}'::date
       AND a.status IN ('CONFIRMED'::"AppointmentStatus", 'WAITING'::"AppointmentStatus")
     ORDER BY a.token_number ASC
     LIMIT 50;`
  );

  // Query 2: Patient Search by Name / Phone / CNIC
  await runExplain(
    "2. Patient Search by Name / Phone / CNIC",
    `SELECT id, mr_number, first_name, last_name, phone, cnic, normalized_cnic
     FROM patients
     WHERE deleted_at IS NULL
       AND (
         phone = '03001000500'
         OR normalized_cnic = '3520110005001'
         OR (first_name ILIKE '%Fatima_500%' OR last_name ILIKE '%Khan_500%')
       )
     LIMIT 50;`
  );

  // Query 3: Appointments List Pagination
  await runExplain(
    "3. Appointments List Pagination (Offset 1000, Limit 50)",
    `SELECT id, token_number, status, appointment_date, time_slot, created_at
     FROM appointments
     ORDER BY created_at DESC
     OFFSET 1000
     LIMIT 50;`
  );

  // Query 4: Invoice List by Patient
  await runExplain(
    "4. Invoice List by Patient (Ordered by createdAt DESC)",
    `SELECT id, invoice_number, grand_total, paid_amount, balance_amount, status, created_at
     FROM invoices
     WHERE patient_id = '${testPatient.id}'
     ORDER BY created_at DESC
     LIMIT 50;`
  );

  console.log("\nScale Benchmark and Query Plan Analysis Finished Successfully.");
}

main()
  .catch((e) => {
    console.error("Benchmark failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
