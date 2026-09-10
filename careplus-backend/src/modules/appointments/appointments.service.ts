import { Prisma, AppointmentStatus } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { notifyUser } from "@common/utils/notify";
import { generateMrNumber, generateTokenNumber } from "@common/utils/sequenceGenerators";
import { PageParams } from "@common/utils/pagination";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { assertDoctorOwns, getActorDoctorId, assertPatientAccess } from "@common/utils/recordAuthorization";

const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING_APPROVAL: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["WAITING", "CANCELLED", "NO_SHOW"],
  WAITING: ["IN_CONSULTATION", "CANCELLED", "NO_SHOW"],
  IN_CONSULTATION: ["DONE"],
  DONE: [],
  CANCELLED: [],
  NO_SHOW: [],
};

function assertTransition(from: AppointmentStatus, to: AppointmentStatus) {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ConflictError(`Cannot transition appointment from ${from} to ${to}`);
  }
}

interface CreateAppointmentInput {
  patientId: string;
  doctorId: string;
  departmentId?: string;
  appointmentDate: string;
  timeSlot: string;
  appointmentType: string;
  priority?: string;
  source?: string;
  reason?: string;
  notes?: string;
}

interface PublicAppointmentInput {
  fullName: string;
  phone: string;
  email?: string;
  age: number;
  doctorId: string;
  departmentId?: string;
  appointmentDate: string;
  timeSlot: string;
  reason?: string;
}

