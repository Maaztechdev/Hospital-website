import { Request, Response, Router } from "express";
import { InvoiceDepartment, Role } from "@prisma/client";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { billingService } from "./billing.service";
import {
  billingDateRangeSchema,
  billingStaffQuerySchema,
  createInvoiceSchema,
  idParamSchema,
  listInvoicesQuerySchema,
  recordPaymentSchema,
  refundInvoiceSchema,
  voidInvoiceSchema,
} from "./billing.validators";

export const billingController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { patientId, status, search, itemType, department, dateFrom, dateTo, createdBy, departments } = req.query as Record<string, string | string[] | undefined>;
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await billingService.list(req.user, {
      ...page,
      patientId: patientId as string | undefined,
      status: status as string | undefined,
      search: search as string | undefined,
      itemType: itemType as string | undefined,
      department: department as InvoiceDepartment | undefined,
      departments: departments as InvoiceDepartment[] | undefined,
      dateFrom: dateFrom as string | undefined,
      dateTo: dateTo as string | undefined,
      createdBy: createdBy as string | undefined,
    });
    sendSuccess(res, 200, { data: items, pagination: { ...paginationMeta(page.page, page.limit, total), pageSize: page.limit } });
  }),
  staff: asyncHandler(async (req: Request, res: Response) => {
    const { department } = req.query as Record<string, string | undefined>;
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await billingService.listStaff(req.user, department as InvoiceDepartment | undefined) });
  }),
  summary: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    sendSuccess(res, 200, { data: await billingService.summary(req.user, { dateFrom, dateTo }) });
  }),
  history: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await billingService.history(req.user, page);
    sendSuccess(res, 200, { data: items, pagination: { ...paginationMeta(page.page, page.limit, total), pageSize: page.limit } });
  }),
  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await billingService.getById(req.user, req.params.id) });
  }),
  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const invoice = await billingService.create(req.user, req.body, req);
    sendSuccess(res, 201, { data: invoice, message: "Invoice created" });
  }),
  recordPayment: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const invoice = await billingService.recordPayment(req.user, req.params.id, req.body, req);
    sendSuccess(res, 200, { data: invoice, message: "Payment recorded" });
  }),
  refund: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const invoice = await billingService.refund(req.user, req.params.id, req.body, req);
    sendSuccess(res, 200, { data: invoice, message: "Refund recorded" });
  }),
  voidInvoice: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const invoice = await billingService.voidInvoice(req.user, req.params.id, req.body.reason, req);
    sendSuccess(res, 200, { data: invoice, message: "Invoice voided" });
  }),
};

const router = Router();
router.use(authenticate);

const billingRoles: Role[] = [
  "ADMIN",
  "BILLING_MANAGER",
  "RECEPTIONIST",
  "LAB_TECHNICIAN",
  "PHARMACIST",
  "ULTRASOUND_TECH",
  "ULTRASOUND_TECHNICIAN",
];

router.get("/summary", requireRole(["ADMIN", "BILLING_MANAGER"]), validate({ query: billingDateRangeSchema }), billingController.summary);
router.get("/history", requireRole(["ADMIN", "BILLING_MANAGER"]), billingController.history);
router.get("/staff", requireRole(billingRoles), validate({ query: billingStaffQuerySchema }), billingController.staff);
router.get("/invoices", requireRole(billingRoles), validate({ query: listInvoicesQuerySchema }), billingController.list);
router.get("/invoices/:id", requireRole(billingRoles), validate({ params: idParamSchema }), billingController.getById);
router.post(
  "/invoices",
  requireRole(billingRoles),
  validate({ body: createInvoiceSchema }),
  billingController.create
);
router.post(
  "/invoices/:id/payments",
  requireRole(billingRoles),
  validate({ params: idParamSchema, body: recordPaymentSchema }),
  billingController.recordPayment
);
router.post(
  "/invoices/:id/refunds",
  requireRole(["ADMIN", "BILLING_MANAGER"]),
  validate({ params: idParamSchema, body: refundInvoiceSchema }),
  billingController.refund
);
router.post(
  "/invoices/:id/void",
  requireRole(["ADMIN", "BILLING_MANAGER"]),
  validate({ params: idParamSchema, body: voidInvoiceSchema }),
  billingController.voidInvoice
);

export default router;
