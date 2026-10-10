import { Request, Response, Router } from "express";
import multer from "multer";
import { savePrivateUpload } from "@common/utils/privateFiles";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { BadRequestError, UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { labService } from "./lab.service";
import { labAnalyticsService } from "./lab.analytics.service";
import { labInventoryService } from "./labInventory.service";
import { labLedgerService } from "./labLedger.service";
import {
  labInventoryAdjustmentSchema,
  labInventoryBatchSchema,
  labInventoryItemSchema,
  labInventoryMappingSchema,
  labInventoryParamsSchema,
  labInventoryQuerySchema,
} from "./labInventory.validators";
import {
  amendResultSchema,
  allowSameUserVerificationSchema,
  createLabOrderSchema,
  createLabPackageOrderSchema,
  createLabTestSchema,
  enterResultSchema,
  idParamSchema,
  labReportSettingsSchema,
  labSettingsSchema,
  labSettingsAssetParamSchema,
  labReportsQuerySchema,
  labBillingSettingsSchema,
  labPackageSchema,
  listLabPackagesQuerySchema,
  listLabTestsQuerySchema,
  listLabOrdersQuerySchema,
  labLedgerQuerySchema,
  createLabLedgerAccountSchema,
  labLedgerAccountParamSchema,
  labLedgerPaymentSchema,
  recollectSampleParamSchema,
  rejectSampleSchema,
  publicLabReportParamSchema,
  updateSampleStatusSchema,
  updateLabTestSchema,
  uploadReportSchema,
} from "./lab.validators";

const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => file.mimetype === "application/pdf"
    ? callback(null, true)
    : callback(new BadRequestError("Only PDF report attachments are allowed")),
});

const labSettingsImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => ["image/jpeg", "image/png"].includes(file.mimetype)
    ? callback(null, true)
    : callback(new BadRequestError("Lab logos and signatures must be PNG or JPEG images")),
});

