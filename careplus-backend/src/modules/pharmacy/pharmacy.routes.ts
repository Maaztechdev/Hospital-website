import { Request, Response, Router } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { pharmacyService } from "./pharmacy.service";
import {
  addBatchSchema,
  adjustSchema,
  createMedicineSchema,
  dispenseSchema,
  idParamSchema,
  listMedicinesQuerySchema,
  markDamagedExpiredSchema,
  pharmacySaleSchema,
  returnSchema,
  stockInSchema,
} from "./pharmacy.validators";

export const pharmacyController = {
  listMedicines: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { search, lowStock, nearExpiry } = req.query as Record<string, string | undefined>;
    const { items, total } = await pharmacyService.listMedicines({ ...page, search, lowStock, nearExpiry });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),
  createMedicine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const medicine = await pharmacyService.createMedicine(req.user, req.body, req);
    sendSuccess(res, 201, { data: medicine, message: "Medicine added to catalog" });
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
  createSale: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const sale = await pharmacyService.createSale(req.user, req.body, req);
    sendSuccess(res, 201, { data: sale, message: "Pharmacy sale recorded" });
  }),
  getSaleInvoice: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await pharmacyService.getSaleInvoice(req.user, req.params.id) });
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
};

const router = Router();
router.use(authenticate);

router.get("/medicines", requireRole(["ADMIN", "PHARMACIST", "DOCTOR"]), validate({ query: listMedicinesQuerySchema }), pharmacyController.listMedicines);
router.post("/medicines", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: createMedicineSchema }), pharmacyController.createMedicine);
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
router.post("/sales", requireRole(["ADMIN", "PHARMACIST"]), validate({ body: pharmacySaleSchema }), pharmacyController.createSale);
router.get("/sales/:id/invoice", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: idParamSchema }), pharmacyController.getSaleInvoice);

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
