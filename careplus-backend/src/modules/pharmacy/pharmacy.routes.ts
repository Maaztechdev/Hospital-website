import { Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { BadRequestError, UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { pharmacyService } from "./pharmacy.service";
import {
  addBatchSchema,
  adjustSchema,
  createMedicineSchema,
  dispenseSchema,
  dispensePrescriptionSchema,
  discountAuditQuerySchema,
  idParamSchema,
  listMedicinesQuerySchema,
  markDamagedExpiredSchema,
  pharmacyInvoiceParamSchema,
  pharmacyInvoiceListQuerySchema,
  pharmacyAdminPinSchema,
  pharmacySettingsSchema,
  pharmacyLedgerAccountParamSchema,
  pharmacyLedgerAccountSchema,
  pharmacyLedgerAccountsQuerySchema,
  pharmacyLedgerAdjustmentSchema,
  pharmacyLedgerPaymentSchema,
  pharmacyReportQuerySchema,
  pharmacySaleAdjustmentQuerySchema,
  pharmacySaleReturnSchema,
  pharmacySaleSchema,
  pharmacySaleVoidSchema,
  returnSchema,
  stockInSchema,
  updateMedicineSchema,
} from "./pharmacy.validators";

export const pharmacyController = {
  getPharmacySettings: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await pharmacyService.getPharmacySettings(req.user, req) });
  }),
  updatePharmacySettings: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await pharmacyService.updatePharmacySettings(req.user, req.body, req), message: "Pharmacy settings saved" });
  }),
  updatePharmacyAdminPin: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await pharmacyService.updatePharmacyAdminPin(req.user, req.body, req), message: "Admin PIN updated" });
  }),
  uploadPharmacyLogo: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await pharmacyService.uploadPharmacyLogo(req.user, req.file, req), message: "Pharmacy logo updated" });
  }),
  listMedicineCategories: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await pharmacyService.listMedicineCategories() });
  }),
  listMedicines: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { search, lowStock, nearExpiry, categoryId } = req.query as Record<string, string | undefined>;
    const { items, total } = await pharmacyService.listMedicines({ ...page, search, lowStock, nearExpiry, categoryId });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),
  createMedicine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const medicine = await pharmacyService.createMedicine(req.user, req.body, req);
    sendSuccess(res, 201, { data: medicine, message: "Medicine added to catalog" });
  }),
  updateMedicine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const medicine = await pharmacyService.updateMedicine(req.user, req.params.id, req.body, req);
    sendSuccess(res, 200, { data: medicine, message: "Medicine updated" });
  }),
  archiveMedicine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const medicine = await pharmacyService.archiveMedicine(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: medicine, message: "Medicine archived" });
  }),
  addBatch: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const batch = await pharmacyService.addBatch(req.user, req.body, req);
    sendSuccess(res, 201, { data: batch, message: "Batch added" });
  }),
  stockIn: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const batch = await pharmacyService.stockIn(req.user, req.body, req);
    sendSuccess(res, 200, { data: batch, message: "Stock added" });
  }),
  dispense: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const item = await pharmacyService.dispense(req.user, req.body, req);
    sendSuccess(res, 200, { data: item, message: "Medicine dispensed (FEFO)" });
  }),
  dispensePrescription: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await pharmacyService.dispensePrescription(req.user, req.params.id, req.body, req);
    sendSuccess(res, 201, { data: result, message: "Prescription dispensed and pharmacy invoice created" });
  }),
  createSale: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const sale = await pharmacyService.createSale(req.user, req.body, req);
    sendSuccess(res, 201, { data: sale, message: "Pharmacy sale recorded" });
  }),
  listPharmacyInvoices: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const { search, from, to } = req.query as Record<string, string | undefined>;
    if (from && to && from > to) throw new BadRequestError("from must be on or before to");
    const result = await pharmacyService.listPharmacyInvoices(req.user, { ...page, search, from, to }, req);
    sendSuccess(res, 200, { data: { items: result.items, pagination: paginationMeta(page.page, page.limit, result.total) } });
  }),
  getPharmacyReports: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const query = req.query as unknown as z.infer<typeof pharmacyReportQuerySchema>;
    if (query.period === "custom" && (!query.from || !query.to)) {
      throw new BadRequestError("Both from and to are required for a custom report range.");
    }
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestError("to must be on or after from.");
    }
    sendSuccess(res, 200, { data: await pharmacyService.pharmacyReports(req.user, query, req) });
  }),
  getPharmacyOverview: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await pharmacyService.pharmacyOverview(req.user, req) });
  }),
  listPharmacyLedgerAccounts: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const { search, type, patientId } = req.query as Record<string, string | undefined>;
    const result = await pharmacyService.listPharmacyLedgerAccounts(req.user, { ...page, search, type: type as "RECEIVABLE" | "PAYABLE" | undefined, patientId }, req);
    sendSuccess(res, 200, { data: result });
  }),
  createPharmacyLedgerAccount: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const account = await pharmacyService.createPharmacyLedgerAccount(req.user, req.body, req);
    sendSuccess(res, 201, { data: account, message: "Khata account created" });
  }),
  getPharmacyLedger: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const ledger = await pharmacyService.getPharmacyLedger(req.user, req.params.accountId, page, req);
    sendSuccess(res, 200, { data: ledger });
  }),
  recordPharmacyLedgerPayment: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await pharmacyService.recordPharmacyLedgerPayment(req.user, req.params.accountId, req.body, req);
    sendSuccess(res, 201, { data: result, message: "Khata payment recorded" });
  }),
  adjustPharmacyLedger: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await pharmacyService.adjustPharmacyLedger(req.user, req.params.accountId, req.body, req);
    sendSuccess(res, 201, { data: result, message: "Khata adjustment recorded" });
  }),
  getSaleInvoice: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await pharmacyService.getSaleInvoice(req.user, req.params.id) });
  }),
  getPharmacyInvoice: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await pharmacyService.getPharmacyInvoice(req.user, req.params.invoiceId, req) });
  }),
  voidSale: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const invoice = await pharmacyService.voidSale(req.user, req.params.invoiceId, req.body.reason, req);
    sendSuccess(res, 200, { data: invoice, message: "Pharmacy sale voided and stock restored" });
  }),
  returnSale: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const adjustment = await pharmacyService.returnSale(req.user, req.params.invoiceId, req.body, req);
    sendSuccess(res, 201, { data: adjustment, message: "Pharmacy return recorded" });
  }),
  listSaleAdjustments: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const { from, to, type } = req.query as Record<string, string | undefined>;
    if (from && to && from > to) throw new BadRequestError("from must be on or before to");
    const result = await pharmacyService.listSaleAdjustments(req.user, { ...page, from, to, type: type as "VOID" | "RETURN" | undefined }, req);
    sendSuccess(res, 200, { data: { items: result.items, pagination: paginationMeta(page.page, page.limit, result.total) } });
  }),
  returnStock: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const batch = await pharmacyService.returnStock(req.user, req.body, req);
    sendSuccess(res, 200, { data: batch, message: "Stock returned" });
  }),
  adjust: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const batch = await pharmacyService.adjust(req.user, req.body, req);
    sendSuccess(res, 200, { data: batch, message: "Stock adjusted" });
  }),
  markDamagedExpired: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const batch = await pharmacyService.markDamagedOrExpired(req.user, req.body, req);
    sendSuccess(res, 200, { data: batch, message: "Batch quantity written off" });
  }),
  listStockMovements: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { batchId, medicineId } = req.query as Record<string, string | undefined>;
    const { items, total } = await pharmacyService.listStockMovements({ ...page, batchId, medicineId });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),
  listDiscountAudits: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const { from, to, cashier } = req.query as Record<string, string | undefined>;
    if (from && to && from > to) throw new BadRequestError("from must be on or before to");
    const result = await pharmacyService.listDiscountAudits(req.user, { ...page, from, to, cashier }, req);
    sendSuccess(res, 200, { data: { items: result.items, totalDiscountAmount: result.totalDiscountAmount, pagination: paginationMeta(page.page, page.limit, result.total) } });
  }),
};

