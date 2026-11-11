import { Request, Response, Router } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { ultrasoundService } from "./ultrasound.service";
import multer from "multer";
import { savePrivateUpload } from "@common/utils/privateFiles";
import { prisma } from "@config/prisma";
import { writeAuditLog } from "@common/utils/auditLog";
import { completeUltrasoundSchema, createUltrasoundOrderSchema, idParamSchema, listUltrasoundOrdersQuerySchema, patientParamSchema, reviewUltrasoundSchema, scheduleUltrasoundSchema, ultrasoundAnalyticsRangeSchema, ultrasoundAuditTrailQuerySchema, ultrasoundPricingSchema, ultrasoundScanCatalogSchema, updateUltrasoundTemplateSchema } from "./ultrasound.validators";

const viewRoles = ["ADMIN", "DOCTOR", "RECEPTIONIST", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"] as const;
const performerRoles = ["ADMIN", "DOCTOR", "RADIOLOGIST", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN"] as const;
const _technicianRoles = ["ADMIN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN"] as const;
const reviewRoles = ["ADMIN", "DOCTOR", "RADIOLOGIST"] as const;
const queueRoles = ["ADMIN", "DOCTOR", "RADIOLOGIST", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN"] as const;
const deliveryRoles = ["ADMIN", "RECEPTIONIST"] as const;
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/jfif", "image/png", "application/dicom", "application/octet-stream"].includes(file.mimetype)) });

const controller = {
  list: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const { page: _page, limit: _limit, ...query } = req.query as {
      page?: string;
      limit?: string;
      status?: "ORDERED" | "SCHEDULED" | "IN_PROGRESS" | "REPORTED" | "VERIFIED" | "DELIVERED" | "CANCELLED";
      priority?: "ROUTINE" | "URGENT" | "STAT";
      examType?: string;
      sort?: "priority" | "time";
      patientId?: string;
      technicianId?: string;
      from?: Date;
      to?: Date;
    };
    const result = await ultrasoundService.list(req.user, { ...page, ...query });
    sendSuccess(res, 200, { data: result.items, pagination: paginationMeta(page.page, page.limit, result.total) });
  }),
  overview: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.overview() });
  }),
  analyticsReport: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.analyticsReport(req.query.from as string | undefined, req.query.to as string | undefined) });
  }),
  auditTrail: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req, 50, 100);
    const { page: _page, limit: _limit, ...query } = req.query as {
      page?: string;
      limit?: string;
      from?: string;
      to?: string;
      userId?: string;
      action?: string;
      search?: string;
    };
    const result = await ultrasoundService.listAuditTrail({
      ...page,
      ...query,
      action: query.action as import("@prisma/client").AuditAction | undefined,
    });
    sendSuccess(res, 200, { data: result });
  }),
  auditUsers: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.listAuditUsers() });
  }),
  get: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.getById(req.params.id) });
  }),
  history: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.listPatientHistory(req.params.patientId) });
  }),
  orderAudit: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.listOrderAudit(req.params.id) });
  }),
  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await ultrasoundService.create(req.user, req.body, req), message: "Ultrasound order created" });
  }),
  listTemplates: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.listReportTemplates() });
  }),
  listManageableTemplates: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.listReportTemplates(true) });
  }),
  getTemplate: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.getReportTemplate(req.params.id) });
  }),
  updateTemplate: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.updateReportTemplate(req.user, req.params.id, req.body.sections, req), message: "Ultrasound template updated" });
  }),
  createOrder: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await ultrasoundService.createReportOrder(req.user, req.body, req), message: "Ultrasound order created" });
  }),
  listQueue: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.listQueue(req.user) });
  }),
  getReport: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.getReport(req.user, req.params.id) });
  }),
  saveReport: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.saveReport(req.user, req.params.id, req.body, req), message: "Ultrasound report saved" });
  }),
  schedule: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.schedule(req.user, req.params.id, req.body, req), message: "Ultrasound scheduled" });
  }),
  start: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.start(req.user, req.params.id, req), message: "Ultrasound started" });
  }),
  complete: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.complete(req.user, req.params.id, req.body, req), message: "Ultrasound report marked as reported" });
  }),
  review: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.review(req.user, req.params.id, req.body, req), message: "Ultrasound report updated" });
  }),
  verify: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.verify(req.user, req.params.id, req), message: "Ultrasound report verified" });
  }),
  finalize: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.finalize(req.user, req.params.id, req), message: "Ultrasound report finalized" });
  }),
  deliver: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.deliver(req.user, req.params.id, req), message: "Ultrasound report delivered" });
  }),
  cancel: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.cancel(req.user, req.params.id, req), message: "Ultrasound cancelled" });
  }),
  print: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.logReportPrint(req.user, req.params.id, req), message: "Report print recorded" });
  }),
  updatePricing: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.updatePricing(req.user, req.params.id, req.body, req), message: "Ultrasound pricing updated" });
  }),
  getScanCatalog: asyncHandler(async (_req: Request, res: Response) => {
    const setting = await prisma.setting.findUnique({ where: { key: "ultrasound.scanCatalog" } });
    sendSuccess(res, 200, { data: setting?.value ?? [] });
  }),
  updateScanCatalog: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const setting = await prisma.setting.upsert({
      where: { key: "ultrasound.scanCatalog" },
      create: { key: "ultrasound.scanCatalog", value: req.body as never },
      update: { value: req.body as never },
    });
    await writeAuditLog({ userId: req.user.sub, action: "UPDATE", module: "ultrasound", entityType: "ScanCatalog", entityId: "ultrasound.scanCatalog", newValues: setting.value, req });
    sendSuccess(res, 200, { data: setting.value, message: "Ultrasound scan catalog updated" });
  }),
};

