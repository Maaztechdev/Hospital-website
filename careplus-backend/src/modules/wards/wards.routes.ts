import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { wardsService } from "./wards.service";
import {
  createWardMedicineOrder,
  ipdBillingService,
  issueWardMedicineOrder,
  listActiveWardAdmissions,
  listWardMedicineOrders,
  recordIpdRefund,
  returnWardMedicine,
} from "@modules/ipd/ipdBilling.service";
import {
  admitPatientSchema,
  createBedSchema,
  createRoomSchema,
  bulkRoomBedSchema,
  createWardSchema,
  dischargeSchema,
  idParamSchema,
  listAdmissionsQuerySchema,
  listWardsQuerySchema,
  recordAdmissionDepositSchema,
  transferBedSchema,
  updateWardSchema,
} from "./wards.validators";

const bedStatusSchema = z.object({ status: z.enum(["AVAILABLE", "CLEANING", "MAINTENANCE", "RESERVED"]) });
const ignoreDoctorAdmissionFinancialFields = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user?.role === "DOCTOR" && req.body && typeof req.body === "object") {
    delete req.body.depositAmount;
    delete req.body.dailyRate;
    delete req.body.expectedStayDays;
    req.body.depositAmount = 0;
  }
  next();
};

export const wardsController = {
  listWards: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await wardsService.listWards(req.query.includeInactive === "true") });
  }),
  createWard: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.createWard(req.user, req.body, req), message: "Ward created" });
  }),
  updateWard: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardsService.updateWard(req.user, req.params.id, req.body, req), message: "Ward configuration updated" });
  }),
  deleteWard: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardsService.deleteWard(req.user, req.params.id, req), message: "Ward type archived" });
  }),
  createRoom: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.createRoom(req.user, req.body, req), message: "Room created" });
  }),
  createBed: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.createBed(req.user, req.body, req), message: "Bed created" });
  }),
  bulkUpdateRoomBeds: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    await wardsService.bulkUpdateRoomBeds(req.user, req.body, req);
    sendSuccess(res, 200, { data: await wardsService.listWards(true), message: "Rooms and beds updated" });
  }),
  bedAvailability: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await wardsService.bedAvailability() });
  }),
  setBedStatus: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardsService.setBedStatus(req.user, req.params.id, req.body.status, req), message: "Bed status updated" });
  }),
  listAdmissions: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { status, patientId } = req.query as Record<string, string | undefined>;
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await wardsService.listAdmissions(req.user, { ...page, status, patientId });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),
  getAdmission: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardsService.getAdmission(req.user, req.params.id) });
  }),
  printDischarge: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardsService.getDischargePrintData(req.user, req.params.id) });
  }),
  printAdmissionSlip: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardsService.getAdmissionSlip(req.user, req.params.id) });
  }),
  admit: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.admit(req.user, req.body, req), message: "Patient admitted" });
  }),
  recordAdmissionDeposit: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.recordAdmissionDeposit(req.user, req.params.id, req.body, req), message: "Admission deposit recorded" });
  }),
  transferBed: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const updated = await wardsService.transferBed(req.user, req.params.id, req.body.toBedId, req.body.reason, req);
    sendSuccess(res, 200, { data: updated, message: "Patient transferred" });
  }),
  discharge: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const updated = await wardsService.discharge(req.user, req.params.id, req.body, req);
    sendSuccess(res, 200, { data: updated, message: "Patient discharged" });
  }),
  runningBill: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ipdBillingService.getRunningBill(req.user, req.params.id, req) });
  }),
  addServiceLine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await ipdBillingService.addServiceCharge(req.user, req.params.id, req.body, req), message: "IPD service charge added" });
  }),
  reverseServiceLine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await ipdBillingService.reverseLine(req.user, req.params.id, req.params.itemId, req.body.reason, req), message: "IPD line reversed" });
  }),
  serviceCatalog: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ipdBillingService.listServiceCharges(req.user) });
  }),
  createServiceCatalogEntry: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await ipdBillingService.createServiceCharge(req.user, req.body, req), message: "IPD service charge created" });
  }),
  createWardMedicineOrder: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await createWardMedicineOrder(req.user, req.params.id, req.body, req), message: "Ward medicine order created" });
  }),
  issueWardMedicineOrder: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await issueWardMedicineOrder(req.user, req.params.id, req.params.orderId, req), message: "Ward medicines issued" });
  }),
  returnWardMedicine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await returnWardMedicine(req.user, req.params.id, req.params.orderItemId, req.body, req), message: "Ward medicine return recorded" });
  }),
  ipdPayment: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await ipdBillingService.recordPayment(req.user, req.params.id, req.body, req), message: "IPD payment recorded" });
  }),
  ipdRefund: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await recordIpdRefund(req.user, req.params.id, req.body, req), message: "IPD refund recorded" });
  }),
  settleIpd: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await ipdBillingService.settle(req.user, req.params.id, req.body, req), message: "IPD invoice settled" });
  }),
};

const router = Router();
router.use(authenticate);