const router = Router();
router.use(authenticate);
const pharmacyLogoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.get("/settings", requireRole(["ADMIN", "PHARMACIST"]), pharmacyController.getPharmacySettings);
router.put("/settings", requireRole(["ADMIN"]), validate({ body: pharmacySettingsSchema }), pharmacyController.updatePharmacySettings);
router.put("/settings/admin-pin", requireRole(["ADMIN"]), validate({ body: pharmacyAdminPinSchema }), pharmacyController.updatePharmacyAdminPin);
router.post("/settings/logo", requireRole(["ADMIN"]), pharmacyLogoUpload.single("file"), pharmacyController.uploadPharmacyLogo);
router.get("/categories", requireRole(["ADMIN", "PHARMACIST"]), pharmacyController.listMedicineCategories);
router.get("/medicines", requireRole(["ADMIN", "PHARMACIST", "DOCTOR"]), validate({ query: listMedicinesQuerySchema }), pharmacyController.listMedicines);
router.post("/medicines", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: createMedicineSchema }), pharmacyController.createMedicine);
router.patch("/medicines/:id", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: idParamSchema, body: updateMedicineSchema }), pharmacyController.updateMedicine);
router.delete("/medicines/:id", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: idParamSchema }), pharmacyController.archiveMedicine);
router.post("/batches", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: addBatchSchema }), pharmacyController.addBatch);
router.post("/stock-in", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: stockInSchema }), pharmacyController.stockIn);

