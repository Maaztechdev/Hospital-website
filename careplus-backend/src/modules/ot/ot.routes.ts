import { z } from "zod";
import { Request, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { notifyUser } from "@common/utils/notify";
import { AccessTokenPayload, authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import { assertDoctorOwns, assertPatientAccess, getActorDoctorId } from "@common/utils/recordAuthorization";
import { HOSPITAL_TIME_ZONE, isFutureSurgeryStart, PAST_SURGERY_START_MESSAGE } from "./ot.time";

// ── Validators ──────────────────────────────────────────────

const scheduleSurgerySchema = z.object({
  patientId: z.string().uuid(),
  otRoomId: z.string().uuid(),
  surgeryType: z.string().min(1),
  priority: z.enum(["ELECTIVE", "URGENT", "EMERGENCY"]).default("ELECTIVE"),
  anesthesiaType: z.string().trim().min(1).max(100),
  surgeonId: z.string().uuid(),
  assistantSurgeonId: z.string().uuid().optional(),
  anesthetistId: z.string().uuid().optional(),
  scheduledStart: z.string().datetime({ offset: true }),
  scheduledEnd: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).optional(),
  preOpChecklist: z.object({
    consentSigned: z.boolean(),
    npoConfirmed: z.boolean(),
    labsDone: z.boolean(),
    bloodArranged: z.boolean(),
  }).optional(),
});

const availabilityQuerySchema = scheduleSurgerySchema.pick({
  patientId: true,
  otRoomId: true,
  surgeonId: true,
  scheduledStart: true,
  scheduledEnd: true,
  priority: true,
});

const checklistSchema = z.object({
  consent_form_confirmed: z.boolean().optional(),
  fasting_confirmed: z.boolean().optional(),
  blood_arranged: z.boolean().optional(),
  identity_verified: z.boolean().optional(),
  allergies_checked: z.boolean().optional(),
  pre_op_vitals_recorded: z.boolean().optional(),
  required_reports_reviewed: z.boolean().optional(),
});

const completeSurgerySchema = z.object({
  postOpNotes: z.string().trim().min(1, "Post-op notes are required"),
  complications: z.string().optional(),
});
const startSurgerySchema = z.object({ emergencyOverrideReason: z.string().trim().min(1).max(2000).optional() });
const recoverySurgerySchema = z.object({
  intraoperativeNotes: z.string().trim().min(1, "Intra-operative notes are required"),
  outcomeNotes: z.string().trim().min(1, "Outcome notes are required"),
});
const postponeSurgerySchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  scheduledStart: z.string().datetime({ offset: true }),
  scheduledEnd: z.string().datetime({ offset: true }),
});

const idParamSchema = z.object({ id: z.string().uuid() });
const roomInputSchema = z.object({ name: z.string().trim().min(1), isActive: z.boolean().default(true) });
const roomsQuerySchema = z.object({ includeInactive: z.enum(["true", "false"]).optional() });

// ── Service ─────────────────────────────────────────────────

const REQUIRED_CHECKLIST_KEYS = [
  "consent_form_confirmed",
  "fasting_confirmed",
  "blood_arranged",
  "required_reports_reviewed",
];
const ACTIVE_STATUSES: Prisma.EnumOTStatusFilter<"Surgery"> = {
  notIn: ["CANCELLED", "COMPLETED", "POSTPONED"],
};

