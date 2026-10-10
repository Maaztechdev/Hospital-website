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
import { assertDoctorOwns } from "@common/utils/recordAuthorization";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "@common/errors/AppError";
import { DepartmentStatus, NotificationType, Role } from "@prisma/client";

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
  pmdcRegistrationNo: z.string().trim().max(100).nullable().optional(),
  phcRegistrationNo: z.string().trim().max(100).nullable().optional(),
  phcRlNo: z.string().trim().max(100).nullable().optional(),
  clinicDaysTimings: z.string().trim().max(500).nullable().optional(),
  refillText: z.string().trim().max(500).nullable().optional(),
  dispensingStampText: z.string().trim().max(200).nullable().optional(),
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
const prescriptionPadDoctorParamSchema = z.object({ doctorId: z.string().uuid() });
const prescriptionPadConfigSchema = z.object({
  doctorId: z.string().uuid(),
  clinicName: z.string().trim().min(1).max(200),
  clinicAddress: z.string().trim().max(500).nullable().optional(),
  clinicPhone: z.string().trim().max(40).nullable().optional(),
  clinicEmail: z.string().email().max(255).nullable().optional(),
  doctorName: z.string().trim().max(200).nullable().optional(),
  doctorQualification: z.string().trim().max(200).nullable().optional(),
  doctorSpecialization: z.string().trim().max(200).nullable().optional(),
  pmdcRegistrationNo: z.string().trim().max(100).nullable().optional(),
  phcRegistrationNo: z.string().trim().max(100).nullable().optional(),
  otherRegistrationNo: z.string().trim().max(100).nullable().optional(),
  clinicDaysTimings: z.string().trim().max(500).nullable().optional(),
  refillText: z.string().trim().max(500).nullable().optional(),
  dispensingStampText: z.string().trim().max(200).nullable().optional(),
});
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must use HH:MM format");
const scheduleDaySchema = z.object({ enabled: z.boolean(), start: timeSchema, end: timeSchema });
const doctorScheduleSchema = z.object({
  slotDuration: z.number().int().min(5).max(120),
  weekly: z.object({
    Monday: scheduleDaySchema,
    Tuesday: scheduleDaySchema,
    Wednesday: scheduleDaySchema,
    Thursday: scheduleDaySchema,
    Friday: scheduleDaySchema,
    Saturday: scheduleDaySchema,
    Sunday: scheduleDaySchema,
  }),
});
const doctorScheduleParamSchema = z.object({ doctorId: z.string().uuid() });
const notificationTemplateIdSchema = z.object({ id: z.string().uuid() });
const notificationTemplateSchema = z.object({
  notificationType: z.nativeEnum(NotificationType),
  name: z.string().trim().min(1).max(120),
  titleTemplate: z.string().trim().min(1).max(200),
  messageTemplate: z.string().trim().min(1).max(5000),
  availablePlaceholders: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)).max(30),
  isActive: z.boolean().default(true),
});
const medicineCategoryIdSchema = z.object({ id: z.string().uuid() });
const medicineCategorySchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional(), isActive: z.boolean().optional() });
const rolePermissionSchema = z.object({ role: z.nativeEnum(Role), module: z.string().trim().min(1).max(100), allowedActions: z.array(z.enum(["view", "create", "edit", "delete", "export"])) });

type DoctorSchedule = z.infer<typeof doctorScheduleSchema>;
const scheduleDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

function buildSchedulePayload(schedule: DoctorSchedule) {
  const slotsByDay = Object.fromEntries(scheduleDays.map((day) => {
    const config = schedule.weekly[day];
    if (!config.enabled) return [day, []];
    const slots: string[] = [];
    const [startHour, startMinute] = config.start.split(":").map(Number);
    const [endHour, endMinute] = config.end.split(":").map(Number);
    for (let minutes = startHour * 60 + startMinute; minutes < endHour * 60 + endMinute; minutes += schedule.slotDuration) {
      slots.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
    }
    return [day, slots];
  }));
  const daysOff = scheduleDays.filter((day) => !schedule.weekly[day].enabled);
  return { ...schedule, daysOff, slotsByDay, slotsPerDay: slotsByDay.Monday ?? [] };
}

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

