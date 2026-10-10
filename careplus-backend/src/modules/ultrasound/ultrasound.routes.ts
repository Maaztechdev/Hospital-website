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
import { completeUltrasoundSchema, createUltrasoundOrderSchema, idParamSchema, listUltrasoundOrdersQuerySchema, patientParamSchema, scheduleUltrasoundSchema } from "./ultrasound.validators";

const viewRoles = ["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST", "NURSE"] as const;
const workflowRoles = ["ADMIN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"] as const;
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/jfif", "image/png", "application/dicom", "application/octet-stream"].includes(file.mimetype)) });

const controller = {
  list: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const { page: _page, limit: _limit, ...query } = req.query as {
      page?: string;
      limit?: string;
      status?: never;
      patientId?: string;
      technicianId?: string;
      from?: Date;
      to?: Date;
    };
    const result = await ultrasoundService.list(req.user, { ...page, ...query });
    sendSuccess(res, 200, { data: result.items, pagination: paginationMeta(page.page, page.limit, result.total) });
  }),
  get: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.getById(req.params.id) });
  }),
  history: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.listPatientHistory(req.params.patientId) });
  }),
  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await ultrasoundService.create(req.user, req.body, req), message: "Ultrasound order created" });
  }),
  listTemplates: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.listReportTemplates() });
  }),
  getTemplate: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await ultrasoundService.getReportTemplate(req.params.id) });
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
    sendSuccess(res, 200, { data: await ultrasoundService.complete(req.user, req.params.id, req.body, req), message: "Ultrasound completed" });
  }),
  cancel: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ultrasoundService.cancel(req.user, req.params.id, req), message: "Ultrasound cancelled" });
  }),
};

const router = Router();
router.use(authenticate);
router.get("/templates", requireRole([...viewRoles]), controller.listTemplates);
router.get("/templates/:id", requireRole([...viewRoles]), validate({ params: idParamSchema }), controller.getTemplate);
router.get("/queue", requireRole(["ADMIN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"]), controller.listQueue);
router.get("/reports/:id", requireRole([...viewRoles]), validate({ params: idParamSchema }), controller.getReport);
router.put("/reports/:id", requireRole(["ADMIN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"]), validate({ params: idParamSchema }), controller.saveReport);
router.post("/orders", requireRole(["ADMIN", "DOCTOR"]), controller.createOrder);
router.get("/patient/:patientId", requireRole([...viewRoles]), validate({ params: patientParamSchema }), controller.history);
router.get("/:id", requireRole([...viewRoles]), validate({ params: idParamSchema }), controller.get);
router.get("/", requireRole([...viewRoles]), validate({ query: listUltrasoundOrdersQuerySchema }), controller.list);
router.post("/", requireRole(["DOCTOR", "RADIOLOGIST"]), validate({ body: createUltrasoundOrderSchema }), controller.create);
router.patch("/:id/schedule", requireRole([...workflowRoles]), validate({ params: idParamSchema, body: scheduleUltrasoundSchema }), controller.schedule);
router.patch("/:id/start", requireRole([...workflowRoles]), validate({ params: idParamSchema }), controller.start);
router.patch("/:id/complete", requireRole([...workflowRoles]), validate({ params: idParamSchema, body: completeUltrasoundSchema }), controller.complete);
router.post("/:id/images", requireRole([...workflowRoles]), imageUpload.array("files", 20), validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) return res.status(400).json({ success: false, message: "At least one valid image is required" });
  const imageUrls = await Promise.all(files.map((file) => savePrivateUpload(file, "image", "ultrasound")));
  sendSuccess(res, 201, { data: await ultrasoundService.addImages(req.user, req.params.id, imageUrls, req), message: "Ultrasound images uploaded" });
}));
router.patch("/:id/cancel", requireRole([...workflowRoles, "DOCTOR"]), validate({ params: idParamSchema }), controller.cancel);
export default router;