function getHospitalDayBounds(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HOSPITAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const key = `${value("year")}-${value("month")}-${value("day")}`;
  const start = new Date(`${key}T00:00:00+05:00`);
  return { key, start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}

async function assertSurgeryActor(actor: AccessTokenPayload, surgery: {
  surgeonId: string;
  assistantSurgeonId: string | null;
}) {
  if (actor.role === "ADMIN") return;
  if (actor.role !== "DOCTOR") throw new ForbiddenError("Only the assigned surgeon, assistant surgeon, or an admin may change surgery status");
  const doctorId = await getActorDoctorId(actor);
  if (doctorId !== surgery.surgeonId && doctorId !== surgery.assistantSurgeonId) {
    throw new ForbiddenError("Only the assigned surgeon, assistant surgeon, or an admin may change surgery status");
  }
}

async function assertChecklistActor(actor: AccessTokenPayload, surgery: {
  surgeonId: string;
  assistantSurgeonId: string | null;
}) {
  if (actor.role === "ADMIN" || actor.role === "NURSE") return;
  await assertSurgeryActor(actor, surgery);
}

async function recordSurgeryTransition(
  actor: AccessTokenPayload,
  surgery: { id: string; status: Prisma.SurgeryGetPayload<object>["status"] },
  toStatus: Prisma.SurgeryGetPayload<object>["status"],
  data: Prisma.SurgeryUpdateInput,
  req?: Request,
  reason?: string,
  guard?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const user = await prisma.user.findUnique({ where: { id: actor.sub }, select: { name: true } });
  if (!user) throw new UnauthorizedError();
  try {
    return await prisma.$transaction(async (tx) => {
    if (guard) await guard(tx);
    const changed = await tx.surgery.updateMany({ where: { id: surgery.id, status: surgery.status }, data });
    if (changed.count !== 1) throw new ConflictError("Surgery status changed; refresh and try again");
    const record = await tx.surgery.findUniqueOrThrow({ where: { id: surgery.id } });
    await tx.surgeryStatusEvent.create({
      data: {
        surgeryId: surgery.id,
        fromStatus: surgery.status,
        toStatus,
        changedBy: actor.sub,
        actorName: user.name,
        reason: reason ?? null,
      },
    });
    await writeAuditLog({
      userId: actor.sub,
      action: "STATUS_CHANGE",
      module: "ot",
      entityType: "Surgery",
      entityId: surgery.id,
      oldValues: { status: surgery.status },
      newValues: { status: toStatus, ...(reason ? { reason } : {}) },
      req,
    }, tx);
    await notifySurgeryParticipants(surgery.id, `${surgery.id} status changed to ${toStatus.replaceAll("_", " ")}`, tx);
    return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new ConflictError("Surgery status or OT room changed; refresh and try again");
    }
    throw error;
  }
}

async function notifySurgeryParticipants(
  surgeryId: string,
  message: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const surgery = await tx.surgery.findUnique({
    where: { id: surgeryId },
    select: {
      id: true,
      surgeryType: true,
      surgeon: { select: { userId: true } },
      assistantSurgeon: { select: { userId: true } },
      anesthetist: { select: { userId: true } },
    },
  });
  if (!surgery) return;
  const otStaff = await tx.user.findMany({
    where: { role: { in: ["ADMIN", "NURSE"] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  const userIds = new Set([
    surgery.surgeon.userId,
    surgery.assistantSurgeon?.userId,
    surgery.anesthetist?.userId,
    ...otStaff.map((user) => user.id),
  ].filter((id): id is string => Boolean(id)));
  await Promise.all([...userIds].map((userId) => notifyUser({
    userId,
    notificationType: "OT_STATUS_CHANGED",
    title: "Surgery status updated",
    message: `${surgery.surgeryType}: ${message}`,
    relatedEntityType: "Surgery",
    relatedEntityId: surgery.id,
  }), tx));
}

function mapStatusEvents(events: Array<{
  id: string; fromStatus: string | null; toStatus: string; changedBy: string; actorName: string; reason: string | null; createdAt: Date;
}>) {
  return events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() }));
}

const serializeRoom = (room: { id: string; roomName: string; isActive: boolean }) => ({ id: room.id, name: room.roomName, isActive: room.isActive });
const serializeSurgery = <T extends { otRoom: { roomName: string } }>(surgery: T) => {
  const { roomName, ...room } = surgery.otRoom;
  const events = "statusEvents" in surgery && Array.isArray(surgery.statusEvents)
    ? mapStatusEvents(surgery.statusEvents as Parameters<typeof mapStatusEvents>[0])
    : [];
  return { ...surgery, statusEvents: events, otRoom: { ...room, name: roomName } };
};

function validateScheduleWindow(input: Pick<z.infer<typeof scheduleSurgerySchema>, "scheduledStart" | "scheduledEnd" | "priority">) {
  const start = new Date(input.scheduledStart);
  const end = new Date(input.scheduledEnd);
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration % (15 * 60_000) !== 0) {
    throw new ValidationError("Surgery duration must be a positive multiple of 15 minutes");
  }
  if (!isFutureSurgeryStart(start)) throw new ValidationError(PAST_SURGERY_START_MESSAGE);

  if (input.priority !== "EMERGENCY") {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: HOSPITAL_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(start);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    const startMinutes = hour * 60 + minute;
    const endParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: HOSPITAL_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(end);
    const endMinutes = Number(endParts.find((part) => part.type === "hour")?.value) * 60
      + Number(endParts.find((part) => part.type === "minute")?.value);
    if (startMinutes < 8 * 60 || endMinutes > 20 * 60 || endMinutes <= startMinutes) {
      throw new ValidationError("Only Emergency surgeries may be scheduled outside 08:00-20:00 Pakistan time");
    }
  }
  return { start, end };
}

type ScheduleConflict = {
  kind: "room" | "surgeon" | "patient";
  surgery: {
    surgeryType: string;
    scheduledStart: Date;
    patient: { firstName: string; lastName: string };
    otRoom: { roomName: string };
    surgeon: { user: { name: string } };
  };
};

async function findScheduleConflict(input: {
  patientId: string;
  otRoomId: string;
  surgeonId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  excludeSurgeryId?: string;
}): Promise<ScheduleConflict | null> {
  const timeOverlap = {
    status: ACTIVE_STATUSES,
    scheduledStart: { lt: input.scheduledEnd },
    scheduledEnd: { gt: input.scheduledStart },
    ...(input.excludeSurgeryId ? { id: { not: input.excludeSurgeryId } } : {}),
  };
  const include = {
    patient: { select: { firstName: true, lastName: true } },
    otRoom: { select: { roomName: true } },
    surgeon: { select: { user: { select: { name: true } } } },
  } satisfies Prisma.SurgeryInclude;
  const [room, surgeon, patient] = await Promise.all([
    prisma.surgery.findFirst({ where: { ...timeOverlap, otRoomId: input.otRoomId }, include }),
    prisma.surgery.findFirst({ where: { ...timeOverlap, surgeonId: input.surgeonId }, include }),
    prisma.surgery.findFirst({ where: { ...timeOverlap, patientId: input.patientId }, include }),
  ]);
  if (room) return { kind: "room", surgery: room };
  if (surgeon) return { kind: "surgeon", surgery: surgeon };
  if (patient) return { kind: "patient", surgery: patient };
  return null;
}

const otService = {
  async listRooms(includeInactive = false) {
    const rooms = await prisma.otRoom.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { roomName: "asc" } });
    return rooms.map(serializeRoom);
  },

  async createRoom(actor: AccessTokenPayload, input: { name: string; isActive: boolean }, req?: Request) {
    const duplicate = await prisma.otRoom.findFirst({ where: { roomName: input.name } });
    if (duplicate) throw new ConflictError("OT room name must be unique");
    const room = await prisma.otRoom.create({ data: { roomName: input.name, isActive: input.isActive } });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "ot", entityType: "OtRoom", entityId: room.id, newValues: room, req });
    return serializeRoom(room);
  },

  async updateRoom(actor: AccessTokenPayload, id: string, input: { name: string; isActive: boolean }, req?: Request) {
    const existing = await prisma.otRoom.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("OT room not found");
    const duplicate = await prisma.otRoom.findFirst({ where: { roomName: input.name, NOT: { id } } });
    if (duplicate) throw new ConflictError("OT room name must be unique");
    const room = await prisma.otRoom.update({ where: { id }, data: { roomName: input.name, isActive: input.isActive } });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "ot", entityType: "OtRoom", entityId: id, oldValues: existing, newValues: room, req });
    return serializeRoom(room);
  },

  async deleteRoom(actor: AccessTokenPayload, id: string, req?: Request) {
    const existing = await prisma.otRoom.findUnique({ where: { id }, include: { surgeries: { select: { id: true } } } });
    if (!existing) throw new NotFoundError("OT room not found");
    const room = existing.surgeries.length
      ? await prisma.otRoom.update({ where: { id }, data: { isActive: false } })
      : await prisma.otRoom.delete({ where: { id } });
    await writeAuditLog({ userId: actor.sub, action: "DELETE", module: "ot", entityType: "OtRoom", entityId: id, oldValues: existing, newValues: room, req });
    return serializeRoom(room);
  },

  async list(actor: AccessTokenPayload, params: { skip: number; limit: number; status?: string; otRoomId?: string; date?: string }) {
    const doctorId = await getActorDoctorId(actor);
    const dateBounds = params.date ? getHospitalDayBounds(new Date(`${params.date}T12:00:00+05:00`)) : null;
    const where: Prisma.SurgeryWhereInput = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.otRoomId ? { otRoomId: params.otRoomId } : {}),
      ...(params.date
        ? {
            scheduledStart: {
              gte: dateBounds!.start,
              lt: dateBounds!.end,
            },
          }
        : {}),
      ...(doctorId ? { OR: [{ surgeonId: doctorId }, { assistantSurgeonId: doctorId }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.surgery.findMany({ where, skip: params.skip, take: params.limit, include: { patient: true, otRoom: true, surgeon: { include: { user: true } }, assistantSurgeon: { include: { user: true } }, anesthetist: { include: { user: true } }, statusEvents: { orderBy: { createdAt: "asc" } } }, orderBy: { scheduledStart: "asc" } }),
      prisma.surgery.count({ where }),
    ]);
    return { items: items.map(serializeSurgery), total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const surgery = await prisma.surgery.findUnique({ where: { id }, include: { patient: true, otRoom: true, surgeon: { include: { user: true } }, assistantSurgeon: { include: { user: true } }, anesthetist: { include: { user: true } }, statusEvents: { orderBy: { createdAt: "asc" } } } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    if (actor.role === "DOCTOR") await assertSurgeryActor(actor, surgery);
    return serializeSurgery(surgery);
  },

  async summary() {
    const { start, end } = getHospitalDayBounds();
    const [todayCount, todayForConflicts, inProgress, completedToday] = await Promise.all([
      prisma.surgery.count({ where: { scheduledStart: { gte: start, lt: end }, status: { notIn: ["CANCELLED", "POSTPONED"] } } }),
      prisma.surgery.findMany({
        where: { scheduledStart: { gte: start, lt: end }, status: ACTIVE_STATUSES },
        select: { id: true, otRoomId: true, scheduledStart: true, scheduledEnd: true },
      }),
      prisma.surgery.count({ where: { status: "IN_PROGRESS" } }),
      prisma.surgery.count({ where: { status: "COMPLETED", actualEndAt: { gte: start, lt: end } } }),
    ]);
    const conflictIds = new Set<string>();
    for (let i = 0; i < todayForConflicts.length; i += 1) {
      for (let j = i + 1; j < todayForConflicts.length; j += 1) {
        const first = todayForConflicts[i];
        const second = todayForConflicts[j];
        if (first.otRoomId === second.otRoomId
          && first.scheduledStart < second.scheduledEnd
          && first.scheduledEnd > second.scheduledStart) {
          conflictIds.add(first.id);
          conflictIds.add(second.id);
        }
      }
    }
    return { todaysSurgeries: todayCount, inProgress, completedToday, conflicts: conflictIds.size };
  },

  /** Schedules surgery, checking for OT room and surgeon double-booking within the same window. */
  async schedule(actor: AccessTokenPayload, input: z.infer<typeof scheduleSurgerySchema>, req?: Request) {
    const { start, end } = validateScheduleWindow(input);
    await assertDoctorOwns(actor, input.surgeonId, "You can only schedule surgeries for yourself");
    await assertPatientAccess(actor, input.patientId);

    const conflict = await findScheduleConflict({ ...input, scheduledStart: start, scheduledEnd: end });
    if (conflict) {
      const messages = {
        room: `${conflict.surgery.otRoom.roomName} is already booked at that time`,
        surgeon: "Surgeon already has an overlapping surgery scheduled",
        patient: "Patient already has an overlapping surgery scheduled",
      };
      throw new ConflictError(messages[conflict.kind]);
    }

    const surgery = await prisma.surgery.create({
      data: {
        patientId: input.patientId,
        otRoomId: input.otRoomId,
        surgeryType: input.surgeryType,
        priority: input.priority,
        anesthesiaType: input.anesthesiaType,
        surgeonId: input.surgeonId,
        assistantSurgeonId: input.assistantSurgeonId,
        anesthetistId: input.anesthetistId,
        scheduledStart: start,
        scheduledEnd: end,
        notes: input.notes,
        preOpChecklistJson: {
          consent_form_confirmed: input.preOpChecklist?.consentSigned ?? false,
          fasting_confirmed: input.preOpChecklist?.npoConfirmed ?? false,
          required_reports_reviewed: input.preOpChecklist?.labsDone ?? false,
          blood_arranged: input.preOpChecklist?.bloodArranged ?? false,
          identity_verified: false,
          allergies_checked: false,
          pre_op_vitals_recorded: false,
        },
        createdBy: actor.sub,
      },
    });

    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "ot", entityType: "Surgery", entityId: surgery.id, newValues: surgery, req });
    return surgery;
  },

  async updateChecklist(actor: AccessTokenPayload, id: string, patch: Record<string, boolean>, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertChecklistActor(actor, surgery);
    if (!["SCHEDULED", "PRE_OP"].includes(surgery.status)) {
      throw new ConflictError(`Cannot update checklist — surgery is ${surgery.status}; checklist is locked after pre-op`);
    }

    const merged = { ...(surgery.preOpChecklistJson as Record<string, boolean>), ...patch };
    const updated = await prisma.surgery.update({ where: { id }, data: { preOpChecklistJson: merged } });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "ot", entityType: "Surgery", entityId: id, newValues: { checklist: merged }, req });
    return updated;
  },

  async markPreOp(actor: AccessTokenPayload, id: string, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertSurgeryActor(actor, surgery);
    if (surgery.status !== "SCHEDULED") throw new ConflictError(`Cannot move surgery to pre-op from status ${surgery.status}`);
    if (getHospitalDayBounds(surgery.scheduledStart).key !== getHospitalDayBounds().key) {
      throw new ConflictError("Pre-op can only start on the scheduled surgery day (hospital time: Asia/Karachi)");
    }
    const now = new Date();
    return recordSurgeryTransition(actor, surgery, "PRE_OP", {
      status: "PRE_OP",
      preOpStartedAt: now,
      preOpStartedBy: actor.sub,
    }, req);
  },

  async start(actor: AccessTokenPayload, id: string, input: z.infer<typeof startSurgerySchema>, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id }, include: { surgeon: true } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertSurgeryActor(actor, surgery);
    if (surgery.status !== "PRE_OP") {
      throw new ConflictError(`Cannot start surgery from status ${surgery.status}`);
    }

    const checklist = surgery.preOpChecklistJson as Record<string, boolean>;
    const incomplete = REQUIRED_CHECKLIST_KEYS.filter((k) => !checklist?.[k]);
    const overrideReason = input.emergencyOverrideReason?.trim();
    if (incomplete.length > 0 && (surgery.priority !== "EMERGENCY" || !overrideReason)) {
      await notifyUser({
        userId: surgery.surgeon.userId,
        notificationType: "OT_CHECKLIST_INCOMPLETE",
        title: "Pre-op checklist incomplete",
        message: `Cannot start surgery — missing: ${incomplete.join(", ")}`,
        relatedEntityType: "Surgery",
        relatedEntityId: id,
      });
      throw new ConflictError(surgery.priority === "EMERGENCY"
        ? `Emergency override requires a written reason; checklist incomplete: ${incomplete.join(", ")}`
        : `Pre-op checklist incomplete: ${incomplete.join(", ")}`);
    }
    const roomConflict = await prisma.surgery.findFirst({
      where: { id: { not: id }, otRoomId: surgery.otRoomId, status: "IN_PROGRESS" },
      include: { patient: { select: { firstName: true, lastName: true } } },
    });
    if (roomConflict) {
      throw new ConflictError(`OT room is already in use by ${roomConflict.surgeryType} for ${roomConflict.patient.firstName} ${roomConflict.patient.lastName} (surgery ${roomConflict.id})`);
    }
    const now = new Date();
    return recordSurgeryTransition(actor, surgery, "IN_PROGRESS", {
      status: "IN_PROGRESS",
      actualStart: now,
      actualStartAt: now,
      startedBy: actor.sub,
      emergencyOverrideReason: incomplete.length ? overrideReason : null,
    }, req, incomplete.length ? overrideReason : undefined, async (tx) => {
      const activeRoomCase = await tx.surgery.findFirst({
        where: { id: { not: id }, otRoomId: surgery.otRoomId, status: "IN_PROGRESS" },
        include: { patient: { select: { firstName: true, lastName: true } } },
      });
      if (activeRoomCase) {
        throw new ConflictError(`OT room is already in use by ${activeRoomCase.surgeryType} for ${activeRoomCase.patient.firstName} ${activeRoomCase.patient.lastName} (surgery ${activeRoomCase.id})`);
      }
    });
  },

  async moveToRecovery(actor: AccessTokenPayload, id: string, input: z.infer<typeof recoverySurgerySchema>, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertSurgeryActor(actor, surgery);
    if (surgery.status !== "IN_PROGRESS") throw new ConflictError("Only IN_PROGRESS surgeries can move to recovery");
    const now = new Date();
    return recordSurgeryTransition(actor, surgery, "RECOVERY", {
      status: "RECOVERY",
      actualEnd: now,
      actualEndAt: now,
      endedBy: actor.sub,
      intraoperativeNotes: input.intraoperativeNotes,
      outcomeNotes: input.outcomeNotes,
    }, req);
  },

  async complete(actor: AccessTokenPayload, id: string, input: { postOpNotes?: string; complications?: string }, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertSurgeryActor(actor, surgery);
    if (surgery.status !== "RECOVERY") {
      throw new ConflictError(`Cannot complete surgery from status ${surgery.status}`);
    }
    return recordSurgeryTransition(actor, surgery, "COMPLETED", {
      status: "COMPLETED",
      postOpNotes: input.postOpNotes,
      complications: input.complications,
    }, req);
  },

  async cancel(actor: AccessTokenPayload, id: string, reason: string, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertSurgeryActor(actor, surgery);
    if (!["SCHEDULED", "PRE_OP"].includes(surgery.status)) throw new ConflictError(`Cannot cancel surgery from status ${surgery.status}`);
    return recordSurgeryTransition(actor, surgery, "CANCELLED", {
      status: "CANCELLED",
      complications: reason,
    }, req, reason);
  },

  async postpone(actor: AccessTokenPayload, id: string, input: z.infer<typeof postponeSurgerySchema>, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertSurgeryActor(actor, surgery);
    if (!["SCHEDULED", "PRE_OP"].includes(surgery.status)) throw new ConflictError(`Cannot postpone surgery from status ${surgery.status}`);
    const { start, end } = validateScheduleWindow({
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      priority: surgery.priority,
    });
    const conflict = await findScheduleConflict({
      patientId: surgery.patientId,
      otRoomId: surgery.otRoomId,
      surgeonId: surgery.surgeonId,
      scheduledStart: start,
      scheduledEnd: end,
      excludeSurgeryId: surgery.id,
    });
    if (conflict) throw new ConflictError(`Cannot postpone: ${conflict.kind} has a conflicting surgery`);
    const user = await prisma.user.findUnique({ where: { id: actor.sub }, select: { name: true } });
    if (!user) throw new UnauthorizedError();
    return prisma.$transaction(async (tx) => {
      const rescheduled = await tx.surgery.update({
        where: { id },
        data: { status: "SCHEDULED", scheduledStart: start, scheduledEnd: end, postponeReason: input.reason },
      });
      await tx.surgeryStatusEvent.createMany({
        data: [
          { surgeryId: id, fromStatus: surgery.status, toStatus: "POSTPONED", changedBy: actor.sub, actorName: user.name, reason: input.reason },
          { surgeryId: id, fromStatus: "POSTPONED", toStatus: "SCHEDULED", changedBy: actor.sub, actorName: user.name, reason: `Rescheduled to ${start.toISOString()}` },
        ],
      });
      await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "ot", entityType: "Surgery", entityId: id, oldValues: { status: surgery.status }, newValues: { status: "POSTPONED", reason: input.reason }, req }, tx);
      await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "ot", entityType: "Surgery", entityId: id, oldValues: { status: "POSTPONED" }, newValues: { status: "SCHEDULED", scheduledStart: start, scheduledEnd: end }, req }, tx);
      await notifySurgeryParticipants(id, "surgery postponed and rescheduled", tx);
      return rescheduled;
    });
  },
};