async function savePrescriptionPadAsset(file: Express.Multer.File, type: "logo" | "qr-code") {
  const maxBytes = type === "logo" ? 2 * 1024 * 1024 : 1 * 1024 * 1024;
  const allowed = ["image/png", "image/jpeg", "image/svg+xml"];
  if (file.size > maxBytes || !allowed.includes(file.mimetype)) throw new BadRequestError("Unsupported prescription pad asset or file size exceeded");
  const extension = { "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg" }[file.mimetype];
  const relativePath = path.join("prescription-pad", `${randomUUID()}${extension}`);
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

router.get("/medicine-categories", requireRole(["ADMIN"]), asyncHandler(async (_req: Request, res: Response) => {
  const categories = await prisma.medicineCategory.findMany({ include: { _count: { select: { medicines: true } } }, orderBy: { name: "asc" } });
  sendSuccess(res, 200, { data: categories });
}));
router.post("/medicine-categories", requireRole(["ADMIN"]), validate({ body: medicineCategorySchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const duplicate = await prisma.medicineCategory.findFirst({ where: { name: { equals: req.body.name, mode: "insensitive" } } });
  if (duplicate) throw new ConflictError("Medicine category name must be unique");
  const category = await prisma.medicineCategory.create({ data: { name: req.body.name, description: req.body.description || null, isActive: req.body.isActive ?? true } });
  await writeAuditLog({ userId: req.user.sub, action: "CREATE", module: "settings", entityType: "MedicineCategory", entityId: category.id, newValues: category, req });
  sendSuccess(res, 201, { data: category, message: "Medicine category created" });
}));
router.patch("/medicine-categories/:id", requireRole(["ADMIN"]), validate({ params: medicineCategoryIdSchema, body: medicineCategorySchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const existing = await prisma.medicineCategory.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError("Medicine category not found");
  const duplicate = await prisma.medicineCategory.findFirst({ where: { id: { not: req.params.id }, name: { equals: req.body.name, mode: "insensitive" } } });
  if (duplicate) throw new ConflictError("Medicine category name must be unique");
  const category = await prisma.medicineCategory.update({ where: { id: req.params.id }, data: { name: req.body.name, description: req.body.description || null, ...(req.body.isActive === undefined ? {} : { isActive: req.body.isActive }) } });
  await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "MedicineCategory", entityId: category.id, newValues: category, req });
  sendSuccess(res, 200, { data: category, message: "Medicine category updated" });
}));
router.delete("/medicine-categories/:id", requireRole(["ADMIN"]), validate({ params: medicineCategoryIdSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const category = await prisma.medicineCategory.findUnique({ where: { id: req.params.id }, include: { _count: { select: { medicines: true } } } });
  if (!category) throw new NotFoundError("Medicine category not found");
  if (category._count.medicines) throw new ConflictError("Category is linked to medicines and cannot be deleted");
  await prisma.medicineCategory.delete({ where: { id: category.id } });
  await writeAuditLog({ userId: req.user.sub, action: "DELETE", module: "settings", entityType: "MedicineCategory", entityId: category.id, oldValues: category, req });
  sendSuccess(res, 200, { data: null, message: "Medicine category deleted" });
}));

router.get("/role-permissions", requireRole(["ADMIN"]), asyncHandler(async (_req: Request, res: Response) => {
  const permissions = await prisma.rolePermission.findMany({ orderBy: [{ role: "asc" }, { module: "asc" }] });
  sendSuccess(res, 200, { data: permissions });
}));
router.put("/role-permissions", requireRole(["ADMIN"]), validate({ body: rolePermissionSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const permission = await prisma.rolePermission.upsert({ where: { role_module: { role: req.body.role, module: req.body.module } }, create: req.body, update: { allowedActions: req.body.allowedActions } });
  await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "RolePermission", entityId: permission.id, newValues: permission, req });
  sendSuccess(res, 200, { data: permission, message: "Role permission updated" });
}));

router.get("/notification-templates", requireRole(["ADMIN"]), asyncHandler(async (_req: Request, res: Response) => {
  const templates = await prisma.notificationTemplate.findMany({ orderBy: { notificationType: "asc" } });
  sendSuccess(res, 200, { data: templates });
}));

router.post("/notification-templates", requireRole(["ADMIN"]), validate({ body: notificationTemplateSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const template = await prisma.notificationTemplate.create({ data: req.body });
  await writeAuditLog({ userId: req.user.sub, action: "CREATE", module: "settings", entityType: "NotificationTemplate", entityId: template.id, newValues: template, req });
  sendSuccess(res, 201, { data: template, message: "Notification template created" });
}));

router.put("/notification-templates/:id", requireRole(["ADMIN"]), validate({ params: notificationTemplateIdSchema, body: notificationTemplateSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const template = await prisma.notificationTemplate.update({ where: { id: req.params.id }, data: req.body }).catch(() => { throw new NotFoundError("Notification template not found"); });
  await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "NotificationTemplate", entityId: template.id, newValues: template, req });
  sendSuccess(res, 200, { data: template, message: "Notification template updated" });
}));