export const appointmentsService = {
  async createPublic(input: PublicAppointmentInput, req?: Request) {
    const systemUser = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
    if (!systemUser) throw new NotFoundError("No active system user is available for public bookings");

    const nameParts = input.fullName.trim().split(/\s+/);
    const firstName = nameParts.shift() ?? input.fullName.trim();
    const lastName = nameParts.join(" ") || firstName;
    const dateOfBirth = new Date(Date.UTC(new Date().getUTCFullYear() - input.age, 0, 1));

    try {
      const appointment = await prisma.$transaction(async (tx) => {
        const doctor = await tx.doctor.findFirst({ where: { id: input.doctorId, isAvailable: true, department: { status: "ACTIVE" } } });
        if (!doctor || !doctor.isAvailable) throw new NotFoundError("Doctor not found or unavailable");

        const patient = await tx.patient.findFirst({ where: { phone: input.phone, deletedAt: null }, orderBy: { createdAt: "asc" } }) ?? await tx.patient.create({
          data: {
            mrNumber: await generateMrNumber(tx),
            firstName,
            lastName,
            dateOfBirth,
            age: input.age,
            gender: "OTHER",
            phone: input.phone,
            email: input.email,
            createdBy: systemUser.id,
          },
        });
        const tokenNumber = await generateTokenNumber(tx, input.doctorId, new Date(input.appointmentDate));
        return tx.appointment.create({
          data: {
            patientId: patient.id,
            doctorId: input.doctorId,
            departmentId: input.departmentId ?? doctor.departmentId,
            appointmentDate: new Date(input.appointmentDate),
            timeSlot: input.timeSlot,
            tokenNumber,
            appointmentType: "NEW_VISIT",
            source: "WEBSITE",
            reason: input.reason,
            createdBy: systemUser.id,
          },
          include: { patient: true, doctor: { include: { user: true } } },
        });
      });

      await writeAuditLog({ userId: systemUser.id, action: "CREATE", module: "appointments", entityType: "Appointment", entityId: appointment.id, newValues: appointment, req });
      await notifyUser({ userId: appointment.doctor.userId, notificationType: "APPOINTMENT_PENDING", title: "New website appointment", message: `Token #${appointment.tokenNumber} for ${input.appointmentDate} ${input.timeSlot}`, relatedEntityType: "Appointment", relatedEntityId: appointment.id });
      return appointment;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This doctor already has an appointment booked for that date and time slot");
      }
      throw err;
    }
  },

  async list(actor: AccessTokenPayload, params: PageParams & { date?: string; doctorId?: string; departmentId?: string; status?: string }) {
    const actorDoctorId = await getActorDoctorId(actor);
    const where: Prisma.AppointmentWhereInput = {
      ...(params.date ? { appointmentDate: new Date(params.date) } : {}),
      ...(params.doctorId ? { doctorId: params.doctorId } : {}),
      ...(params.departmentId ? { departmentId: params.departmentId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(actorDoctorId ? { doctorId: actorDoctorId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: [{ appointmentDate: "asc" }, { timeSlot: "asc" }],
        include: { patient: true, doctor: { include: { user: true } } },
      }),
      prisma.appointment.count({ where }),
    ]);

    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const appt = await prisma.appointment.findUnique({
      where: { id },
      include: { patient: true, doctor: { include: { user: true } } },
    });
    if (!appt) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appt.doctorId);
    return appt;
  },

  async create(actor: AccessTokenPayload, input: CreateAppointmentInput, req?: Request) {
    await assertPatientAccess(actor, input.patientId);
    const actorId = actor.sub;
    const date = new Date(input.appointmentDate);

    const [patient, doctor] = await Promise.all([
      prisma.patient.findFirst({ where: { id: input.patientId, deletedAt: null } }),
      prisma.doctor.findFirst({ where: { id: input.doctorId, isAvailable: true, department: { status: "ACTIVE" } } }),
    ]);
    if (!patient) throw new NotFoundError("Patient not found");
    if (!doctor) throw new NotFoundError("Doctor not found");

    try {
      const appointment = await prisma.$transaction(async (tx) => {
        const tokenNumber = await generateTokenNumber(tx, input.doctorId, date);
        return tx.appointment.create({
          data: {
            patientId: input.patientId,
            doctorId: input.doctorId,
            departmentId: input.departmentId,
            appointmentDate: date,
            timeSlot: input.timeSlot,
            tokenNumber,
            appointmentType: input.appointmentType as never,
            priority: (input.priority as never) ?? "ROUTINE",
            source: (input.source as never) ?? "WALK_IN",
            reason: input.reason,
            notes: input.notes,
            createdBy: actorId,
          },
          include: { patient: true, doctor: { include: { user: true } } },
        });
      });

      await writeAuditLog({ userId: actorId, action: "CREATE", module: "appointments", entityType: "Appointment", entityId: appointment.id, newValues: appointment, req });
      await notifyUser({
        userId: doctor.userId,
        notificationType: "APPOINTMENT_PENDING",
        title: "New appointment pending approval",
        message: `Token #${appointment.tokenNumber} for ${input.appointmentDate} ${input.timeSlot}`,
        relatedEntityType: "Appointment",
        relatedEntityId: appointment.id,
      });
      return appointment;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This doctor already has an appointment booked for that date and time slot");
      }
      throw err;
    }
  },

  async transitionStatus(
    actor: AccessTokenPayload,
    id: string,
    to: AppointmentStatus,
    extra: Record<string, unknown> = {},
    req?: Request
  ) {
    const appt = await prisma.appointment.findUnique({ where: { id }, include: { doctor: true } });
    if (!appt) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appt.doctorId);
    assertTransition(appt.status, to);

    const actorId = actor.sub;
    const data: Prisma.AppointmentUpdateInput = { status: to, ...extra };
    if (to === "WAITING") data.waitingSince = new Date();

    const updated = await prisma.appointment.update({ where: { id }, data });

    await writeAuditLog({
      userId: actorId,
      action: "STATUS_CHANGE",
      module: "appointments",
      entityType: "Appointment",
      entityId: id,
      oldValues: { status: appt.status },
      newValues: { status: to, ...extra },
      req,
    });

    if (to === "CONFIRMED") {
      await notifyUser({
        userId: appt.doctor.userId,
        notificationType: "APPOINTMENT_CONFIRMED",
        title: "Appointment confirmed",
        message: `Token #${appt.tokenNumber} confirmed for ${appt.appointmentDate.toISOString().slice(0, 10)}`,
        relatedEntityType: "Appointment",
        relatedEntityId: id,
      });
    }

    return updated;
  },

  async reschedule(actor: AccessTokenPayload, id: string, appointmentDate: string, timeSlot: string, req?: Request) {
    const appt = await prisma.appointment.findUnique({ where: { id } });
    if (!appt) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appt.doctorId);
    const actorId = actor.sub;
    if (!["PENDING_APPROVAL", "CONFIRMED"].includes(appt.status)) {
      throw new ConflictError("Only pending or confirmed appointments can be rescheduled");
    }

    const date = new Date(appointmentDate);

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const tokenNumber = await generateTokenNumber(tx, appt.doctorId, date);
        return tx.appointment.update({
          where: { id },
          data: { appointmentDate: date, timeSlot, tokenNumber, status: "PENDING_APPROVAL" },
        });
      });

      await writeAuditLog({
        userId: actorId,
        action: "UPDATE",
        module: "appointments",
        entityType: "Appointment",
        entityId: id,
        oldValues: { appointmentDate: appt.appointmentDate, timeSlot: appt.timeSlot },
        newValues: { appointmentDate: date, timeSlot },
        req,
      });
      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This doctor already has an appointment booked for that date and time slot");
      }
      throw err;
    }
  },

  async approve(actor: AccessTokenPayload, id: string, req?: Request) {
    return this.transitionStatus(actor, id, "CONFIRMED", {}, req);
  },

  async reject(actor: AccessTokenPayload, id: string, rejectionReason: string, req?: Request) {
    return this.transitionStatus(actor, id, "CANCELLED", { rejectionReason }, req);
  },

  async cancel(actor: AccessTokenPayload, id: string, reason: string | undefined, req?: Request) {
    const appt = await prisma.appointment.findUnique({ where: { id } });
    if (!appt) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appt.doctorId);
    const actorId = actor.sub;
    if (["DONE", "CANCELLED", "NO_SHOW"].includes(appt.status)) {
      throw new ConflictError(`Appointment already in terminal state: ${appt.status}`);
    }
    const updated = await prisma.appointment.update({ where: { id }, data: { status: "CANCELLED", rejectionReason: reason } });
    await writeAuditLog({ userId: actorId, action: "STATUS_CHANGE", module: "appointments", entityType: "Appointment", entityId: id, oldValues: { status: appt.status }, newValues: { status: "CANCELLED" }, req });
    return updated;
  },

  async markDone(actor: AccessTokenPayload, id: string, req?: Request) {
    return this.transitionStatus(actor, id, "DONE", {}, req);
  },

  async markNoShow(actor: AccessTokenPayload, id: string, req?: Request) {
    return this.transitionStatus(actor, id, "NO_SHOW", {}, req);
  },

  async startConsultation(actor: AccessTokenPayload, id: string, req?: Request) {
    return this.transitionStatus(actor, id, "IN_CONSULTATION", {}, req);
  },

  /** OPD queue: derived view where status IN (CONFIRMED, WAITING) */
  async opdQueue(date?: string) {
    return prisma.appointment.findMany({
      where: {
        status: { in: ["CONFIRMED", "WAITING"] },
        ...(date ? { appointmentDate: new Date(date) } : {}),
      },
      orderBy: [{ priority: "desc" }, { tokenNumber: "asc" }],
      include: { patient: true, doctor: { include: { user: true } } },
    });
  },

  async callNext(actor: AccessTokenPayload, doctorId: string, req?: Request) {
    await assertDoctorOwns(actor, doctorId);
    const next = await prisma.appointment.findFirst({
      where: { doctorId, status: { in: ["CONFIRMED", "WAITING"] } },
      orderBy: [{ priority: "desc" }, { tokenNumber: "asc" }],
    });
    if (!next) throw new NotFoundError("No patients waiting in queue for this doctor");
    return this.transitionStatus(actor, next.id, "WAITING", {}, req);
  },

  async requeue(actor: AccessTokenPayload, id: string, req?: Request) {
    const appt = await prisma.appointment.findUnique({ where: { id } });
    if (!appt) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appt.doctorId);
    const actorId = actor.sub;
    if (appt.status !== "WAITING") throw new BadRequestError("Only waiting appointments can be requeued");
    const updated = await prisma.appointment.update({ where: { id }, data: { status: "CONFIRMED", waitingSince: null } });
    await writeAuditLog({ userId: actorId, action: "STATUS_CHANGE", module: "opd-queue", entityType: "Appointment", entityId: id, newValues: { status: "CONFIRMED" }, req });
    return updated;
  },

  async getAvailableSlots(doctorId: string, date: string) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new NotFoundError("Doctor not found");
    if (!doctor.scheduleJson) throw new BadRequestError("Doctor has no schedule configured");

    const schedule = doctor.scheduleJson as any;
    const slotsPerDay = schedule.slotsPerDay || [];
    const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(date));
    const isDayOff = (schedule.daysOff || []).includes(dayName);

    // Get all booked slots for this doctor on this date (excluding cancelled)
    const bookedAppointments = await prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: new Date(date),
        status: { not: "CANCELLED" },
      },
      select: { timeSlot: true },
    });

    const bookedSlots = new Set(bookedAppointments.map((a) => a.timeSlot));
    const availableSlots = isDayOff ? [] : slotsPerDay.filter((slot: string) => !bookedSlots.has(slot));

    return { slotsPerDay, bookedSlots: Array.from(bookedSlots), availableSlots };
  },
};
