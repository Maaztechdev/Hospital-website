import { randomUUID } from "crypto";
import { prisma } from "@config/prisma";
import { appointmentsService, serializeAppointmentDateFields } from "../../src/modules/appointments/appointments.service";

const APPOINTMENT_DATE = "2030-10-02";
const TIME_SLOT = "09:00";

describe("appointment date-only persistence", () => {
  it("books date X at 09:00 and returns the same date through list, filter, and PostgreSQL", async () => {
    const suffix = randomUUID();
    const department = await prisma.department.create({ data: { name: `Appointment date test ${suffix}` } });
    const admin = await prisma.user.create({
      data: {
        name: "Appointment Date Test Admin",
        email: `appointment-date-${suffix}@careplus.test`,
        passwordHash: "test-hash",
        role: "ADMIN",
      },
    });
    const doctorUser = await prisma.user.create({
      data: {
        name: "Appointment Date Test Doctor",
        email: `appointment-doctor-${suffix}@careplus.test`,
        passwordHash: "test-hash",
        role: "DOCTOR",
        departmentId: department.id,
      },
    });
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        departmentId: department.id,
        consultationFee: 1000,
        scheduleJson: { slotsPerDay: [TIME_SLOT], slotsByDay: { Wednesday: [TIME_SLOT] } },
      },
    });
    const patient = await prisma.patient.create({
      data: {
        mrNumber: `MR-DATE-${suffix}`,
        firstName: "Date",
        lastName: "Roundtrip",
        gender: "OTHER",
        phone: `03${suffix.replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`,
        createdBy: admin.id,
      },
    });

    let appointmentId: string | undefined;
    try {
      const created = await appointmentsService.create(
        { sub: admin.id, role: "ADMIN", email: admin.email },
        {
          patientId: patient.id,
          doctorId: doctor.id,
          departmentId: department.id,
          appointmentDate: APPOINTMENT_DATE,
          timeSlot: TIME_SLOT,
          appointmentType: "CONSULTATION",
          source: "WALK_IN",
        }
      );
      appointmentId = created.id;

      const listed = await appointmentsService.list(
        { sub: admin.id, role: "ADMIN", email: admin.email },
        { page: 1, limit: 10, skip: 0, date: APPOINTMENT_DATE, sort: "date" }
      );
      const matching = listed.items.filter((item) => item.id === created.id);
      expect(listed.total).toBeGreaterThanOrEqual(1);
      expect(matching).toHaveLength(1);

      const [apiRecord] = await serializeAppointmentDateFields(matching);
      expect(apiRecord.appointmentDate).toBe(APPOINTMENT_DATE);
      expect(apiRecord.timeSlot).toBe(TIME_SLOT);

      const [databaseRecord] = await prisma.$queryRaw<Array<{ appointmentDate: string; timeSlot: string }>>`
        SELECT appointment_date::text AS "appointmentDate",
          left(time_slot::text, 5) AS "timeSlot"
        FROM appointments
        WHERE id = ${created.id}
      `;
      expect(databaseRecord).toEqual({ appointmentDate: APPOINTMENT_DATE, timeSlot: TIME_SLOT });
    } finally {
      if (appointmentId) {
        await prisma.auditLog.deleteMany({ where: { entityType: "Appointment", entityId: appointmentId } });
        await prisma.notification.deleteMany({ where: { relatedEntityId: appointmentId } });
        await prisma.appointment.deleteMany({ where: { id: appointmentId } });
      }
      await prisma.appointmentTokenSequence.deleteMany({ where: { doctorId: doctor.id } });
      await prisma.patient.deleteMany({ where: { id: patient.id } });
      await prisma.doctor.deleteMany({ where: { id: doctor.id } });
      await prisma.user.deleteMany({ where: { id: doctorUser.id } });
      await prisma.user.deleteMany({ where: { id: admin.id } });
      await prisma.department.deleteMany({ where: { id: department.id } });
    }
  });
});
