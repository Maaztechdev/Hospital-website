import { Request, Response, Router } from "express";
import multer from "multer";
import { savePrivateUpload } from "@common/utils/privateFiles";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { labService } from "./lab.service";
import {
  amendResultSchema,
  createLabOrderSchema,
  createLabTestSchema,
  enterResultSchema,
  idParamSchema,
  listLabOrdersQuerySchema,
  updateSampleStatusSchema,
  uploadReportSchema,
} from "./lab.validators";

const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, ["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)),
});

export const labController = {
  listTests: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labService.listTests() });
  }),
  createTest: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const test = await labService.createTest(req.user, req.body, req);
    sendSuccess(res, 201, { data: test, message: "Lab test added to catalog" });
  }),
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { patientId, status, priority } = req.query as Record<string, string | undefined>;
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await labService.list(req.user, { ...page, patientId, status, priority });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),
  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labService.getById(req.user, req.params.id) });
  }),
  createOrder: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const order = await labService.createOrder(req.user, req.body, req);
    sendSuccess(res, 201, { data: order, message: "Lab order created" });
  }),
  updateSampleStatus: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const order = await labService.updateSampleStatus(req.user, req.params.id, req.body.status, req);
    sendSuccess(res, 200, { data: order, message: "Sample status updated" });
  }),
  enterResult: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await labService.enterResult(req.user, req.params.id, req.body, req);
    sendSuccess(res, 201, { data: result, message: "Result recorded" });
  }),
  amendResult: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await labService.amendResult(req.user, req.params.id, req.body, req);
    sendSuccess(res, 201, { data: result, message: "Result amended (history retained)" });
  }),
  verify: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const order = await labService.verify(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: order, message: "Result verified" });
  }),
  uploadReport: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const fileUrl = req.file ? await savePrivateUpload(req.file, "document", "lab-reports") : undefined;
    const fileType = req.file?.mimetype;
    const parsed = uploadReportSchema.safeParse({ fileUrl, fileType });
    if (!parsed.success) return res.status(400).json({ success: false, message: "A valid report file is required", errors: parsed.error.flatten() });
    const attachment = await labService.uploadReport(req.user, req.params.id, parsed.data.fileUrl, parsed.data.fileType, req);
    sendSuccess(res, 201, { data: attachment, message: "Report attached" });
  }),
};

const router = Router();
router.use(authenticate);

router.get("/tests", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "NURSE"]), labController.listTests);
router.post("/tests", requireRole(["ADMIN"]), validate({ body: createLabTestSchema }), labController.createTest);

router.get("/orders", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "NURSE"]), validate({ query: listLabOrdersQuerySchema }), labController.list);
router.get("/orders/:id", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "NURSE"]), validate({ params: idParamSchema }), labController.getById);
router.post("/orders", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST"]), validate({ body: createLabOrderSchema }), labController.createOrder);
router.patch(
  "/orders/:id/sample-status",
  requireRole(["ADMIN", "LAB_TECHNICIAN"]),
  validate({ params: idParamSchema, body: updateSampleStatusSchema }),
  labController.updateSampleStatus
);
router.post(
  "/orders/:id/results",
  requireRole(["ADMIN", "LAB_TECHNICIAN"]),
  validate({ params: idParamSchema, body: enterResultSchema }),
  labController.enterResult
);
router.post(
  "/orders/:id/results/amend",
  requireRole(["ADMIN", "LAB_TECHNICIAN"]),
  validate({ params: idParamSchema, body: amendResultSchema }),
  labController.amendResult
);
router.post("/orders/:id/verify", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ params: idParamSchema }), labController.verify);
router.post(
  "/orders/:id/attachments",
  requireRole(["ADMIN", "LAB_TECHNICIAN"]),
  reportUpload.single("file"),
  validate({ params: idParamSchema }),
  labController.uploadReport
);

export default router;
