import { Request, Response, Router } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { prescriptionsService } from "./prescriptions.service";
import { createPrescriptionSchema, idParamSchema, listPrescriptionsQuerySchema, voidPrescriptionSchema } from "./prescriptions.validators";

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
};

const router = Router();
router.use(authenticate);

router.get("/", requireRole(["ADMIN", "DOCTOR", "PHARMACIST", "NURSE"]), validate({ query: listPrescriptionsQuerySchema }), prescriptionsController.list);
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
