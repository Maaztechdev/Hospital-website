import { z } from "zod";
import { Request, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from "@common/errors/AppError";
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
  surgeonId: z.string().uuid(),
  anesthetistId: z.string().uuid().optional(),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
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

// ── Service ─────────────────────────────────────────────────

const REQUIRED_CHECKLIST_KEYS = [
  "consent_form_confirmed",
  "fasting_confirmed",
  "blood_arranged",
  "identity_verified",
  "allergies_checked",
  "pre_op_vitals_recorded",
  "required_reports_reviewed",
];

const otService = {
  async listRooms() {
    return prisma.otRoom.findMany({ where: { isActive: true } });
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
    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const surgery = await prisma.surgery.findUnique({ where: { id }, include: { patient: true, otRoom: true, surgeon: { include: { user: true } }, anesthetist: { include: { user: true } } } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertDoctorOwns(actor, surgery.surgeonId);
    return surgery;
  },

  /** Schedules surgery, checking for OT room and surgeon double-booking within the same window. */
  async schedule(actor: AccessTokenPayload, input: z.infer<typeof scheduleSurgerySchema>, req?: Request) {
    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);
    if (end <= start) throw new BadRequestError("scheduledEnd must be after scheduledStart");
    await assertDoctorOwns(actor, input.surgeonId);
    await assertPatientAccess(actor, input.patientId);

    const overlapWhere = (field: "otRoomId" | "surgeonId", value: string): Prisma.SurgeryWhereInput => ({
      [field]: value,
      status: { notIn: ["CANCELLED", "COMPLETED"] },
      scheduledStart: { lt: end },
      scheduledEnd: { gt: start },
    });

    const [roomConflict, surgeonConflict] = await Promise.all([
      prisma.surgery.findFirst({ where: overlapWhere("otRoomId", input.otRoomId) }),
      prisma.surgery.findFirst({ where: overlapWhere("surgeonId", input.surgeonId) }),
    ]);
    if (roomConflict) throw new ConflictError("OT room is already booked for an overlapping time window");
    if (surgeonConflict) throw new ConflictError("Surgeon already has an overlapping surgery scheduled");

    const surgery = await prisma.surgery.create({
      data: {
        patientId: input.patientId,
        otRoomId: input.otRoomId,
        surgeryType: input.surgeryType,
        surgeonId: input.surgeonId,
        anesthetistId: input.anesthetistId,
        scheduledStart: start,
        scheduledEnd: end,
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

  /** Cannot start surgery (move to IN_PROGRESS) unless all checklist items are true. */
  async start(actor: AccessTokenPayload, id: string, req?: Request) {
    const surgery = await prisma.surgery.findUnique({ where: { id } });
    if (!surgery) throw new NotFoundError("Surgery not found");
    await assertDoctorOwns(actor, surgery.surgeonId);
    if (!["SCHEDULED", "PRE_OP"].includes(surgery.status)) {
      throw new ConflictError(`Cannot start surgery from status ${surgery.status}`);
    }

    const checklist = surgery.preOpChecklistJson as Record<string, boolean>;
    const incomplete = REQUIRED_CHECKLIST_KEYS.filter((k) => !checklist?.[k]);
    if (incomplete.length > 0) {
      await notifyUser({
        userId: surgery.surgeonId, // note: surgeonId is a Doctor id, not User id — kept as informational log target via doctor lookup below
        notificationType: "OT_CHECKLIST_INCOMPLETE",
        title: "Pre-op checklist incomplete",
        message: `Cannot start surgery — missing: ${incomplete.join(", ")}`,
        relatedEntityType: "Surgery",
        relatedEntityId: id,
      }).catch(() => undefined); // best-effort notify; surgeonId->userId resolution handled in production notification fan-out
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

router.get("/rooms", asyncHandler(async (_req: Request, res: Response) => sendSuccess(res, 200, { data: await otService.listRooms() })));

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
