import { Router } from "express";
import { z } from "zod";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { consultationsController } from "./consultations.controller";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import { searchIcd10 } from "@common/validation/icd10";
import {
  createConsultationSchema,
  createConsultationAddendumSchema,
  idParamSchema,
  listConsultationsQuerySchema,
  startConsultationSchema,
  updateConsultationSchema,
} from "./consultations.validators";

const router = Router();
router.use(authenticate);

const icd10QuerySchema = z.object({ q: z.string().trim().min(2).max(100) });
router.get("/icd10", requireRole(["ADMIN", "DOCTOR"]), validate({ query: icd10QuerySchema }), asyncHandler(async (req, res) => {
  const query = (req.query as z.infer<typeof icd10QuerySchema>).q;
  sendSuccess(res, 200, { data: searchIcd10(query) });
}));
router.get("/", requireRole(["ADMIN", "DOCTOR", "NURSE"]), validate({ query: listConsultationsQuerySchema }), consultationsController.list);
router.post("/start", requireRole(["ADMIN", "DOCTOR"]), validate({ body: startConsultationSchema }), consultationsController.start);
router.get("/:id", requireRole(["ADMIN", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), consultationsController.getById);

router.post(
  "/",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ body: createConsultationSchema }),
  consultationsController.create
);

router.patch(
  "/:id",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: idParamSchema, body: updateConsultationSchema }),
  consultationsController.update
);

/**
 * @openapi
 * /consultations/{id}/sign:
 *   post:
 *     tags: [Consultations]
 *     summary: Sign a consultation — becomes read-only at the DB/service layer
 *     responses:
 *       200: { description: OK }
 */
router.post("/:id/sign", requireRole(["ADMIN", "DOCTOR"]), validate({ params: idParamSchema }), consultationsController.sign);
router.post("/:id/complete", requireRole(["ADMIN", "DOCTOR"]), validate({ params: idParamSchema }), consultationsController.complete);
router.post("/:id/addenda", requireRole(["ADMIN", "DOCTOR"]), validate({ params: idParamSchema, body: createConsultationAddendumSchema }), consultationsController.addAddendum);

export default router;
