import { Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { NotFoundError, UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { resolvePrivateFile } from "@common/utils/privateFiles";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { prescriptionsService } from "./prescriptions.service";
import { createPrescriptionSchema, idParamSchema, listPrescriptionsQuerySchema, prescriptionTemplateSchema, voidPrescriptionSchema } from "./prescriptions.validators";

export const prescriptionsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { patientId, status } = req.query as Record<string, string | undefined>;
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await prescriptionsService.list(req.user, { ...page, patientId, status });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),
  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const rx = await prescriptionsService.getById(req.user, req.params.id);
    sendSuccess(res, 200, { data: rx });
  }),
  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const rx = await prescriptionsService.create(req.user, req.body, req);
    sendSuccess(res, 201, { data: rx, message: "Prescription created" });
  }),
  sign: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const rx = await prescriptionsService.sign(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: rx, message: "Prescription signed" });
  }),
  voidPrescription: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const rx = await prescriptionsService.voidPrescription(req.user, req.params.id, req.body.reason, req);
    sendSuccess(res, 200, { data: rx, message: "Prescription voided" });
  }),
  /** PDF print stub — returns structured data; actual PDF rendering handled by the pdf skill/service in production. */
  print: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const rx = await prescriptionsService.getById(req.user, req.params.id);
    sendSuccess(res, 200, { data: rx, message: "Prescription ready for print rendering" });
  }),
  printConsultation: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await prescriptionsService.getConsultationPrintData(req.user, req.params.consultationId) });
  }),
  listTemplates: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await prescriptionsService.listTemplates(req.user) });
  }),
  createTemplate: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await prescriptionsService.createTemplate(req.user, req.body, req), message: "Prescription template created" });
  }),
  updateTemplate: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await prescriptionsService.updateTemplate(req.user, req.params.id, req.body, req), message: "Prescription template updated" });
  }),
  deleteTemplate: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await prescriptionsService.deleteTemplate(req.user, req.params.id, req), message: "Prescription template deleted" });
  }),
};

const router = Router();
const prescriptionPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, file.mimetype === "application/pdf"),
});

router.get("/shared/:token/verify", asyncHandler(async (req, res) => {
  const verification = await prescriptionsService.getPublicShare(req.params.token);
  sendSuccess(res, 200, { data: { valid: verification.valid, signedAt: verification.signedAt, doctorName: verification.doctorName, expiresAt: verification.expiresAt } });
}));
router.get("/shared/:token/pdf", asyncHandler(async (req, res) => {
  const share = await prescriptionsService.getPublicShare(req.params.token, true);
  if (!share.filePath) throw new NotFoundError("The shared prescription PDF is not available");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="prescription.pdf"');
  res.sendFile(resolvePrivateFile(share.filePath), { dotfiles: "deny" });
}));
router.use(authenticate);

router.get("/templates", requireRole(["DOCTOR"]), prescriptionsController.listTemplates);
router.post("/templates", requireRole(["DOCTOR"]), validate({ body: prescriptionTemplateSchema }), prescriptionsController.createTemplate);
router.put("/templates/:id", requireRole(["DOCTOR"]), validate({ params: idParamSchema, body: prescriptionTemplateSchema }), prescriptionsController.updateTemplate);
router.delete("/templates/:id", requireRole(["DOCTOR"]), validate({ params: idParamSchema }), prescriptionsController.deleteTemplate);
router.post("/:id/share", requireRole(["DOCTOR"]), validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  sendSuccess(res, 201, { data: await prescriptionsService.createShare(req.user, req.params.id, req), message: "Temporary prescription share created" });
}));
router.post("/:id/share/:shareId/pdf", requireRole(["DOCTOR"]), prescriptionPdfUpload.single("file"), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  if (!req.file) {
    res.status(422).json({ success: false, message: "A valid PDF file is required", data: null, errors: null });
    return;
  }
  const data = await prescriptionsService.attachSharePdf(req.user, req.params.id, req.params.shareId, req.file, req);
  sendSuccess(res, 200, { data, message: "Prescription PDF is ready to share" });
}));

router.get("/", requireRole(["ADMIN", "DOCTOR", "PHARMACIST", "NURSE"]), validate({ query: listPrescriptionsQuerySchema }), prescriptionsController.list);
router.get("/consultations/:consultationId/print", requireRole(["ADMIN", "DOCTOR", "PHARMACIST"]), validate({ params: z.object({ consultationId: z.string().uuid() }) }), prescriptionsController.printConsultation);
router.get("/:id", requireRole(["ADMIN", "DOCTOR", "PHARMACIST", "NURSE"]), validate({ params: idParamSchema }), prescriptionsController.getById);
router.post("/", requireRole(["ADMIN", "DOCTOR"]), validate({ body: createPrescriptionSchema }), prescriptionsController.create);
router.post("/:id/sign", requireRole(["ADMIN", "DOCTOR"]), validate({ params: idParamSchema }), prescriptionsController.sign);
router.post(
  "/:id/void",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema, body: voidPrescriptionSchema }),
  prescriptionsController.voidPrescription
);
router.get("/:id/print", requireRole(["ADMIN", "DOCTOR", "PHARMACIST"]), validate({ params: idParamSchema }), prescriptionsController.print);

export default router;