export const labController = {
  getLabSettings: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labService.getLabSettings() });
  }),
  setLabSettings: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labService.setLabSettings(req.user, req.body, req), message: "Lab settings saved" });
  }),
  getLabOrderPolicy: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labService.getLabOrderPolicy() });
  }),
  uploadLabSettingsAsset: asyncHandler(async (req: Request, res: Response) => {
    const parsed = labSettingsAssetParamSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid Lab settings image type", errors: parsed.error.flatten() });
    if (!req.file) throw new BadRequestError("Select an image to upload.");
    const url = await savePrivateUpload(req.file, "image", "lab-assets");
    sendSuccess(res, 201, { data: { url, assetType: parsed.data.assetType }, message: "Lab settings image uploaded" });
  }),
  getReportSettings: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labService.getReportSettings() });
  }),
  setReportSettings: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labService.setReportSettings(req.user, req.body, req) });
  }),
  verifyPublicReport: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labService.verifyPublicReport(req.params.orderNumber) });
  }),
  getVerificationSetting: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labService.getVerificationSetting() });
  }),
  getBillingSettings: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labService.getBillingSettings() });
  }),
  setBillingSettings: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labService.setBillingSettings(req.user, req.body.requirePaymentBeforeCollection, req) });
  }),
  setVerificationSetting: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labService.setVerificationSetting(req.user, req.body.allowSameUserEnterVerify, req) });
  }),
  listTests: asyncHandler(async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    sendSuccess(res, 200, { data: await labService.listTests(includeInactive) });
  }),
  listPackages: asyncHandler(async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    sendSuccess(res, 200, { data: await labService.listPackages(includeInactive) });
  }),
  createTest: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const test = await labService.createTest(req.user, req.body, req);
    sendSuccess(res, 201, { data: test, message: "Lab test added to catalog" });
  }),
  updateTest: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const test = await labService.updateTest(req.user, req.params.id, req.body, req);
    sendSuccess(res, 200, { data: test, message: "Lab test updated" });
  }),
  deleteTest: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const test = await labService.deleteTest(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: test, message: "Lab test archived" });
  }),
  createPackage: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const labPackage = await labService.createPackage(req.user, req.body, req);
    sendSuccess(res, 201, { data: labPackage, message: "Lab package added to catalog" });
  }),
  updatePackage: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const labPackage = await labService.updatePackage(req.user, req.params.id, req.body, req);
    sendSuccess(res, 200, { data: labPackage, message: "Lab package updated" });
  }),
  deletePackage: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const labPackage = await labService.deactivatePackage(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: labPackage, message: "Lab package archived" });
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
  createPackageOrder: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const order = await labService.createPackageOrder(req.user, req.body, req);
    sendSuccess(res, 201, { data: order, message: "Lab package order created" });
  }),
  updateSampleStatus: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const order = await labService.updateSampleStatus(req.user, req.params.id, req.body.status, req);
    sendSuccess(res, 200, { data: order, message: "Sample status updated" });
  }),
  rejectSample: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const rejection = await labService.rejectSample(req.user, req.params.id, req.body, req);
    sendSuccess(res, 201, { data: rejection, message: "Sample rejected; recollection is required" });
  }),
  recollectSample: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const order = await labService.recollectSample(req.user, req.params.id, req.params.rejectionId, req);
    sendSuccess(res, 200, { data: order, message: "Replacement sample collected" });
  }),
  recordPrinted: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await labService.recordPrinted(req.user, req.params.id, req) });
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
    const attachment = await labService.uploadReport(req.user, req.params.id, parsed.data.fileUrl, parsed.data.fileType, req.file?.originalname, req);
    sendSuccess(res, 201, { data: attachment, message: "Report attached" });
  }),
  inventoryOverview: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labInventoryService.overview(req.query) });
  }),
  createInventoryItem: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await labInventoryService.createItem(req.user, req.body, req), message: "Inventory item created" });
  }),
  updateInventoryItem: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labInventoryService.updateItem(req.user, req.params.id, req.body, req), message: "Inventory item updated" });
  }),
  addInventoryBatch: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await labInventoryService.addBatch(req.user, req.body, req), message: "Stock batch received" });
  }),
  saveInventoryMapping: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labInventoryService.saveMapping(req.user, req.body, req), message: "Test mapping saved" });
  }),
  deleteInventoryMapping: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labInventoryService.removeMapping(req.user, req.params.id, req) });
  }),
  adjustInventory: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labInventoryService.adjust(req.user, req.body, req), message: "Stock adjustment recorded" });
  }),
  listInventoryMovements: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labInventoryService.listMovements() });
  }),
  getOverview: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await labAnalyticsService.overview(req.user) });
  }),
  getReports: asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = req.query as { from?: string; to?: string };
    const includeRevenue = req.user?.role === "ADMIN" || req.user?.role === "BILLING_MANAGER";
    sendSuccess(res, 200, { data: await labAnalyticsService.reports(from, to, includeRevenue) });
  }),
  listLedgerAccounts: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const { search, type } = req.query as Record<string, string | undefined>;
    sendSuccess(res, 200, { data: await labLedgerService.listAccounts(req.user, { ...page, search, type: type as "RECEIVABLE" | "PAYABLE" | undefined }, req) });
  }),
  createLedgerAccount: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await labLedgerService.createAccount(req.user, req.body, req), message: "Lab ledger account created" });
  }),
  getLedger: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    sendSuccess(res, 200, { data: await labLedgerService.getLedger(req.user, req.params.accountId, page, req) });
  }),
  recordLedgerPayment: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await labLedgerService.recordPayment(req.user, req.params.accountId, req.body, req), message: "Lab ledger payment recorded" });
  }),
  listReferringClinics: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labLedgerService.listReferringClinics() });
  }),
  listReferenceLabs: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await labLedgerService.listReferenceLabs() });
  }),
};

const router = Router();
router.get("/public/reports/:orderNumber/verify", validate({ params: publicLabReportParamSchema }), labController.verifyPublicReport);
router.use(authenticate);

router.get("/settings", requireRole(["ADMIN"]), labController.getLabSettings);
router.put("/settings", requireRole(["ADMIN"]), validate({ body: labSettingsSchema }), labController.setLabSettings);
router.get("/settings/order-policy", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST"]), labController.getLabOrderPolicy);
router.post("/settings/assets/:assetType", requireRole(["ADMIN"]), labSettingsImageUpload.single("file"), labController.uploadLabSettingsAsset);
router.get("/settings/report", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"]), labController.getReportSettings);
router.put("/settings/report", requireRole(["ADMIN"]), validate({ body: labReportSettingsSchema }), labController.setReportSettings);
router.get("/settings/verification", requireRole(["ADMIN"]), labController.getVerificationSetting);
router.put("/settings/verification", requireRole(["ADMIN"]), validate({ body: allowSameUserVerificationSchema }), labController.setVerificationSetting);
router.get("/settings/billing", requireRole(["ADMIN"]), labController.getBillingSettings);
router.put("/settings/billing", requireRole(["ADMIN"]), validate({ body: labBillingSettingsSchema }), labController.setBillingSettings);
router.get("/tests", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"]), validate({ query: listLabTestsQuerySchema }), labController.listTests);
router.post("/tests", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ body: createLabTestSchema }), labController.createTest);
router.patch("/tests/:id", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ params: idParamSchema, body: updateLabTestSchema }), labController.updateTest);
router.delete("/tests/:id", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ params: idParamSchema }), labController.deleteTest);
router.get("/packages", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"]), validate({ query: listLabPackagesQuerySchema }), labController.listPackages);
router.post("/packages", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ body: labPackageSchema }), labController.createPackage);
router.patch("/packages/:id", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ params: idParamSchema, body: labPackageSchema }), labController.updatePackage);
router.delete("/packages/:id", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ params: idParamSchema }), labController.deletePackage);

