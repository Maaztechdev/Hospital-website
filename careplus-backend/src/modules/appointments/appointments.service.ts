import { Prisma, AppointmentStatus } from "@prisma/client";
import { Request } from "express";
import { randomUUID } from "crypto";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { notifyUser } from "@common/utils/notify";
import { generateMrNumber, generateNextAppointmentToken } from "@common/utils/sequenceGenerators";
import { PageParams } from "@common/utils/pagination";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { assertDoctorOwns, getActorDoctorId, assertPatientAccess } from "@common/utils/recordAuthorization";
import { assertAppointmentActionAllowed, AppointmentAction } from "./appointmentActions";
import { getUpcomingPastPage } from "./appointmentPagination";
import { applyStaleAppointmentStatuses } from "./staleAppointmentLifecycle";
import { getAppointmentCreationStatus, getPublicAppointmentCreationStatus } from "./appointmentCreationPolicy";


const HOSPITAL_TIMEZONE = "Asia/Karachi";

const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING_APPROVAL: ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["WAITING", "CANCELLED", "NO_SHOW", "EXPIRED"],
  WAITING: ["IN_CONSULTATION", "CANCELLED", "NO_SHOW", "EXPIRED"],
  IN_CONSULTATION: ["DONE"],
  DONE: [],
  CANCELLED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

export function getDateKeyInTimeZone(date: Date, timeZone = HOSPITAL_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getTimeSlotMinutes(slot: string) {
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(slot.trim());
  if (!match) return Number.POSITIVE_INFINITY;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return (hour * 60) + minute;
}

export function isPastTimeSlotForToday(date: string, timeSlot: string, now = new Date()) {
  if (getDateKeyInTimeZone(now) !== date) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: HOSPITAL_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const currentMinutes = (hour * 60) + minute;
  return getTimeSlotMinutes(timeSlot) < currentMinutes;
}

function assertTransition(from: AppointmentStatus, to: AppointmentStatus) {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`Cannot transition appointment from ${from} to ${to}`);
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

export function parseAppointmentDate(value: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestError("Appointment date must be in YYYY-MM-DD format", { appointmentDate: ["Choose a valid date"] });
  }
  const [year, month, day] = normalized.split("-").map(Number);
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    throw new BadRequestError("Appointment date is invalid", { appointmentDate: ["Choose a valid date"] });
  }

  const today = getDateKeyInTimeZone(new Date());
  if (normalized < today) {
    throw new BadRequestError("Appointment date must be today or later", { appointmentDate: ["Choose today or a future date"] });
  }

  return normalized;
}

export function getWeekdayForDateKey(dateKey: string) {
  const [yearValue, month, day] = dateKey.split("-").map(Number);
  const year = yearValue - (month < 3 ? 1 : 0);
  const monthOffsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const weekday = (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + monthOffsets[month - 1] + day) % 7;
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday];
}

function scheduledSlotsForDate(scheduleJson: unknown, dateKey: string) {
  const schedule = scheduleJson as { slotsPerDay?: string[]; slotsByDay?: Record<string, string[]>; daysOff?: string[] };
  const dayName = getWeekdayForDateKey(dateKey);
  const slots = schedule.slotsByDay?.[dayName] ?? schedule.slotsPerDay ?? [];
  return (schedule.daysOff || []).includes(dayName) ? [] : slots;
}

export function assertSlotIsAvailable(scheduleJson: unknown, appointmentDate: string, timeSlot: string, bookedSlots: Set<string>, now = new Date()) {
  const slotsForDate = scheduledSlotsForDate(scheduleJson, appointmentDate);
  if (!slotsForDate.includes(timeSlot)) {
    throw new BadRequestError("Selected time is not available for this doctor", { timeSlot: ["Choose an available time slot"] });
  }
  if (bookedSlots.has(timeSlot)) {
    throw new ConflictError("This doctor already has an appointment booked for that date and time slot");
  }
  if (isPastTimeSlotForToday(appointmentDate, timeSlot, now)) {
    throw new BadRequestError("Selected time has already passed for today", { timeSlot: ["Choose a future time slot"] });
  }
}

async function getBookedSlots(tx: Prisma.TransactionClient | typeof prisma, doctorId: string, date: string, excludeId?: string) {
  const rows = await tx.$queryRaw<Array<{ timeSlot: string }>>`
    SELECT left(time_slot::text, 5) AS "timeSlot"
    FROM appointments
    WHERE doctor_id = ${doctorId}
      AND appointment_date = ${date}::date
      AND status <> 'CANCELLED'::"AppointmentStatus"
      ${excludeId ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
  `;
  return new Set(rows.map((row) => row.timeSlot));
}

