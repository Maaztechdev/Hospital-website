import { Request, Response, Router } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { billingService } from "./billing.service";
import { createInvoiceSchema, idParamSchema, listInvoicesQuerySchema, recordPaymentSchema, voidInvoiceSchema } from "./billing.validators";

export const billingController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { patientId, status, search, itemType } = req.query as Record<string, string | undefined>;
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await billingService.list(req.user, { ...page, patientId, status, search, itemType });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
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
  voidInvoice: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const invoice = await billingService.voidInvoice(req.user, req.params.id, req.body.reason, req);
    sendSuccess(res, 200, { data: invoice, message: "Invoice voided" });
  }),
};

const router = Router();
router.use(authenticate);

router.get("/invoices", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]), validate({ query: listInvoicesQuerySchema }), billingController.list);
router.get("/invoices/:id", requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]), validate({ params: idParamSchema }), billingController.getById);
router.post(
  "/invoices",
  requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]),
  validate({ body: createInvoiceSchema }),
  billingController.create
);
router.post(
  "/invoices/:id/payments",
  requireRole(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]),
  validate({ params: idParamSchema, body: recordPaymentSchema }),
  billingController.recordPayment
);
router.post(
  "/invoices/:id/void",
  requireRole(["ADMIN", "BILLING_MANAGER"]),
  validate({ params: idParamSchema, body: voidInvoiceSchema }),
  billingController.voidInvoice
);

export default router;
