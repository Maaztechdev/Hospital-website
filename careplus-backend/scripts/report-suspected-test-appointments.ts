import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type AppointmentDetail = {
  id: string;
  date: string;
  time: string;
  status: string;
  doctor: string;
  reason: string | null;
  isTest?: boolean;
};

type PatientGroup = {
  patientId: string;
  mrNumber: string;
  patientName: string;
  phone: string;
  patientIsTest?: boolean;
  appointmentCount: number;
  appointments: AppointmentDetail[];
};

async function main() {
  const flagColumns = await prisma.$queryRaw<Array<{ patientsHaveTestFlag: boolean; appointmentsHaveTestFlag: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patients' AND column_name = 'is_test'
      ) AS "patientsHaveTestFlag",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'is_test'
      ) AS "appointmentsHaveTestFlag"
  `;
  const flags = flagColumns[0];

  const patientPredicates = [
    Prisma.sql`p.mr_number = 'MR-2026-000001'`,
    Prisma.sql`EXISTS (
      SELECT 1 FROM test_markers m
      WHERE concat_ws(' ', p.first_name, p.last_name) ILIKE m.pattern
    )`,
  ];
  if (flags?.patientsHaveTestFlag) patientPredicates.push(Prisma.sql`p.is_test = true`);

  const appointmentPredicates = [
    Prisma.sql`EXISTS (
      SELECT 1 FROM appointments matched
      WHERE matched.patient_id = p.id
        AND concat_ws(' ', matched.reason, matched.notes) ILIKE ANY (
          ARRAY(SELECT pattern FROM test_markers)
        )
    )`,
  ];
  if (flags?.appointmentsHaveTestFlag) {
    appointmentPredicates.push(Prisma.sql`EXISTS (
      SELECT 1 FROM appointments flagged
      WHERE flagged.patient_id = p.id AND flagged.is_test = true
    )`);
  }

  const appointmentJoinPredicates = [
    Prisma.sql`p.mr_number = 'MR-2026-000001'`,
    Prisma.sql`EXISTS (
      SELECT 1 FROM test_markers m
      WHERE concat_ws(' ', p.first_name, p.last_name) ILIKE m.pattern
    )`,
    Prisma.sql`concat_ws(' ', a.reason, a.notes) ILIKE ANY (
      ARRAY(SELECT pattern FROM test_markers)
    )`,
  ];
  if (flags?.appointmentsHaveTestFlag) appointmentJoinPredicates.push(Prisma.sql`a.is_test = true`);

  const patientIsTestColumn = flags?.patientsHaveTestFlag ? Prisma.sql`, p.is_test AS "patientIsTest"` : Prisma.empty;
  const appointmentIsTestColumn = flags?.appointmentsHaveTestFlag ? Prisma.sql`, a.is_test AS "isTest"` : Prisma.empty;

  const groups = await prisma.$queryRaw<PatientGroup[]>(Prisma.sql`
    WITH test_markers(pattern) AS (
      VALUES
        ('%check 1%'),
        ('%check 3%'),
        ('%ui audit request%'),
        ('%double click audit%'),
        ('%token time first%'),
        ('%token time earlier%'),
        ('%demo presentation%')
    ), suspected_patients AS (
      SELECT DISTINCT p.id
      FROM patients p
      WHERE ${Prisma.join([
        ...patientPredicates,
        Prisma.sql`(${Prisma.join(appointmentPredicates, " OR ")})`,
      ], " OR ")}
    )
    SELECT
      p.id AS "patientId",
      p.mr_number AS "mrNumber",
      concat_ws(' ', p.first_name, p.last_name) AS "patientName",
      p.phone,
      count(a.id)::int AS "appointmentCount"${patientIsTestColumn},
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'date', a.appointment_date::text,
            'time', a.time_slot,
            'status', a.status::text,
            'doctor', u.name,
            'reason', a.reason${appointmentIsTestColumn}
          ) ORDER BY a.appointment_date, a.time_slot, a.id
        ) FILTER (WHERE a.id IS NOT NULL),
        '[]'::jsonb
      ) AS appointments
    FROM suspected_patients sp
    JOIN patients p ON p.id = sp.id
    LEFT JOIN appointments a ON a.patient_id = p.id
      AND (${Prisma.join(appointmentJoinPredicates, " OR ")})
    LEFT JOIN doctors d ON d.id = a.doctor_id
    LEFT JOIN users u ON u.id = d.user_id
    GROUP BY p.id, p.mr_number, p.first_name, p.last_name, p.phone${patientIsTestColumn}
    ORDER BY p.mr_number, p.first_name, p.last_name
  `);

  if (groups.length === 0) {
    console.log("No suspected test patients or appointments found. No data was changed.");
    return;
  }

  console.log(`Suspected test records grouped by patient (${groups.length} patient group(s)). Read-only report; no data was changed.`);
  for (const group of groups) {
    console.log(`\n${group.patientName} | ${group.mrNumber} | ${group.phone} | ${group.appointmentCount} appointment(s)${group.patientIsTest ? " | is_test=true" : ""}`);
    if (group.appointments.length > 0) console.table(group.appointments);
  }
}

main()
  .catch((error) => {
    console.error("Unable to report suspected test records:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
