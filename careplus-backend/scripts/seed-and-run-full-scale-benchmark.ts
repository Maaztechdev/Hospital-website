import { PrismaClient, Prisma } from "@prisma/client";

const DB_URL = process.env.DATABASE_URL || "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public";

function assertTestDb(url: string) {
  const dbMatch = url.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbMatch ? dbMatch[1] : "";
  if (!dbName || !dbName.endsWith("_test")) {
    throw new Error(`CRITICAL SAFETY ABORT: Database "${dbName}" does not end with "_test"!`);
  }
}

assertTestDb(DB_URL);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DB_URL,
    },
  },
});

async function main() {
  console.log("=== CHECKING INITIAL COUNTS ===");
  const [patCount, apptCount, invCount, labCount, rxCount] = await Promise.all([
    prisma.patient.count(),
    prisma.appointment.count(),
    prisma.invoice.count(),
    prisma.labOrder.count(),
    prisma.prescription.count(),
  ]);
  console.log({
    patients: patCount,
    appointments: apptCount,
    invoices: invCount,
    lab_orders: labCount,
    prescriptions: rxCount,
  });

  const adminUser = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const doctor = await prisma.doctor.findFirstOrThrow({
    where: { user: { email: "dr.usman@careplus.local" } },
    include: { department: true },
  });
  const labTest = await prisma.labTest.findFirstOrThrow({ where: { isActive: true } });

  // 1. Seed today's appointments for Dr. Usman Ali to reach >= 100 rows
  const todayApptCount = await prisma.appointment.count({
    where: {
      doctorId: doctor.id,
      appointmentDate: new Date(),
    },
  });
  if (todayApptCount < 120) {
    console.log(`Seeding today's appointments for Dr. Usman Ali (current: ${todayApptCount})...`);
    const needed = 120 - todayApptCount;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO appointments (
        id, patient_id, doctor_id, department_id, appointment_date, time_slot,
        appointment_type, status, token_number, priority, source, gender, created_by,
        created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        p.id,
        ${doctor.id}::uuid,
        ${doctor.departmentId}::uuid,
        CURRENT_DATE,
        ('06:00:00'::time + ((s * 5) || ' minutes')::interval),
        'CONSULTATION'::"AppointmentType",
        CASE (s % 3) WHEN 0 THEN 'WAITING'::"AppointmentStatus" WHEN 1 THEN 'CONFIRMED'::"AppointmentStatus" ELSE 'IN_CONSULTATION'::"AppointmentStatus" END,
        ${todayApptCount} + s,
        'ROUTINE'::"Priority",
        'WALK_IN'::"AppointmentSource",
        'MALE'::"Gender",
        ${adminUser.id}::uuid,
        NOW(),
        NOW()
      FROM generate_series(1, ${needed}) s
      CROSS JOIN LATERAL (
        SELECT id FROM patients OFFSET (s % 500) LIMIT 1
      ) p;
    `);
  }

  // 2. Seed invoices if < 5000
  if (invCount < 5200) {
    const needed = 5200 - invCount;
    console.log(`Seeding ${needed} invoices...`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO invoices (
        id, invoice_number, patient_id, created_by, status,
        subtotal, discount_amount, tax_amount, grand_total, paid_amount, balance_amount,
        created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        'INV-SCALE-' || s || '-' || substring(gen_random_uuid()::text, 1, 8),
        p.id,
        ${adminUser.id}::uuid,
        'PAID'::"InvoiceStatus",
        1500,
        0,
        0,
        1500,
        1500,
        0,
        NOW() - (s || ' minutes')::interval,
        NOW()
      FROM generate_series(1, ${needed}) s
      CROSS JOIN LATERAL (
        SELECT id FROM patients OFFSET (s % 1000) LIMIT 1
      ) p;
    `);
  }

  // 3. Seed lab orders if < 5000
  if (labCount < 5200) {
    const needed = 5200 - labCount;
    console.log(`Seeding ${needed} lab orders...`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO lab_orders (
        id, order_number, patient_id, doctor_id, test_id, created_by,
        status, priority, ordered_at
      )
      SELECT
        gen_random_uuid(),
        'LAB-SCALE-' || s || '-' || substring(gen_random_uuid()::text, 1, 8),
        p.id,
        ${doctor.id}::uuid,
        ${labTest.id}::uuid,
        ${adminUser.id}::uuid,
        'COMPLETED'::"LabOrderStatus",
        'ROUTINE'::"Priority",
        NOW() - (s || ' minutes')::interval
      FROM generate_series(1, ${needed}) s
      CROSS JOIN LATERAL (
        SELECT id FROM patients OFFSET (s % 1000) LIMIT 1
      ) p;
    `);
  }

  // 4. Seed prescriptions if < 10000
  if (rxCount < 10500) {
    const needed = 10500 - rxCount;
    console.log(`Seeding ${needed} prescriptions...`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO prescriptions (
        id, patient_id, doctor_id, status,
        signed_at, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        p.id,
        ${doctor.id}::uuid,
        'SIGNED'::"PrescriptionStatus",
        NOW() - (s || ' minutes')::interval,
        NOW() - (s || ' minutes')::interval,
        NOW()
      FROM generate_series(1, ${needed}) s
      CROSS JOIN LATERAL (
        SELECT id FROM patients OFFSET (s % 1000) LIMIT 1
      ) p;
    `);
  }

  // 5. Run ANALYZE across all affected tables
  console.log("\nRunning ANALYZE...");
  await prisma.$executeRawUnsafe("ANALYZE patients;");
  await prisma.$executeRawUnsafe("ANALYZE appointments;");
  await prisma.$executeRawUnsafe("ANALYZE invoices;");
  await prisma.$executeRawUnsafe("ANALYZE lab_orders;");
  await prisma.$executeRawUnsafe("ANALYZE prescriptions;");

  // 6. Print SELECT COUNT(*) for all 5 entities
  console.log("\n=== VERIFIED SCALE ROW COUNTS ===");
  const [
    finalPatients,
    finalAppointments,
    finalInvoices,
    finalLabOrders,
    finalPrescriptions,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM patients;`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM appointments;`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM invoices;`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM lab_orders;`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM prescriptions;`,
  ]);

  console.log(`patients: ${finalPatients[0].count} (requirement: >= 5,000)`);
  console.log(`appointments: ${finalAppointments[0].count} (requirement: >= 20,000)`);
  console.log(`invoices: ${finalInvoices[0].count} (requirement: >= 5,000)`);
  console.log(`lab_orders: ${finalLabOrders[0].count} (requirement: >= 5,000)`);
  console.log(`prescriptions: ${finalPrescriptions[0].count} (requirement: >= 10,000)`);

  const todayDoctorRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) FROM appointments 
    WHERE doctor_id = ${doctor.id} AND appointment_date = CURRENT_DATE;
  `;
  console.log(`today's appointments for Dr. Usman Ali: ${todayDoctorRows[0].count} (requirement: >= 100)\n`);

  // 7. EXPLAIN (ANALYZE, BUFFERS) - 1. OPD Queue Today for One Doctor
  console.log("================================================================================");
  console.log("1. EXPLAIN (ANALYZE, BUFFERS) - OPD Queue Today for Dr. Usman Ali (>= 100 rows)");
  console.log("================================================================================");
  const planQueue = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT a.id, a.token_number, a.status, a.time_slot,
           p.first_name, p.last_name, p.mr_number, d.id as doctor_id
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN doctors d ON d.id = a.doctor_id
    WHERE a.appointment_date = CURRENT_DATE
      AND a.doctor_id = '${doctor.id}'
      AND a.status IN ('CONFIRMED', 'WAITING', 'IN_CONSULTATION')
    ORDER BY a.token_number ASC
    LIMIT 150;
  `);
  console.log(planQueue.map((r) => Object.values(r)[0]).join("\n"));

  // 8. EXPLAIN (ANALYZE, BUFFERS) - 2. Patient Search by Name/Phone/CNIC
  console.log("\n================================================================================");
  console.log("2. EXPLAIN (ANALYZE, BUFFERS) - Patient Search by Name / Phone / CNIC");
  console.log("================================================================================");
  const planSearch = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, mr_number, first_name, last_name, phone, cnic
    FROM patients
    WHERE deleted_at IS NULL
      AND (
        first_name ILIKE '%Ahmed%'
        OR last_name ILIKE '%Khan%'
        OR phone LIKE '%0300%'
        OR normalized_cnic = '4210112345671'
      )
    LIMIT 20;
  `);
  console.log(planSearch.map((r) => Object.values(r)[0]).join("\n"));

  // 9. EXPLAIN (ANALYZE, BUFFERS) - 3. Appointments List OFFSET 5000 LIMIT 50 (Returning Rows)
  console.log("\n================================================================================");
  console.log("3. EXPLAIN (ANALYZE, BUFFERS) - Appointments List OFFSET 5000 LIMIT 50 (Must Return Rows)");
  console.log("================================================================================");
  const planAppts = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT a.id, a.appointment_date, a.time_slot, a.status,
           p.first_name, p.last_name, p.mr_number
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    ORDER BY a.appointment_date DESC, a.time_slot DESC
    OFFSET 5000 LIMIT 50;
  `);
  console.log(planAppts.map((r) => Object.values(r)[0]).join("\n"));

  // 10. EXPLAIN (ANALYZE, BUFFERS) - 4. Invoices List by Patient
  console.log("\n================================================================================");
  console.log("4. EXPLAIN (ANALYZE, BUFFERS) - Invoices by Patient");
  console.log("================================================================================");
  const patientWithInvoices = await prisma.invoice.findFirstOrThrow({ select: { patientId: true } });
  const planInvoices = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, invoice_number, grand_total, paid_amount, balance_amount, status, created_at
    FROM invoices
    WHERE patient_id = '${patientWithInvoices.patientId}'
    ORDER BY created_at DESC
    LIMIT 20;
  `);
  console.log(planInvoices.map((r) => Object.values(r)[0]).join("\n"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