const router = Router();
router.use(authenticate);
router.get("/templates/manage", requireRole(["ADMIN"]), controller.listManageableTemplates);
router.get("/settings/scan-catalog", requireRole(["ADMIN", ...viewRoles]), controller.getScanCatalog);
router.put("/settings/scan-catalog", requireRole(["ADMIN"]), validate({ body: ultrasoundScanCatalogSchema }), controller.updateScanCatalog);
router.get("/audit-trail/users", requireRole(["ADMIN"]), controller.auditUsers);
router.get("/audit-trail", requireRole(["ADMIN"]), validate({ query: ultrasoundAuditTrailQuerySchema }), controller.auditTrail);
router.get("/analytics/overview", requireRole([...viewRoles]), controller.overview);
router.get("/analytics/reports", requireRole([...viewRoles]), validate({ query: ultrasoundAnalyticsRangeSchema }), controller.analyticsReport);
router.get("/templates", requireRole([...viewRoles]), controller.listTemplates);
router.get("/templates/:id", requireRole([...viewRoles]), validate({ params: idParamSchema }), controller.getTemplate);
router.put("/templates/:id", requireRole(["ADMIN"]), validate({ params: idParamSchema, body: updateUltrasoundTemplateSchema }), controller.updateTemplate);
router.get("/queue", requireRole([...queueRoles]), controller.listQueue);
router.get("/reports/:id", requireRole([...viewRoles]), validate({ params: idParamSchema }), controller.getReport);
router.put("/reports/:id", requireRole([...performerRoles]), validate({ params: idParamSchema }), controller.saveReport);
router.post("/orders", requireRole(["ADMIN", "DOCTOR"]), controller.createOrder);
router.get("/patient/:patientId", requireRole([...viewRoles]), validate({ params: patientParamSchema }), controller.history);
router.get("/:id/audit-trail", requireRole([...viewRoles]), validate({ params: idParamSchema }), controller.orderAudit);
router.post("/:id/print", requireRole([...viewRoles]), validate({ params: idParamSchema }), controller.print);
router.patch("/:id/pricing", requireRole(["ADMIN"]), validate({ params: idParamSchema, body: ultrasoundPricingSchema }), controller.updatePricing);
router.get("/:id", requireRole([...viewRoles]), validate({ params: idParamSchema }), controller.get);
router.get("/", requireRole([...viewRoles]), validate({ query: listUltrasoundOrdersQuerySchema }), controller.list);
router.post("/", requireRole(["DOCTOR", "RADIOLOGIST"]), validate({ body: createUltrasoundOrderSchema }), controller.create);
router.patch("/:id/schedule", requireRole([...performerRoles]), validate({ params: idParamSchema, body: scheduleUltrasoundSchema }), controller.schedule);
router.patch("/:id/start", requireRole([...performerRoles]), validate({ params: idParamSchema }), controller.start);
router.patch("/:id/complete", requireRole([...performerRoles]), validate({ params: idParamSchema, body: completeUltrasoundSchema }), controller.complete);
router.patch("/:id/review", requireRole([...reviewRoles]), validate({ params: idParamSchema, body: reviewUltrasoundSchema }), controller.review);
router.patch("/:id/verify", requireRole([...reviewRoles]), validate({ params: idParamSchema }), controller.verify);
router.patch("/:id/finalize", requireRole([...reviewRoles]), validate({ params: idParamSchema }), controller.finalize);
router.patch("/:id/deliver", requireRole([...deliveryRoles]), validate({ params: idParamSchema }), controller.deliver);
router.post("/:id/images", requireRole([...performerRoles]), imageUpload.array("files", 20), validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) return res.status(400).json({ success: false, message: "At least one valid image is required" });
  const imageUrls = await Promise.all(files.map((file) => savePrivateUpload(file, "image", "ultrasound")));
  sendSuccess(res, 201, { data: await ultrasoundService.addImages(req.user, req.params.id, imageUrls, req), message: "Ultrasound images uploaded" });
}));
router.patch("/:id/cancel", requireRole([...deliveryRoles]), validate({ params: idParamSchema }), controller.cancel);
export default router;
