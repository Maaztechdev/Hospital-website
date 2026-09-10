import { Request, Response, Router } from "express";
import { z } from "zod";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@config/prisma";
import { env } from "@config/env";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import { writeAuditLog } from "@common/utils/auditLog";
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from "@common/errors/AppError";
import { DepartmentStatus } from "@prisma/client";

const keyParamSchema = z.object({ key: z.string().min(1) });
const currencies = ["PKR", "USD", "AED", "SAR", "GBP", "EUR"] as const;
const hospitalProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  registrationNo: z.string().trim().max(100).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  emergencyContact: z.string().trim().regex(/^\+?[0-9 ()-]{7,25}$/).nullable().optional(),
  taxId: z.string().trim().regex(/^(?:[0-9]{7}|NTN-[0-9]{7})$/i).nullable().optional(),
  currency: z.enum(currencies),
  timezone: z.string().refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid IANA timezone"),
});
const setSettingSchema = z.object({ value: z.unknown() });
const upload = multer({ storage: multer.memoryStorage() });
const profileId = "default";
const departmentIdSchema = z.object({ id: z.string().uuid() });
const departmentStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) });
const departmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  hodId: z.string().uuid().nullable().optional(),
  icon: z.string().trim().max(120).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const departmentInclude = {
  hod: { select: { id: true, user: { select: { name: true } }, specialization: true } },
  _count: { select: { doctors: true, users: true, appointments: true } },
} as const;

async function saveHospitalAsset(file: Express.Multer.File, type: "logo" | "favicon") {
  const maxBytes = type === "logo" ? 2 * 1024 * 1024 : 512 * 1024;
  const allowed = type === "logo" ? ["image/png", "image/jpeg", "image/svg+xml"] : ["image/png", "image/jpeg", "image/svg+xml", "image/x-icon"];
  if (file.size > maxBytes || !allowed.includes(file.mimetype)) throw new BadRequestError("Unsupported hospital asset or file size exceeded");
  const extension = { "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg", "image/x-icon": ".ico" }[file.mimetype];
  const relativePath = path.join("hospital-profile", `${randomUUID()}${extension}`);
  const absolutePath = path.join(path.resolve(env.UPLOAD_DIR), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, file.buffer, { mode: 0o600, flag: "wx" });
  await chmod(absolutePath, 0o600);
  return `/api/v1/files/${relativePath.replace(/\\/g, "/")}`;
}

const router = Router();
router.get("/hospital-profile", asyncHandler(async (_req: Request, res: Response) => {
  const profile = await prisma.hospitalProfile.findUnique({ where: { id: profileId } });
  sendSuccess(res, 200, { data: profile });
}));
router.use(authenticate);

router.get("/departments/available-hods", asyncHandler(async (_req: Request, res: Response) => {
  const doctors = await prisma.doctor.findMany({
    where: { isAvailable: true, user: { isActive: true, deletedAt: null } },
    select: { id: true, specialization: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  sendSuccess(res, 200, { data: doctors.map((doctor) => ({ id: doctor.id, name: doctor.user.name, specialization: doctor.specialization })) });
}));

router.get("/departments", asyncHandler(async (req: Request, res: Response) => {
  const requestedStatus = typeof req.query.status === "string" ? req.query.status : "ALL";
  if (!["ACTIVE", "INACTIVE", "ALL"].includes(requestedStatus)) throw new BadRequestError("status must be ACTIVE, INACTIVE, or ALL");
  const departments = await prisma.department.findMany({
    where: requestedStatus === "ALL" ? undefined : { status: requestedStatus as DepartmentStatus },
    include: departmentInclude,
    orderBy: { name: "asc" },
  });
  sendSuccess(res, 200, { data: departments });
}));

router.post("/departments", requireRole(["ADMIN"]), validate({ body: departmentSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const department = await prisma.department.create({ data: { ...req.body, status: req.body.status as DepartmentStatus }, include: departmentInclude });
  await writeAuditLog({ userId: req.user.sub, action: "CREATE", module: "settings", entityType: "Department", entityId: department.id, newValues: department, req });
  sendSuccess(res, 201, { data: department, message: "Department created" });
}));

router.put("/departments/:id", requireRole(["ADMIN"]), validate({ params: departmentIdSchema, body: departmentSchema.partial().extend({ name: departmentSchema.shape.name.optional() }) }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const department = await prisma.department.update({ where: { id: req.params.id }, data: { ...req.body, status: req.body.status as DepartmentStatus | undefined }, include: departmentInclude }).catch(() => { throw new NotFoundError("Department not found"); });
  await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "Department", entityId: department.id, newValues: department, req });
  sendSuccess(res, 200, { data: department, message: "Department updated" });
}));