// ── Routes ──────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

router.get("/rooms", validate({ query: roomsQuerySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, 200, { data: await otService.listRooms(req.query.includeInactive === "true") })));
router.post("/rooms", requireRole(["ADMIN"]), validate({ body: roomInputSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  sendSuccess(res, 201, { data: await otService.createRoom(req.user, req.body, req), message: "OT room created" });
}));
router.patch("/rooms/:id", requireRole(["ADMIN"]), validate({ params: idParamSchema, body: roomInputSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  sendSuccess(res, 200, { data: await otService.updateRoom(req.user, req.params.id, req.body, req), message: "OT room updated" });
}));
router.delete("/rooms/:id", requireRole(["ADMIN"]), validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  sendSuccess(res, 200, { data: await otService.deleteRoom(req.user, req.params.id, req), message: "OT room removed" });
}));

router.get(
  "/surgeries/summary",
  requireRole(["ADMIN", "DOCTOR", "NURSE"]),
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await otService.summary() });
  })
);

router.get(
  "/surgeries",
  requireRole(["ADMIN", "DOCTOR", "NURSE"]),
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(100, parseInt(String(req.query.limit ?? "20"), 10) || 20);
    const { status, otRoomId, date } = req.query as Record<string, string | undefined>;
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await otService.list(req.user, { skip: (page - 1) * limit, limit, status, otRoomId, date });
    sendSuccess(res, 200, { data: items, pagination: { page, limit, total } });
  })
);

