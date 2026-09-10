import { z } from "zod";
import { Request, Response, Router } from "express";
import { Prisma, ShiftType } from "@prisma/client";
import { prisma } from "@config/prisma";
import { NotFoundError, ConflictError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload, authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import { UnauthorizedError } from "@common/errors/AppError";
import { assertDoctorOwns } from "@common/utils/recordAuthorization";

// ── Validators ──────────────────────────────────────────────

const createAssignmentSchema = z.object({
  nurseUserId: z.string().uuid(),
  wardId: z.string().uuid(),
  shiftDate: z.string().date(),
  shiftType: z.nativeEnum(ShiftType),
});

const recordVitalsSchema = z.object({
  admissionId: z.string().uuid(),
  bpSystolic: z.number().int().optional(),
  bpDiastolic: z.number().int().optional(),
  temperature: z.number().optional(),
  pulse: z.number().int().optional(),
  respiratoryRate: z.number().int().optional(),
  oxygenSaturation: z.number().int().optional(),
  painScore: z.number().int().min(0).max(10).optional(),
  notes: z.string().optional(),
});

const createTaskSchema = z.object({
  admissionId: z.string().uuid(),
  taskDescription: z.string().min(1),
  dueAt: z.string().datetime().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

// ── Service ─────────────────────────────────────────────────

const nursingService = {
  async createAssignment(actor: AccessTokenPayload, input: z.infer<typeof createAssignmentSchema>, req?: Request) {
    const assignment = await prisma.nurseAssignment.create({
      data: { ...input, shiftDate: new Date(input.shiftDate) },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "nursing", entityType: "NurseAssignment", entityId: assignment.id, newValues: assignment, req });
    return assignment;
  },

  async listAssignments(wardId?: string, shiftDate?: string) {
    const where: Prisma.NurseAssignmentWhereInput = {
      isActive: true,
      ...(wardId ? { wardId } : {}),
      ...(shiftDate ? { shiftDate: new Date(shiftDate) } : {}),
    };
    return prisma.nurseAssignment.findMany({ where, include: { nurse: { select: { id: true, name: true, email: true } } } });
  },

  async recordVitals(actor: AccessTokenPayload, input: z.infer<typeof recordVitalsSchema>, req?: Request) {
    const admission = await prisma.admission.findUnique({ where: { id: input.admissionId } });
    if (!admission) throw new NotFoundError("Admission not found");
    if (admission.status !== "ACTIVE") throw new ConflictError("Cannot record vitals for a non-active admission");
    await assertDoctorOwns(actor, admission.attendingDoctorId);

    const vitals = await prisma.patientVitals.create({
      data: { ...input, patientId: admission.patientId, recordedBy: actor.sub },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "nursing", entityType: "PatientVitals", entityId: vitals.id, newValues: vitals, req });
    return vitals;
  },

  async vitalsHistory(actor: AccessTokenPayload, admissionId: string) {
    const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    return prisma.patientVitals.findMany({ where: { admissionId }, orderBy: { recordedAt: "desc" } });
  },

  async createTask(actor: AccessTokenPayload, input: z.infer<typeof createTaskSchema>, req?: Request) {
    const admission = await prisma.admission.findUnique({ where: { id: input.admissionId } });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);

    const task = await prisma.nursingTask.create({
      data: { admissionId: input.admissionId, taskDescription: input.taskDescription, dueAt: input.dueAt ? new Date(input.dueAt) : undefined },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "nursing", entityType: "NursingTask", entityId: task.id, newValues: task, req });
    return task;
  },

  async completeTask(actor: AccessTokenPayload, id: string, req?: Request) {
    const task = await prisma.nursingTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundError("Task not found");
    const admission = await prisma.admission.findUnique({ where: { id: task.admissionId } });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    if (task.status === "COMPLETED") throw new ConflictError("Task already completed");

    const updated = await prisma.nursingTask.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date(), completedBy: actor.sub },
    });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "nursing", entityType: "NursingTask", entityId: id, newValues: { status: "COMPLETED" }, req });
    return updated;
  },

  async listTasks(actor: AccessTokenPayload, admissionId: string) {
    const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    return prisma.nursingTask.findMany({ where: { admissionId }, orderBy: { createdAt: "desc" } });
  },
};

// ── Controller + Routes ─────────────────────────────────────

const router = Router();
router.use(authenticate);

router.post(
  "/assignments",
  requireRole(["ADMIN"]),
  validate({ body: createAssignmentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await nursingService.createAssignment(req.user, req.body, req), message: "Assignment created" });
  })
);

router.get(
  "/assignments",
  asyncHandler(async (req: Request, res: Response) => {
    const { wardId, shiftDate } = req.query as Record<string, string | undefined>;
    sendSuccess(res, 200, { data: await nursingService.listAssignments(wardId, shiftDate) });
  })
);

router.post(
  "/vitals",
  requireRole(["ADMIN", "NURSE", "DOCTOR"]),
  validate({ body: recordVitalsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await nursingService.recordVitals(req.user, req.body, req), message: "Vitals recorded" });
  })
);

router.get(
  "/vitals/:id",
  requireRole(["ADMIN", "NURSE", "DOCTOR"]),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await nursingService.vitalsHistory(req.user, req.params.id) });
  })
);

router.post(
  "/tasks",
  requireRole(["ADMIN", "NURSE", "DOCTOR"]),
  validate({ body: createTaskSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await nursingService.createTask(req.user, req.body, req), message: "Task created" });
  })
);

router.post(
  "/tasks/:id/complete",
  requireRole(["ADMIN", "NURSE"]),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await nursingService.completeTask(req.user, req.params.id, req), message: "Task completed" });
  })
);

router.get(
  "/tasks/:id",
  requireRole(["ADMIN", "NURSE", "DOCTOR"]),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await nursingService.listTasks(req.user, req.params.id) });
  })
);

export default router;