router.get("/overview", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"]), labController.getOverview);
router.get("/reports", requireRole(["ADMIN", "BILLING_MANAGER", "LAB_TECHNICIAN", "PATHOLOGIST"]), validate({ query: labReportsQuerySchema }), labController.getReports);
router.get("/ledger/accounts", requireRole(["ADMIN", "BILLING_MANAGER"]), validate({ query: labLedgerQuerySchema }), labController.listLedgerAccounts);
router.post("/ledger/accounts", requireRole(["ADMIN", "BILLING_MANAGER"]), validate({ body: createLabLedgerAccountSchema }), labController.createLedgerAccount);
router.get("/ledger/accounts/:accountId", requireRole(["ADMIN", "BILLING_MANAGER"]), validate({ params: labLedgerAccountParamSchema }), labController.getLedger);
router.post("/ledger/accounts/:accountId/payments", requireRole(["ADMIN", "BILLING_MANAGER"]), validate({ params: labLedgerAccountParamSchema, body: labLedgerPaymentSchema }), labController.recordLedgerPayment);
router.get("/ledger/referring-clinics", requireRole(["ADMIN", "BILLING_MANAGER", "DOCTOR", "RECEPTIONIST"]), labController.listReferringClinics);
router.get("/ledger/reference-labs", requireRole(["ADMIN", "BILLING_MANAGER", "LAB_TECHNICIAN"]), labController.listReferenceLabs);

router.get("/inventory", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ query: labInventoryQuerySchema }), labController.inventoryOverview);
router.post("/inventory/items", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ body: labInventoryItemSchema }), labController.createInventoryItem);
router.patch("/inventory/items/:id", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ params: labInventoryParamsSchema, body: labInventoryItemSchema }), labController.updateInventoryItem);
router.post("/inventory/batches", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ body: labInventoryBatchSchema }), labController.addInventoryBatch);
router.post("/inventory/mappings", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ body: labInventoryMappingSchema }), labController.saveInventoryMapping);
router.delete("/inventory/mappings/:id", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ params: labInventoryParamsSchema }), labController.deleteInventoryMapping);
router.post("/inventory/adjustments", requireRole(["ADMIN", "LAB_TECHNICIAN"]), validate({ body: labInventoryAdjustmentSchema }), labController.adjustInventory);
router.get("/inventory/movements", requireRole(["ADMIN", "LAB_TECHNICIAN"]), labController.listInventoryMovements);

router.get("/orders", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"]), validate({ query: listLabOrdersQuerySchema }), labController.list);
router.get("/orders/:id", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"]), validate({ params: idParamSchema }), labController.getById);
router.post("/orders", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST"]), validate({ body: createLabOrderSchema }), labController.createOrder);
router.post("/orders/packages", requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST"]), validate({ body: createLabPackageOrderSchema }), labController.createPackageOrder);
router.patch(
  "/orders/:id/sample-status",
  requireRole(["ADMIN", "LAB_TECHNICIAN"]),
  validate({ params: idParamSchema, body: updateSampleStatusSchema }),
  labController.updateSampleStatus
);
router.post(
  "/orders/:id/reject-sample",
  requireRole(["ADMIN", "LAB_TECHNICIAN"]),
  validate({ params: idParamSchema, body: rejectSampleSchema }),
  labController.rejectSample
);
router.post(
  "/orders/:id/sample-rejections/:rejectionId/recollect",
  requireRole(["ADMIN", "LAB_TECHNICIAN"]),
  validate({ params: recollectSampleParamSchema }),
  labController.recollectSample
);
router.post(
  "/orders/:id/printed",
  requireRole(["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"]),
  validate({ params: idParamSchema }),
  labController.recordPrinted
);
router.post(
  "/orders/:id/results",
  requireRole(["ADMIN", "LAB_TECHNICIAN"]),
  validate({ params: idParamSchema, body: enterResultSchema }),
  labController.enterResult
);
router.post(
  "/orders/:id/results/amend",
  requireRole(["ADMIN", "PATHOLOGIST"]),
  validate({ params: idParamSchema, body: amendResultSchema }),
  labController.amendResult
);
router.post("/orders/:id/verify", requireRole(["ADMIN", "PATHOLOGIST"]), validate({ params: idParamSchema }), labController.verify);
router.post(
  "/orders/:id/attachments",
  requireRole(["ADMIN", "LAB_TECHNICIAN", "PATHOLOGIST"]),
  reportUpload.single("file"),
  validate({ params: idParamSchema }),
  labController.uploadReport
);

export default router;