router.get(
  "/surgeries/availability",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ query: availabilityQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const input = req.query as z.infer<typeof availabilityQuerySchema>;
    const { start, end } = validateScheduleWindow(input);
    if (req.user.role === "DOCTOR" && (await getActorDoctorId(req.user)) !== input.surgeonId) {
      throw new ForbiddenError("You can only check availability for your own surgeries");
    }
    await assertPatientAccess(req.user, input.patientId);
    const conflict = await findScheduleConflict({ ...input, scheduledStart: start, scheduledEnd: end });
    sendSuccess(res, 200, {
      data: conflict
        ? {
            available: false,
            message: conflict.kind === "room"
              ? `${conflict.surgery.otRoom.roomName} is already booked`
              : conflict.kind === "surgeon"
                ? `${conflict.surgery.surgeon.user.name} has another surgery at this time`
                : `${conflict.surgery.patient.firstName} ${conflict.surgery.patient.lastName} is already booked`,
            surgeryType: conflict.surgery.surgeryType,
            scheduledStart: conflict.surgery.scheduledStart,
          }
        : { available: true },
    });
  })
);

router.get("/surgeries/:id", requireRole(["ADMIN", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  sendSuccess(res, 200, { data: await otService.getById(req.user, req.params.id) });
}));

router.post(
  "/surgeries",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ body: scheduleSurgerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await otService.schedule(req.user, req.body, req), message: "Surgery scheduled" });
  })
);

