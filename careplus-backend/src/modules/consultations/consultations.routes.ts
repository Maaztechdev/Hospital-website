import { Router } from "express";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { consultationsController } from "./consultations.controller";
import {
  createConsultationSchema,
  idParamSchema,
  listConsultationsQuerySchema,
  updateConsultationSchema,
} from "./consultations.validators";

const router = Router();
router.use(authenticate);

router.get("/", requireRole(["ADMIN", "DOCTOR", "NURSE"]), validate({ query: listConsultationsQuerySchema }), consultationsController.list);
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

export default router;
