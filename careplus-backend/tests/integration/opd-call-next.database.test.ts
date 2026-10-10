import { randomUUID } from "crypto";
import { prisma } from "@config/prisma";
import { appointmentsService, getDateKeyInTimeZone } from "../../src/modules/appointments/appointments.service";
import { consultationsService } from "../../src/modules/consultations/consultations.service";

describe("OPD call-next and consultation record access", () => {
  it("calls today's lowest token atomically, blocks concurrent/current calls, and scopes doctors", async () => {
    const suffix = randomUUID();
    const date = getDateKeyInTimeZone(new Date());
    const dateValue = new Date(`${date}T00:00:00.000Z`);
    const admin = await prisma.user.create({
      data: { name: "Queue Test Admin", email: `queue-admin-${suffix}@careplus.test`, passwordHash: "test-hash", role: "ADMIN" },
    });
    const doctorUser = await prisma.user.create({
      data: { name: "Queue Test Doctor", email: `queue-doctor-${suffix}@careplus.test`, passwordHash: "test-hash", role: "DOCTOR" },
    });
    const otherDoctorUser = await prisma.user.create({
      data: { name: "Other Queue Doctor", email: `queue-other-${suffix}@careplus.test`, passwordHash: "test-hash", role: "DOCTOR" },
    });
    const doctor = await prisma.doctor.create({ data: { userId: doctorUser.id, consultationFee: 1000 } });
    const otherDoctor = await prisma.doctor.create({ data: { userId: otherDoctorUser.id, consultationFee: 1000 } });
    const patientRecords = await Promise.all([1, 2, 3].map((index) => prisma.patient.create({
      data: {
        mrNumber: `MR-QUEUE-${suffix}-${index}`,
        firstName: `Queue${index}`,
        lastName: "Patient",
        gender: "OTHER",
        phone: `03${suffix.replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}${index}`,
        createdBy: admin.id,
      },
    })));
    const appointmentIds: string[] = [];
    let consultationId: string | undefined;
    const adminActor = { sub: admin.id, role: "ADMIN" as const, email: admin.email };
    const doctorActor = { sub: doctorUser.id, role: "DOCTOR" as const, email: doctorUser.email };
    const otherDoctorActor = { sub: otherDoctorUser.id, role: "DOCTOR" as const, email: otherDoctorUser.email };
    const initialStatuses = ["CONFIRMED", "WAITING", "CONFIRMED"] as const;

    try {
      for (const [index, status] of initialStatuses.entries()) {
        const appointment = await prisma.appointment.create({
          data: {
            patientId: patientRecords[index].id,
            doctorId: doctor.id,
            appointmentDate: dateValue,
            timeSlot: new Date("1970-01-01T10:00:00.000Z"),
            tokenNumber: index + 1,
            appointmentType: "CONSULTATION",
            status,
            priority: index === 2 ? "EMERGENCY" : "ROUTINE",
            source: "WALK_IN",
            createdBy: admin.id,
          },
        });
        appointmentIds.push(appointment.id);
      }

      await expect(appointmentsService.callNext(doctorActor, otherDoctor.id)).rejects.toThrow("not authorized");

      const concurrentCalls = await Promise.allSettled([
        appointmentsService.callNext(doctorActor, doctor.id),
        appointmentsService.callNext(doctorActor, doctor.id),
      ]);
      const succeeded = concurrentCalls.filter((result) => result.status === "fulfilled");
      const rejected = concurrentCalls.filter((result) => result.status === "rejected");
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (succeeded[0].status !== "fulfilled") throw new Error("Expected one call-next request to succeed");
      expect(succeeded[0].value?.tokenNumber).toBe(1);
      expect(succeeded[0].value?.status).toBe("IN_CONSULTATION");
      if (rejected[0].status !== "rejected") throw new Error("Expected the concurrent request to be rejected");
      expect(rejected[0].reason.message).toMatch(/Resume the current consultation/);

      await prisma.appointment.update({ where: { id: succeeded[0].value!.id }, data: { status: "COMPLETED" } });
      const next = await appointmentsService.callNext(doctorActor, doctor.id);
      expect(next?.tokenNumber).toBe(2);
      expect(next?.status).toBe("IN_CONSULTATION");

      await prisma.appointment.update({ where: { id: next!.id }, data: { status: "COMPLETED" } });
      await prisma.appointment.update({ where: { id: appointmentIds[2] }, data: { status: "COMPLETED" } });
      expect(await appointmentsService.callNext(doctorActor, doctor.id)).toBeNull();

      const consultation = await prisma.consultation.create({
        data: { appointmentId: appointmentIds[0], patientId: patientRecords[0].id, doctorId: doctor.id },
      });
      consultationId = consultation.id;
      await expect(consultationsService.getById(doctorActor, consultation.id)).resolves.toMatchObject({ id: consultation.id });
      await expect(consultationsService.getById(otherDoctorActor, consultation.id)).rejects.toThrow("not authorized");
      await expect(consultationsService.getById(adminActor, consultation.id)).resolves.toMatchObject({ id: consultation.id });
    } finally {
      if (consultationId) await prisma.consultation.deleteMany({ where: { id: consultationId } });
      if (appointmentIds.length) {
        await prisma.auditLog.deleteMany({ where: { entityType: "Appointment", entityId: { in: appointmentIds } } });
        await prisma.notification.deleteMany({ where: { relatedEntityId: { in: appointmentIds } } });
        await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      }
      await prisma.appointmentTokenSequence.deleteMany({ where: { doctorId: { in: [doctor.id, otherDoctor.id] } } });
      await prisma.patient.deleteMany({ where: { id: { in: patientRecords.map((patient) => patient.id) } } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doctor.id, otherDoctor.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [doctorUser.id, otherDoctorUser.id, admin.id] } } });
    }
  });
});