router.delete("/notification-templates/:id", requireRole(["ADMIN"]), validate({ params: notificationTemplateIdSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const template = await prisma.notificationTemplate.delete({ where: { id: req.params.id } }).catch(() => { throw new NotFoundError("Notification template not found"); });
  await writeAuditLog({ userId: req.user.sub, action: "DELETE", module: "settings", entityType: "NotificationTemplate", entityId: template.id, oldValues: template, req });
  sendSuccess(res, 200, { data: null, message: "Notification template deleted" });
}));

router.get("/doctor-schedules", requireRole(["ADMIN"]), asyncHandler(async (_req: Request, res: Response) => {
  const doctors = await prisma.doctor.findMany({
    select: { id: true, qualification: true, specialization: true, isAvailable: true, scheduleJson: true, user: { select: { name: true, email: true } }, department: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  sendSuccess(res, 200, { data: doctors });
}));

router.put("/doctor-schedules/:doctorId", requireRole(["ADMIN"]), validate({ params: doctorScheduleParamSchema, body: doctorScheduleSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const doctor = await prisma.doctor.findUnique({ where: { id: req.params.doctorId }, select: { id: true } });
  if (!doctor) throw new NotFoundError("Doctor not found");
  const schedule = buildSchedulePayload(req.body as DoctorSchedule);
  const updated = await prisma.doctor.update({ where: { id: doctor.id }, data: { scheduleJson: schedule }, select: { id: true, scheduleJson: true } });
  await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "DoctorSchedule", entityId: doctor.id, newValues: schedule, req });
  sendSuccess(res, 200, { data: updated, message: "Doctor schedule updated" });
}));

router.get("/prescription-pad", asyncHandler(async (req: Request, res: Response) => {
  const doctorId = typeof req.query.doctorId === "string" ? req.query.doctorId : undefined;
  if (!doctorId) throw new BadRequestError("doctorId is required");
  await assertDoctorOwns(req.user!, doctorId);
  const config = await prisma.prescriptionPadConfig.findUnique({ where: { doctorId } });
  sendSuccess(res, 200, { data: config });
}));

router.put("/prescription-pad", requireRole(["ADMIN"]), validate({ body: prescriptionPadConfigSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const { doctorId, ...data } = req.body;
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { id: true } });
  if (!doctor) throw new NotFoundError("Doctor not found");
  const config = await prisma.prescriptionPadConfig.upsert({ where: { doctorId }, create: { doctorId, ...data }, update: data });
  await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "PrescriptionPadConfig", entityId: config.id, newValues: config, req });
  sendSuccess(res, 200, { data: config, message: "Prescription pad configuration updated" });
}));

for (const type of ["logo", "qr-code"] as const) {
  router.post(`/prescription-pad/${type}`, requireRole(["ADMIN"]), upload.single("file"), asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    if (!req.file) return res.status(400).json({ success: false, message: "A file is required" });
    const doctorId = typeof req.body.doctorId === "string" ? req.body.doctorId : "";
    if (!prescriptionPadDoctorParamSchema.safeParse({ doctorId }).success) throw new BadRequestError("A valid doctorId is required");
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { id: true } });
    if (!doctor) throw new NotFoundError("Doctor not found");
    const url = await savePrescriptionPadAsset(req.file, type);
    const field = type === "logo" ? "logoUrl" : "qrCodeUrl";
    const config = await prisma.prescriptionPadConfig.upsert({ where: { doctorId }, create: { doctorId, clinicName: "", [field]: url }, update: { [field]: url } });
    await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "settings", entityType: "PrescriptionPadConfig", entityId: config.id, newValues: { [field]: url }, req });
    sendSuccess(res, 200, { data: config, message: `${type} uploaded` });
  }));
}

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
    if (req.params.key === "cashierMaxDiscountPercent" && !setting) {
      sendSuccess(res, 200, { data: { key: "cashierMaxDiscountPercent", value: 10 } });
      return;
    }
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
    if (req.params.key === "cashierMaxDiscountPercent") {
      if (req.user.role !== "ADMIN") throw new ForbiddenError("Only Admins can configure the pharmacy discount limit.");
      const limit = z.number().finite().min(0).max(100).safeParse(req.body.value);
      if (!limit.success) throw new BadRequestError("cashierMaxDiscountPercent must be a number from 0 to 100.");
    }
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