router.patch("/departments/:id/status", requireRole(["ADMIN"]), validate({ params: departmentIdSchema, body: departmentStatusSchema }), asyncHandler(async (req: Request, res: Response) => {
  const department = await prisma.department.update({ where: { id: req.params.id }, data: { status: req.body.status as DepartmentStatus }, include: departmentInclude }).catch(() => { throw new NotFoundError("Department not found"); });
  sendSuccess(res, 200, { data: department, message: "Department status updated" });
}));

router.delete("/departments/:id", requireRole(["ADMIN"]), validate({ params: departmentIdSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const department = await prisma.department.findUnique({ where: { id: req.params.id }, include: departmentInclude });
  if (!department) throw new NotFoundError("Department not found");
  if (department._count.doctors || department._count.users || department._count.appointments) throw new ConflictError("Department has active doctors/records — set to Inactive instead");
  await prisma.department.delete({ where: { id: department.id } });
  await writeAuditLog({ userId: req.user.sub, action: "DELETE", module: "settings", entityType: "Department", entityId: department.id, oldValues: department, req });
  sendSuccess(res, 200, { data: null, message: "Department deleted" });
}));

router.put("/hospital-profile", requireRole(["ADMIN"]), validate({ body: hospitalProfileSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const profile = await prisma.hospitalProfile.upsert({ where: { id: profileId }, create: { id: profileId, ...req.body }, update: req.body });
  await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "HospitalProfile", entityId: profileId, newValues: profile, req });
  sendSuccess(res, 200, { data: profile, message: "Hospital profile updated" });
}));

for (const type of ["logo", "favicon"] as const) {
  router.post(`/hospital-profile/${type}`, requireRole(["ADMIN"]), upload.single("file"), asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    if (!req.file) return res.status(400).json({ success: false, message: "A file is required" });
    const url = await saveHospitalAsset(req.file, type);
    const profile = await prisma.hospitalProfile.upsert({ where: { id: profileId }, create: { id: profileId, name: "Khalida Medicare Hospital", [`${type}Url`]: url }, update: { [`${type}Url`]: url } });
    await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "HospitalProfile", entityId: profileId, newValues: { [`${type}Url`]: url }, req });
    sendSuccess(res, 200, { data: profile, message: `${type} uploaded` });
  }));
}

router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await prisma.setting.findMany();
    sendSuccess(res, 200, { data: settings });
  })
);

router.get(
  "/:key",
  validate({ params: keyParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const setting = await prisma.setting.findUnique({ where: { key: req.params.key } });
    sendSuccess(res, 200, { data: setting });
  })
);

/**
 * @openapi
 * /settings/{key}:
 *   put:
 *     tags: [Settings]
 *     summary: Upsert a key/value application setting (admin only)
 *     responses:
 *       200: { description: OK }
 */
router.put(
  "/:key",
  requireRole(["ADMIN"]),
  validate({ params: keyParamSchema, body: setSettingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const setting = await prisma.setting.upsert({
      where: { key: req.params.key },
      create: { key: req.params.key, value: req.body.value as never },
      update: { value: req.body.value as never },
    });
    await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "Setting", entityId: req.params.key, newValues: setting, req });
    sendSuccess(res, 200, { data: setting, message: "Setting updated" });
  })
);

export default router;
