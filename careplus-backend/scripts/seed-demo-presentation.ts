import { PrismaClient, AppointmentStatus } from "@prisma/client";
import { generateNextAppointmentToken } from "../src/common/utils/sequenceGenerators";

const prisma = new PrismaClient();

const DEMO_PATIENTS = [
  { mrNumber: "DEMO-PRES-001", firstName: "Sara", lastName: "Presentation", age: 34, phone: "03000000001", gender: "FEMALE" as const },
  { mrNumber: "DEMO-PRES-002", firstName: "Hamza", lastName: "Demo", age: 46, phone: "03000000002", gender: "MALE" as const },
  { mrNumber: "DEMO-PRES-003", firstName: "Amina", lastName: "Demo", age: 27, phone: "03000000003", gender: "FEMALE" as const },
];

const DEMO_STATUSES: AppointmentStatus[] = ["CONFIRMED", "WAITING", "PENDING_APPROVAL"];
const HOSPITAL_TIMEZONE = "Asia/Karachi";

function hospitalDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(dateKey: string, daysToAdd: number) {
  let [year, month, day] = dateKey.split("-").map(Number);
  const isLeapYear = (value: number) => value % 4 === 0 && (value % 100 !== 0 || value % 400 === 0);
  const daysInMonth = (value: number, monthIndex: number) => monthIndex === 2 ? (isLeapYear(value) ? 29 : 28) : [4, 6, 9, 11].includes(monthIndex) ? 30 : 31;
  while (daysToAdd > 0) {
    const remaining = daysInMonth(year, month) - day;
    if (daysToAdd <= remaining) { day += daysToAdd; daysToAdd = 0 }
    else { daysToAdd -= remaining + 1; day = 1; month += 1; if (month > 12) { month = 1; year += 1 } }
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function getSlotsForDate(scheduleJson: unknown, dateKey: string) {
  const schedule = scheduleJson as { slotsPerDay?: string[]; slotsByDay?: Record<string, string[]>; daysOff?: string[] } | null;
  const [yearValue, month, day] = dateKey.split("-").map(Number);
  const year = yearValue - (month < 3 ? 1 : 0);
  const monthOffsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const weekdayIndex = (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + monthOffsets[month - 1] + day) % 7;
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekdayIndex];
  if ((schedule?.daysOff ?? []).includes(weekday)) return [];
  return schedule?.slotsByDay?.[weekday] ?? schedule?.slotsPerDay ?? [];
}

async function createDemoAppointment(input: {
  patientId: string;
  doctorId: string;
  departmentId: string | null;
  createdBy: string;
  approvedBy: string;
  scheduleJson: unknown;
  status: AppointmentStatus;
}) {
  const existing = await prisma.appointment.findFirst({
    where: { patientId: input.patientId, isTest: true, reason: "Demo presentation consultation" },
    select: { id: true },
  });
  if (existing) {
    console.log(`Kept existing demo appointment ${existing.id} for patient ${input.patientId}.`);
    return;
  }

  const todayKey = hospitalDateKey(new Date());
  for (let dayOffset = 1; dayOffset <= 60; dayOffset += 1) {
    const dateKey = addDays(todayKey, dayOffset);
    const slots = getSlotsForDate(input.scheduleJson, dateKey);
    if (slots.length === 0) continue;

    const created = await prisma.$transaction(async (tx) => {
      const bookings = await tx.$queryRaw<Array<{ timeSlot: string }>>`
        SELECT left(time_slot::text, 5) AS "timeSlot"
        FROM appointments WHERE doctor_id = ${input.doctorId} AND appointment_date = ${dateKey}::date
      `;
      const bookedSlots = new Set(bookings.map((booking) => booking.timeSlot));
      const timeSlot = slots.find((slot) => !bookedSlots.has(slot));
      if (!timeSlot) return null;

      const tokenNumber = await generateNextAppointmentToken(tx, input.doctorId, dateKey);
      const [appointment] = await tx.$queryRaw<Array<{ id: string; status: string; timeSlot: string }>>`
        INSERT INTO appointments (
          patient_id, doctor_id, department_id, appointment_date, time_slot, token_number,
          appointment_type, status, priority, source, reason, notes, is_test, created_by, approved_by, waiting_since, created_at, updated_at
        ) VALUES (
          ${input.patientId}, ${input.doctorId}, ${input.departmentId}, ${dateKey}::date, ${timeSlot}::time, ${tokenNumber},
          'CONSULTATION'::"AppointmentType", ${input.status}::"AppointmentStatus", 'ROUTINE'::"Priority", 'WALK_IN'::"AppointmentSource",
          'Demo presentation consultation', 'Synthetic presentation data; safe to identify with is_test.', true,
          ${input.createdBy}, ${input.status === "CONFIRMED" ? input.approvedBy : null}, ${input.status === "WAITING" ? new Date() : null}, NOW(), NOW()
        ) RETURNING id, status::text AS status, left(time_slot::text, 5) AS "timeSlot"
      `;
      return appointment;
    });

    if (created) {
      console.log(`Created ${created.status} demo appointment ${created.id} for ${dateKey} ${created.timeSlot}.`);
      return;
    }
  }

  throw new Error(`No free configured appointment slot found within 60 days for patient ${input.patientId}.`);
}

async function main() {
  const [admin, doctor] = await Promise.all([
    prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } }),
    prisma.doctor.findFirst({ where: { isAvailable: true }, orderBy: { createdAt: "asc" }, include: { user: true } }),
  ]);
  if (!admin) throw new Error("An active admin is required. Run the standard seed first.");
  if (!doctor) throw new Error("An available doctor is required. Run the standard seed first.");

  console.log("Creating or reusing isolated presentation patients marked is_test=true.");
  for (let index = 0; index < DEMO_PATIENTS.length; index += 1) {
    const input = DEMO_PATIENTS[index];
    const existing = await prisma.patient.findUnique({ where: { mrNumber: input.mrNumber } });
    if (existing && (!existing.isTest || existing.firstName !== input.firstName || existing.lastName !== input.lastName)) {
      throw new Error(`Reserved demo MR number ${input.mrNumber} is already used by a non-matching patient; refusing to modify it.`);
    }

    const patient = existing ?? await prisma.patient.create({
      data: {
        ...input,
        createdBy: admin.id,
        isTest: true,
        notes: "Synthetic presentation patient; not a real patient.",
      },
    });

    await createDemoAppointment({
      patientId: patient.id,
      doctorId: doctor.id,
      departmentId: doctor.departmentId,
      createdBy: admin.id,
      approvedBy: admin.id,
      scheduleJson: doctor.scheduleJson,
      status: DEMO_STATUSES[index],
    });
  }

  console.log("Presentation demo seed complete. Existing records were not deleted or rewritten except the reserved DEMO-PRES patient profiles.");
}

main()
  .catch((error) => {
    console.error("Unable to seed presentation demo data:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
