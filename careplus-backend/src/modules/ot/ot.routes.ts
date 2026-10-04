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

// ── Validators ──────────────────────────────────────────────

const scheduleSurgerySchema = z.object({
  patientId: z.string().uuid(),
  otRoomId: z.string().uuid(),
  surgeryType: z.string().min(1),
  priority: z.enum(["ELECTIVE", "URGENT", "EMERGENCY"]).default("ELECTIVE"),
  anesthesiaType: z.string().trim().min(1).max(100).optional(),
  surgeonId: z.string().uuid(),
  assistantSurgeonId: z.string().uuid().optional(),
  anesthetistId: z.string().uuid().optional(),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
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
  postOpNotes: z.string().optional(),
  complications: z.string().optional(),
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

const serializeRoom = (room: { id: string; roomName: string; isActive: boolean }) => ({ id: room.id, name: room.roomName, isActive: room.isActive });
const serializeSurgery = <T extends { otRoom: { roomName: string } }>(surgery: T) => {
  const { roomName, ...room } = surgery.otRoom;
  return { ...surgery, otRoom: { ...room, name: roomName } };
};

function validateScheduleWindow(input: Pick<z.infer<typeof scheduleSurgerySchema>, "scheduledStart" | "scheduledEnd" | "priority">) {
  const start = new Date(input.scheduledStart);
  const end = new Date(input.scheduledEnd);
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration % (15 * 60_000) !== 0) {
    throw new ValidationError("Surgery duration must be a positive multiple of 15 minutes");
  }
  if (start.getTime() < Date.now()) throw new ValidationError("Surgery cannot be scheduled in the past");

  if (input.priority !== "EMERGENCY") {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(start);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    const startMinutes = hour * 60 + minute;
    const endParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
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
}): Promise<ScheduleConflict | null> {
  const activeStatuses: Prisma.EnumOTStatusFilter<"Surgery"> = { notIn: ["CANCELLED", "COMPLETED"] };
  const timeOverlap = {
    status: activeStatuses,
    scheduledStart: { lt: input.scheduledEnd },
    scheduledEnd: { gt: input.scheduledStart },
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
    const where: Prisma.SurgeryWhereInput = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.otRoomId ? { otRoomId: params.otRoomId } : {}),
      ...(params.date
        ? {
            scheduledStart: {
              gte: new Date(`${params.date}T00:00:00.000Z`),
              lt: new Date(`${params.date}T23:59:59.999Z`),
            },
          }
        : {}),
      ...(doctorId ? { surgeonId: doctorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.surgery.findMany({ where, skip: params.skip, take: params.limit, include: { patient: true, otRoom: true, surgeon: { include: { user: true } } }, orderBy: { scheduledStart: "asc" } }),
      prisma.surgery.count({ where }),
    ]);
    return { items: items.map(serializeSurgery), total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const surgery = await prisma.surgery.findUnique({ where: { id }, include: { patient: true, otRoom: true, surgeon: { include: { user: true } }, assistantSurgeon: { include: { user: true } }, anesthetist: { include: { user: true } } } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertDoctorOwns(actor, surgery.surgeonId);
    return serializeSurgery(surgery);
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
    await assertDoctorOwns(actor, surgery.surgeonId);
    if (surgery.status === "COMPLETED" || surgery.status === "CANCELLED") {
      throw new ConflictError(`Cannot update checklist — surgery is ${surgery.status}`);
    }

    const merged = { ...(surgery.preOpChecklistJson as Record<string, boolean>), ...patch };
    const updated = await prisma.surgery.update({ where: { id }, data: { preOpChecklistJson: merged } });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "ot", entityType: "Surgery", entityId: id, newValues: { checklist: merged }, req });
    return updated;
  },

  async markPreOp(actor: AccessTokenPayload, id: string, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertDoctorOwns(actor, surgery.surgeonId);
    if (surgery.status !== "SCHEDULED") throw new ConflictError(`Cannot move surgery to pre-op from status ${surgery.status}`);
    const updated = await prisma.surgery.update({ where: { id }, data: { status: "PRE_OP" } });
    await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "ot", entityType: "Surgery", entityId: id, newValues: { status: "PRE_OP" }, req });
    return updated;
  },

  /** Cannot start surgery (move to IN_PROGRESS) unless all checklist items are true. */
  async start(actor: AccessTokenPayload, id: string, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id }, include: { surgeon: true } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertDoctorOwns(actor, surgery.surgeonId);
    if (!["SCHEDULED", "PRE_OP"].includes(surgery.status)) {
      throw new ConflictError(`Cannot start surgery from status ${surgery.status}`);
    }

    const checklist = surgery.preOpChecklistJson as Record<string, boolean>;
    const incomplete = REQUIRED_CHECKLIST_KEYS.filter((k) => !checklist?.[k]);
    if (incomplete.length > 0) {
      await notifyUser({
        userId: surgery.surgeon.userId,
        notificationType: "OT_CHECKLIST_INCOMPLETE",
        title: "Pre-op checklist incomplete",
        message: `Cannot start surgery — missing: ${incomplete.join(", ")}`,
        relatedEntityType: "Surgery",
        relatedEntityId: id,
      });
      throw new ConflictError(`Pre-op checklist incomplete: ${incomplete.join(", ")}`);
    }

    const updated = await prisma.surgery.update({ where: { id }, data: { status: "IN_PROGRESS", actualStart: new Date() } });
    await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "ot", entityType: "Surgery", entityId: id, newValues: { status: "IN_PROGRESS" }, req });
    return updated;
  },

  async moveToRecovery(actor: AccessTokenPayload, id: string, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertDoctorOwns(actor, surgery.surgeonId);
    if (surgery.status !== "IN_PROGRESS") throw new ConflictError("Only IN_PROGRESS surgeries can move to recovery");

    const updated = await prisma.surgery.update({ where: { id }, data: { status: "RECOVERY" } });
    await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "ot", entityType: "Surgery", entityId: id, newValues: { status: "RECOVERY" }, req });
    return updated;
  },

  async complete(actor: AccessTokenPayload, id: string, input: { postOpNotes?: string; complications?: string }, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertDoctorOwns(actor, surgery.surgeonId);
    if (!["IN_PROGRESS", "RECOVERY"].includes(surgery.status)) {
      throw new ConflictError(`Cannot complete surgery from status ${surgery.status}`);
    }

    const updated = await prisma.surgery.update({
      where: { id },
      data: { status: "COMPLETED", actualEnd: new Date(), postOpNotes: input.postOpNotes, complications: input.complications },
    });
    await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "ot", entityType: "Surgery", entityId: id, newValues: { status: "COMPLETED" }, req });
    return updated;
  },

  async cancel(actor: AccessTokenPayload, id: string, reason: string, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertDoctorOwns(actor, surgery.surgeonId);
    if (["COMPLETED", "CANCELLED"].includes(surgery.status)) throw new ConflictError(`Surgery already ${surgery.status}`);

    const updated = await prisma.surgery.update({ where: { id }, data: { status: "CANCELLED", complications: reason } });
    await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "ot", entityType: "Surgery", entityId: id, newValues: { status: "CANCELLED", reason }, req });
    return updated;
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
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.start(req.user, req.params.id, req), message: "Surgery started" });
  })
);

router.post(
  "/surgeries/:id/recovery",
  requireRole(["ADMIN", "DOCTOR", "NURSE"]),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.moveToRecovery(req.user, req.params.id, req), message: "Moved to recovery" });
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
  validate({ params: idParamSchema, body: z.object({ reason: z.string().min(1) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await otService.cancel(req.user, req.params.id, req.body.reason, req), message: "Surgery cancelled" });
  })
);

export default router;