/**
 * @openapi
 * /pharmacy/dispense:
 *   post:
 *     tags: [Pharmacy]
 *     summary: Dispense against a SIGNED prescription item using FEFO batch selection
 *     responses:
 *       200: { description: OK }
 *       409: { description: Prescription not signed, or insufficient non-expired stock }
 */
router.post("/dispense", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: dispenseSchema }), pharmacyController.dispense);
router.post("/prescriptions/:id/dispense", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: idParamSchema, body: dispensePrescriptionSchema }), pharmacyController.dispensePrescription);
router.post("/sales", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: pharmacySaleSchema }), pharmacyController.createSale);
router.get("/khata/accounts", requireRole(["ADMIN", "PHARMACIST"]), validate({ query: pharmacyLedgerAccountsQuerySchema }), pharmacyController.listPharmacyLedgerAccounts);
router.post("/khata/accounts", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: pharmacyLedgerAccountSchema }), pharmacyController.createPharmacyLedgerAccount);
router.get("/khata/accounts/:accountId", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: pharmacyLedgerAccountParamSchema }), pharmacyController.getPharmacyLedger);
router.post("/khata/accounts/:accountId/payments", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: pharmacyLedgerAccountParamSchema, body: pharmacyLedgerPaymentSchema }), pharmacyController.recordPharmacyLedgerPayment);
router.post("/khata/accounts/:accountId/adjustments", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: pharmacyLedgerAccountParamSchema, body: pharmacyLedgerAdjustmentSchema }), pharmacyController.adjustPharmacyLedger);
router.get("/overview", requireRole(["ADMIN", "PHARMACIST"]), pharmacyController.getPharmacyOverview);
router.get("/reports", requireRole(["ADMIN", "PHARMACIST"]), validate({ query: pharmacyReportQuerySchema }), pharmacyController.getPharmacyReports);
router.get("/invoices", requireRole(["ADMIN", "PHARMACIST"]), validate({ query: pharmacyInvoiceListQuerySchema }), pharmacyController.listPharmacyInvoices);
router.get("/sales/:id/invoice", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: idParamSchema }), pharmacyController.getSaleInvoice);
router.get("/invoices/:invoiceId", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: pharmacyInvoiceParamSchema }), pharmacyController.getPharmacyInvoice);
router.post("/invoices/:invoiceId/void", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: pharmacyInvoiceParamSchema, body: pharmacySaleVoidSchema }), pharmacyController.voidSale);
router.post("/invoices/:invoiceId/returns", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: pharmacyInvoiceParamSchema, body: pharmacySaleReturnSchema }), pharmacyController.returnSale);
router.get("/sale-adjustments", requireRole(["ADMIN", "PHARMACIST"]), validate({ query: pharmacySaleAdjustmentQuerySchema }), pharmacyController.listSaleAdjustments);
router.get("/discount-audits", requireRole(["ADMIN", "PHARMACIST"]), validate({ query: discountAuditQuerySchema }), pharmacyController.listDiscountAudits);

router.post("/return", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: returnSchema }), pharmacyController.returnStock);
router.post("/adjust", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: adjustSchema }), pharmacyController.adjust);
router.post(
  "/write-off",
  requireRole(["ADMIN", "PHARMACIST"]),
  validate({ body: markDamagedExpiredSchema }),
  pharmacyController.markDamagedExpired
);
router.get("/stock-movements", requireRole(["ADMIN", "PHARMACIST"]), pharmacyController.listStockMovements);

export default router;