export async function serializeAppointmentDateFields<T extends { id: string }>(items: T[]) {
  if (items.length === 0) return [] as Array<Omit<T, "appointmentDate" | "timeSlot"> & { appointmentDate: string; timeSlot: string }>;
  const ids = items.map((item) => item.id);
  const fields = await prisma.$queryRaw<Array<{ id: string; appointmentDate: string; timeSlot: string }>>`
    SELECT id,
      appointment_date::text AS "appointmentDate",
      left(time_slot::text, 5) AS "timeSlot"
    FROM appointments
    WHERE id IN (${Prisma.join(ids)})
  `;
  const dateFields = new Map(fields.map((field) => [field.id, field]));
  return items.map((item) => {
    const fieldsForItem = dateFields.get(item.id);
    if (!fieldsForItem) throw new NotFoundError("Appointment date fields not found");
    return { ...item, ...fieldsForItem };
  }) as Array<Omit<T, "appointmentDate" | "timeSlot"> & { appointmentDate: string; timeSlot: string }>;
}

function isAppointmentUniqueConflict(error: unknown) {
  return (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    || (typeof error === "object" && error !== null && "code" in error && error.code === "23505");
}

export const appointmentsService = {
  async createPublic(input: PublicAppointmentInput, req?: Request) {
    const systemUser = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
    if (!systemUser) throw new NotFoundError("No active system user is available for public bookings");
    const appointmentDate = parseAppointmentDate(input.appointmentDate);
    const initialStatus = getPublicAppointmentCreationStatus();

    const nameParts = input.fullName.trim().split(/\s+/);
    const firstName = nameParts.shift() ?? input.fullName.trim();
    const lastName = nameParts.join(" ") || firstName;
    try {
      const appointment = await prisma.$transaction(async (tx) => {
        const doctor = await tx.doctor.findFirst({ where: { id: input.doctorId, isAvailable: true, department: { status: "ACTIVE" } } });
        if (!doctor || !doctor.isAvailable) throw new NotFoundError("Doctor not found or unavailable");
        if (doctor.departmentId !== input.departmentId) {
          throw new BadRequestError("Selected doctor does not belong to this department", { departmentId: ["Choose the doctor's actual department"] });
        }

        const bookedSlots = await getBookedSlots(tx, input.doctorId, appointmentDate);
        assertSlotIsAvailable(doctor.scheduleJson, appointmentDate, input.timeSlot, bookedSlots);

        const patient = await tx.patient.findFirst({ where: { phone: input.phone, deletedAt: null }, orderBy: { createdAt: "asc" } }) ?? await tx.patient.create({
          data: {
            mrNumber: await generateMrNumber(tx),
            firstName,
            lastName,
            age: input.age,
            gender: "OTHER",
            phone: input.phone,
            email: input.email,
            createdBy: systemUser.id,
          },
        });
        const createdId = randomUUID();
        const nextToken = await generateNextAppointmentToken(tx, input.doctorId, appointmentDate);
        await tx.$executeRaw`
          INSERT INTO appointments (
            id, patient_id, doctor_id, department_id, appointment_date, time_slot, token_number,
            appointment_type, status, source, reason, created_by, created_at, updated_at
          ) VALUES (
            ${createdId}, ${patient.id}, ${input.doctorId}, ${input.departmentId ?? doctor.departmentId},
            ${appointmentDate}::date, ${input.timeSlot}::time, ${nextToken},
            'NEW_VISIT'::"AppointmentType", ${initialStatus}::"AppointmentStatus", 'WEBSITE'::"AppointmentSource",
            ${input.reason ?? null}, ${systemUser.id}, NOW(), NOW()
          )
        `;

        return tx.appointment.findUniqueOrThrow({
          where: { id: createdId },
          include: { patient: true, doctor: { include: { user: true } } },
        });
      });

      const [auditAppointment] = await serializeAppointmentDateFields([appointment]);
      await writeAuditLog({ userId: systemUser.id, action: "CREATE", module: "appointments", entityType: "Appointment", entityId: appointment.id, newValues: auditAppointment, req });
      const isConfirmed = appointment.status === "CONFIRMED";
      await notifyUser({ userId: appointment.doctor.userId, notificationType: isConfirmed ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_PENDING", title: isConfirmed ? "Appointment confirmed" : "New website appointment", message: `Token #${appointment.tokenNumber} for ${input.appointmentDate} ${input.timeSlot}`, relatedEntityType: "Appointment", relatedEntityId: appointment.id });
      return appointment;
    } catch (err) {
      if (isAppointmentUniqueConflict(err)) {
        throw new ConflictError("This doctor already has an appointment booked for that date and time slot");
      }
      throw err;
    }
  },

  async list(actor: AccessTokenPayload, params: PageParams & { date?: string; doctorId?: string; departmentId?: string; status?: string; sort?: "date" | "recentlyCreated" }) {
    await applyStaleAppointmentStatuses();

    const actorDoctorId = await getActorDoctorId(actor);
    const filters: Prisma.Sql[] = [
      Prisma.sql`p.first_name NOT ILIKE '%Lifecycle%' AND p.last_name NOT ILIKE '%Lifecycle%'`,
    ];
    if (params.date) filters.push(Prisma.sql`a.appointment_date = ${params.date}::date`);
    if (params.doctorId) filters.push(Prisma.sql`a.doctor_id = ${params.doctorId}`);
    if (params.departmentId) filters.push(Prisma.sql`a.department_id = ${params.departmentId}`);
    if (params.status) filters.push(Prisma.sql`a.status = ${params.status}::"AppointmentStatus"`);
    if (actorDoctorId) filters.push(Prisma.sql`a.doctor_id = ${actorDoctorId}`);

    const predicate = (extra: Prisma.Sql[] = []) => Prisma.join([...filters, ...extra], " AND ");
    const [count] = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE ${predicate()}
    `);
    const total = count.total;
    const order = params.sort === "recentlyCreated"
      ? Prisma.sql`a.created_at DESC, a.id DESC`
      : Prisma.sql`a.appointment_date ASC, a.time_slot ASC, a.id ASC`;
    const fetchItems = async (ids: string[]) => ids.length === 0 ? [] : prisma.appointment.findMany({
      where: { id: { in: ids } },
      include: { patient: true, doctor: { include: { user: true } } },
    });
    const orderedItems = async (rows: Array<{ id: string }>) => {
      const items = await fetchItems(rows.map((row) => row.id));
      const byId = new Map(items.map((item) => [item.id, item]));
      return rows.map((row) => byId.get(row.id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    };

    if (params.sort === "recentlyCreated") {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT a.id FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE ${predicate()}
        ORDER BY ${order} OFFSET ${params.skip} LIMIT ${params.limit}
      `);
      return { items: await orderedItems(rows), total };
    }

    const today = getDateKeyInTimeZone(new Date());
    const [upcomingCountResult] = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE ${predicate([Prisma.sql`a.appointment_date >= ${today}::date`])}
    `);
    const { upcomingSkip, upcomingTake, pastSkip, pastTake } = getUpcomingPastPage(params.limit, params.skip, upcomingCountResult.total);
    const [upcomingRows, pastRows] = await Promise.all([
      upcomingTake > 0 ? prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT a.id FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE ${predicate([Prisma.sql`a.appointment_date >= ${today}::date`])}
        ORDER BY ${order} OFFSET ${upcomingSkip} LIMIT ${upcomingTake}
      `) : Promise.resolve([]),
      pastTake > 0 ? prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT a.id FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE ${predicate([Prisma.sql`a.appointment_date < ${today}::date`])}
        ORDER BY ${order} OFFSET ${pastSkip} LIMIT ${pastTake}
      `) : Promise.resolve([]),
    ]);

    return { items: [...await orderedItems(upcomingRows), ...await orderedItems(pastRows)], total };
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
    const initialStatus = getAppointmentCreationStatus(actor.role);
    const date = parseAppointmentDate(input.appointmentDate);

    const [patient, doctor] = await Promise.all([
      prisma.patient.findFirst({ where: { id: input.patientId, deletedAt: null } }),
      prisma.doctor.findFirst({ where: { id: input.doctorId, isAvailable: true, department: { status: "ACTIVE" } } }),
    ]);
    if (!patient) throw new NotFoundError("Patient not found");
    if (!doctor) throw new NotFoundError("Doctor not found");

    try {
      const appointment = await prisma.$transaction(async (tx) => {
        const doctor = await tx.doctor.findFirst({ where: { id: input.doctorId, isAvailable: true, department: { status: "ACTIVE" } } });
        if (!doctor) throw new NotFoundError("Doctor not found");

        const bookedSlots = await getBookedSlots(tx, input.doctorId, date);
        assertSlotIsAvailable(doctor.scheduleJson, date, input.timeSlot, bookedSlots);

        const appointmentId = randomUUID();
        const nextToken = await generateNextAppointmentToken(tx, input.doctorId, date);
        await tx.$executeRaw`
          INSERT INTO appointments (
            id, patient_id, doctor_id, department_id, appointment_date, time_slot, token_number,
            appointment_type, status, priority, source, reason, notes, created_by, approved_by, created_at, updated_at
          ) VALUES (
            ${appointmentId}, ${input.patientId}, ${input.doctorId}, ${input.departmentId ?? null},
            ${date}::date, ${input.timeSlot}::time, ${nextToken},
            ${input.appointmentType}::"AppointmentType", ${initialStatus}::"AppointmentStatus",
            ${(input.priority ?? "ROUTINE")}::"Priority", ${(input.source ?? "WALK_IN")}::"AppointmentSource",
            ${input.reason ?? null}, ${input.notes ?? null}, ${actorId}, ${initialStatus === "CONFIRMED" ? actorId : null}, NOW(), NOW()
          )
        `;

        return tx.appointment.findUniqueOrThrow({
          where: { id: appointmentId },
          include: { patient: true, doctor: { include: { user: true } } },
        });
      });

      const [auditAppointment] = await serializeAppointmentDateFields([appointment]);
      await writeAuditLog({ userId: actorId, action: "CREATE", module: "appointments", entityType: "Appointment", entityId: appointment.id, newValues: auditAppointment, req });
      await notifyUser({
        userId: doctor.userId,
        notificationType: appointment.status === "CONFIRMED" ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_PENDING",
        title: appointment.status === "CONFIRMED" ? "Appointment confirmed" : "New appointment pending approval",
        message: `Token #${appointment.tokenNumber} for ${input.appointmentDate} ${input.timeSlot}`,
        relatedEntityType: "Appointment",
        relatedEntityId: appointment.id,
      });
      return appointment;
    } catch (err) {
      if (isAppointmentUniqueConflict(err)) {
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
    req?: Request,
    action?: AppointmentAction
  ) {
    const appt = await prisma.appointment.findUnique({ where: { id }, include: { doctor: true } });
    if (!appt) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appt.doctorId);
    if (action) assertAppointmentActionAllowed(appt.status, action);
    assertTransition(appt.status, to);

    const actorId = actor.sub;
    const data: Prisma.AppointmentUpdateInput = { status: to, ...extra };
    if (to === "WAITING") data.waitingSince = new Date();
    if (to === "CONFIRMED") data.approvedBy = actorId;

    const updated = await prisma.appointment.update({ where: { id }, data });

    await writeAuditLog({
      userId: actorId,
      action: "STATUS_CHANGE",
      module: "appointments",
      entityType: "Appointment",
      entityId: id,
      oldValues: { status: appt.status },
      newValues: { status: to, ...extra, ...(to === "CONFIRMED" ? { approvedBy: actorId } : {}) },
      req,
    });

    if (to === "CONFIRMED") {
      const [dateFields] = await serializeAppointmentDateFields([appt]);
      await notifyUser({
        userId: appt.doctor.userId,
        notificationType: "APPOINTMENT_CONFIRMED",
        title: "Appointment confirmed",
        message: `Token #${appt.tokenNumber} confirmed for ${dateFields.appointmentDate}`,
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
    assertAppointmentActionAllowed(appt.status, "RESCHEDULE");

    const date = parseAppointmentDate(appointmentDate);

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const doctor = await tx.doctor.findUnique({ where: { id: appt.doctorId } });
        if (!doctor) throw new NotFoundError("Doctor not found");

        const bookedSlots = await getBookedSlots(tx, appt.doctorId, date, id);
        assertSlotIsAvailable(doctor.scheduleJson, date, timeSlot, bookedSlots);

        const nextToken = await generateNextAppointmentToken(tx, appt.doctorId, date);
        await tx.$executeRaw`
          UPDATE appointments
          SET appointment_date = ${date}::date,
              time_slot = ${timeSlot}::time,
              token_number = ${nextToken},
              status = 'PENDING_APPROVAL'::"AppointmentStatus",
              approved_by = NULL,
              updated_at = NOW()
          WHERE id = ${id}
        `;
        const moved = await tx.appointment.findUniqueOrThrow({ where: { id } });
        return tx.appointment.findUniqueOrThrow({ where: { id: moved.id } });
      });

      const [oldDateFields] = await serializeAppointmentDateFields([appt]);
      const [newDateFields] = await serializeAppointmentDateFields([updated]);

      await writeAuditLog({
        userId: actorId,
        action: "UPDATE",
        module: "appointments",
        entityType: "Appointment",
        entityId: id,
        oldValues: { appointmentDate: oldDateFields.appointmentDate, timeSlot: oldDateFields.timeSlot },
        newValues: { appointmentDate: newDateFields.appointmentDate, timeSlot: newDateFields.timeSlot },
        req,
      });
      return updated;
    } catch (err) {
      if (isAppointmentUniqueConflict(err)) {
        throw new ConflictError("This doctor already has an appointment booked for that date and time slot");
      }
      throw err;
    }
  },

  async approve(actor: AccessTokenPayload, id: string, req?: Request) {
    return this.transitionStatus(actor, id, "CONFIRMED", {}, req, "APPROVE");
  },

  async reject(actor: AccessTokenPayload, id: string, rejectionReason: string, req?: Request) {
    return this.transitionStatus(actor, id, "CANCELLED", { rejectionReason: rejectionReason?.trim() || "No reason provided" }, req, "REJECT");
  },

  async cancel(actor: AccessTokenPayload, id: string, reason: string | undefined, req?: Request) {
    const appt = await prisma.appointment.findUnique({ where: { id } });
    if (!appt) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appt.doctorId);
    const actorId = actor.sub;
    assertAppointmentActionAllowed(appt.status, "CANCEL");
    const updated = await prisma.appointment.update({ where: { id }, data: { status: "CANCELLED", rejectionReason: reason?.trim() || "No reason provided" } });
    await writeAuditLog({ userId: actorId, action: "STATUS_CHANGE", module: "appointments", entityType: "Appointment", entityId: id, oldValues: { status: appt.status }, newValues: { status: "CANCELLED" }, req });
    return updated;
  },

  async markDone(actor: AccessTokenPayload, id: string, req?: Request) {
    return this.transitionStatus(actor, id, "DONE", {}, req, "COMPLETE");
  },

  async markNoShow(actor: AccessTokenPayload, id: string, req?: Request) {
    return this.transitionStatus(actor, id, "NO_SHOW", {}, req, "MARK_NO_SHOW");
  },

  async startConsultation(actor: AccessTokenPayload, id: string, req?: Request) {
    return this.transitionStatus(actor, id, "IN_CONSULTATION", {}, req, "START_CONSULTATION");
  },

  /** OPD queue: derived view where status IN (CONFIRMED, WAITING) */
  async opdQueue(actor: AccessTokenPayload, date?: string) {
    const doctorId = await getActorDoctorId(actor);
    const dateFilter = date
      ? await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM appointments WHERE appointment_date = ${date}::date`
      : null;
    return prisma.appointment.findMany({
      where: {
        status: { in: ["CONFIRMED", "WAITING"] },
        ...(doctorId ? { doctorId } : {}),
        ...(dateFilter ? { id: { in: dateFilter.map((row) => row.id) } } : {}),
      },
      orderBy: [{ priority: "desc" }, { tokenNumber: "asc" }],
      include: { patient: true, doctor: { include: { user: true } } },
    });
  },

  async callNext(actor: AccessTokenPayload, doctorId: string, req?: Request) {
    await assertDoctorOwns(actor, doctorId);
    const next = await prisma.appointment.findFirst({
      where: { doctorId, status: "CONFIRMED" },
      orderBy: [{ priority: "desc" }, { tokenNumber: "asc" }],
    });
    if (!next) throw new NotFoundError("No patients waiting in queue for this doctor");
    return this.transitionStatus(actor, next.id, "WAITING", {}, req, "CALL_NEXT");
  },

  async requeue(actor: AccessTokenPayload, id: string, req?: Request) {
    const appt = await prisma.appointment.findUnique({ where: { id } });
    if (!appt) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appt.doctorId);
    assertAppointmentActionAllowed(appt.status, "REQUEUE");
    const actorId = actor.sub;
    const updated = await prisma.appointment.update({ where: { id }, data: { status: "CONFIRMED", waitingSince: null } });
    await writeAuditLog({ userId: actorId, action: "STATUS_CHANGE", module: "opd-queue", entityType: "Appointment", entityId: id, newValues: { status: "CONFIRMED" }, req });
    return updated;
  },

  async getAvailableSlots(doctorId: string, date: string) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new NotFoundError("Doctor not found");
    if (!doctor.scheduleJson) throw new BadRequestError("Doctor has no schedule configured");

    const appointmentDate = parseAppointmentDate(date);
    const slotsPerDay = scheduledSlotsForDate(doctor.scheduleJson, appointmentDate);
    const bookedSlots = await getBookedSlots(prisma, doctorId, appointmentDate);
    const availableSlots = slotsPerDay.filter((slot: string) => {
      if (bookedSlots.has(slot)) return false;
      return !(isPastTimeSlotForToday(appointmentDate, slot) && appointmentDate === getDateKeyInTimeZone(new Date()));
    });

    return { slotsPerDay, bookedSlots: Array.from(bookedSlots), availableSlots };
  },
};