router.patch(
  "/surgeries/:id/checklist",
  requireRole(["ADMIN", "DOCTOR", "NURSE"]),
  validate({ params: idParamSchema, body: checklistSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.updateChecklist(req.user, req.params.id, req.body, req), message: "Checklist updated" });
  })
);

router.post(
  "/surgeries/:id/pre-op",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.markPreOp(req.user, req.params.id, req), message: "Surgery moved to pre-op" });
  })
);

router.post(
  "/surgeries/:id/start",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema, body: startSurgerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.start(req.user, req.params.id, req.body, req), message: "Surgery started" });
  })
);

router.post(
  "/surgeries/:id/recovery",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema, body: recoverySurgerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.moveToRecovery(req.user, req.params.id, req.body, req), message: "Moved to recovery" });
  })
);

router.post(
  "/surgeries/:id/complete",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema, body: completeSurgerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.complete(req.user, req.params.id, req.body, req), message: "Surgery completed" });
  })
);

router.post(
  "/surgeries/:id/cancel",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema, body: z.object({ reason: z.string().trim().min(1).max(2000) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.cancel(req.user, req.params.id, req.body.reason, req), message: "Surgery cancelled" });
  })
);

router.post(
  "/surgeries/:id/postpone",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema, body: postponeSurgerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.postpone(req.user, req.params.id, req.body, req), message: "Surgery postponed and rescheduled" });
  })
);

export default router;