const uuidSchema = z.string().uuid();
const serviceLineSchema = z.object({
  serviceChargeId: uuidSchema,
  amount: z.number().nonnegative().optional(),
  quantity: z.number().int().positive().default(1),
});
const serviceCatalogSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  defaultPrice: z.number().nonnegative(),
});
const wardMedicineOrderSchema = z.object({
  orderNote: z.string().trim().min(1).max(500),
  items: z.array(z.object({ medicineId: uuidSchema, quantity: z.number().int().positive() })).min(1),
});
const medicineReturnSchema = z.object({ quantity: z.number().int().positive(), reason: z.string().trim().min(1).max(500) });
const ipdPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "ONLINE", "CREDIT"]),
  purpose: z.enum(["DEPOSIT", "PAYMENT"]),
  notes: z.string().max(500).optional(),
  referenceNumber: z.string().max(120).optional(),
});
const refundSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "ONLINE", "CREDIT"]),
  reason: z.string().trim().min(1).max(500),
});
const settleSchema = z.object({
  paymentMethod: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "ONLINE", "CREDIT"]),
  refundReason: z.string().trim().max(500).optional(),
});
const ipdInvoiceListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["DRAFT", "FINALIZED", "PAID", "PARTIAL", "REFUNDED", "PARTIALLY_REFUNDED", "UNPAID", "VOID"]).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  patientId: uuidSchema.optional(),
  createdBy: uuidSchema.optional(),
  search: z.string().trim().max(120).optional(),
}).superRefine(({ dateFrom, dateTo }, context) => {
  if (dateFrom && dateTo && dateFrom > dateTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "End date must be on or after start date" });
  }
});

router.get("/service-charges", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), wardsController.serviceCatalog);
router.get("/medicine-orders/admissions", requireRole(["ADMIN", "PHARMACIST"]), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  sendSuccess(res, 200, { data: await listActiveWardAdmissions(req.user) });
}));
router.post("/service-charges", requireRole(["ADMIN"]), validate({ body: serviceCatalogSchema }), wardsController.createServiceCatalogEntry);
router.get("/ipd/invoices", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]), validate({ query: ipdInvoiceListQuerySchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const page = getPageParams(req);
  const { items, total } = await ipdBillingService.listInvoices(req.user, {
    ...page,
    dateFrom: req.query.dateFrom as string | undefined,
    dateTo: req.query.dateTo as string | undefined,
    patientId: req.query.patientId as string | undefined,
    createdBy: req.query.createdBy as string | undefined,
    search: req.query.search as string | undefined,
    status: req.query.status as string | undefined,
  });
  sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
}));

router.get("/", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ query: listWardsQuerySchema }), wardsController.listWards);
router.post("/", requireRole(["ADMIN"]), validate({ body: createWardSchema }), wardsController.createWard);
router.patch("/:id", requireRole(["ADMIN"]), validate({ params: idParamSchema, body: updateWardSchema }), wardsController.updateWard);
router.delete("/:id", requireRole(["ADMIN"]), validate({ params: idParamSchema }), wardsController.deleteWard);
router.post("/rooms", requireRole(["ADMIN"]), validate({ body: createRoomSchema }), wardsController.createRoom);
router.post("/beds", requireRole(["ADMIN"]), validate({ body: createBedSchema }), wardsController.createBed);
router.post("/rooms-beds/batch", requireRole(["ADMIN"]), validate({ body: bulkRoomBedSchema }), wardsController.bulkUpdateRoomBeds);
router.get("/beds/availability", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), wardsController.bedAvailability);
router.patch("/beds/:id/status", requireRole(["ADMIN", "NURSE"]), validate({ params: idParamSchema, body: bedStatusSchema }), wardsController.setBedStatus);

router.get("/admissions", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ query: listAdmissionsQuerySchema }), wardsController.listAdmissions);
router.get("/admissions/:id/print", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), wardsController.printDischarge);
router.get("/admissions/:id/slip", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), wardsController.printAdmissionSlip);
router.get("/admissions/:id", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), wardsController.getAdmission);
router.post("/admissions", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), ignoreDoctorAdmissionFinancialFields, validate({ body: admitPatientSchema }), wardsController.admit);
router.post(
  "/admissions/:id/deposits",
  requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]),
  validate({ params: idParamSchema, body: recordAdmissionDepositSchema }),
  wardsController.recordAdmissionDeposit
);
router.get("/admissions/:id/running-bill", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), wardsController.runningBill);
router.get("/admissions/:id/medicine-orders", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  sendSuccess(res, 200, { data: await listWardMedicineOrders(req.user, req.params.id) });
}));
router.post("/admissions/:id/service-lines", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ params: idParamSchema, body: serviceLineSchema }), wardsController.addServiceLine);
router.post("/admissions/:id/invoice-items/:itemId/reversals", requireRole(["ADMIN", "BILLING_MANAGER"]), validate({ params: idParamSchema.extend({ itemId: uuidSchema }), body: z.object({ reason: z.string().trim().min(1).max(500) }) }), wardsController.reverseServiceLine);
router.post("/admissions/:id/medicine-orders", requireRole(["DOCTOR", "NURSE"]), validate({ params: idParamSchema, body: wardMedicineOrderSchema }), wardsController.createWardMedicineOrder);
router.post("/admissions/:id/medicine-orders/:orderId/issue", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: idParamSchema.extend({ orderId: uuidSchema }) }), wardsController.issueWardMedicineOrder);
router.post("/admissions/:id/medicine-order-items/:orderItemId/returns", requireRole(["ADMIN", "PHARMACIST"]), validate({ params: idParamSchema.extend({ orderItemId: uuidSchema }), body: medicineReturnSchema }), wardsController.returnWardMedicine);
router.post("/admissions/:id/payments", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]), validate({ params: idParamSchema, body: ipdPaymentSchema }), wardsController.ipdPayment);
router.post("/admissions/:id/refunds", requireRole(["ADMIN", "BILLING_MANAGER"]), validate({ params: idParamSchema, body: refundSchema }), wardsController.ipdRefund);
router.post("/admissions/:id/settle", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]), validate({ params: idParamSchema, body: settleSchema }), wardsController.settleIpd);
router.post(
  "/admissions/:id/transfer",
  requireRole(["ADMIN", "NURSE", "DOCTOR"]),
  validate({ params: idParamSchema, body: transferBedSchema }),
  wardsController.transferBed
);
router.post(
  "/admissions/:id/discharge",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema, body: dischargeSchema }),
  wardsController.discharge
);

export default router;
