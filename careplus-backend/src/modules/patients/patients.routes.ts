import { Router } from "express";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { patientsController } from "./patients.controller";
import { permissions } from "@common/permissions";
import {
  createPatientSchema,
  clinicalHistoryUpdateSchema,
  idParamSchema,
  listPatientsQuerySchema,
  mergePatientsSchema,
  updatePatientSchema,
} from "./patients.validators";

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /patients:
 *   get:
 *     tags: [Patients]
 *     summary: Search/list patients by name, phone, or MR number (paginated)
 *     responses:
 *       200: { description: OK }
 */
router.get("/", requireRole(permissions.patients.view), validate({ query: listPatientsQuerySchema }), patientsController.list);

router.get("/:id/profile", requireRole(permissions.patients.view), validate({ params: idParamSchema }), patientsController.getProfile);
router.get("/:id/print-summary", requireRole(permissions.patients.view), validate({ params: idParamSchema }), patientsController.printSummary);
router.get("/:id/clinical-summary", requireRole(permissions.patients.view), validate({ params: idParamSchema }), patientsController.getClinicalSummary);
router.patch("/:id/clinical-summary", requireRole(["ADMIN", "DOCTOR"]), validate({ params: idParamSchema, body: clinicalHistoryUpdateSchema }), patientsController.updateClinicalHistory);
router.get("/:id", requireRole(permissions.patients.view), validate({ params: idParamSchema }), patientsController.getById);

/**
 * @openapi
 * /patients:
 *   post:
 *     tags: [Patients]
 *     summary: Register a new patient (auto-generates MR-YYYY-NNNNNN)
 *     responses:
 *       201: { description: Created }
 *       409: { description: Possible duplicate by phone/CNIC }
 */
router.post(
  "/",
  requireRole(permissions.patients.create),
  validate({ body: createPatientSchema }),
  patientsController.create
);

router.patch(
  "/:id",
  requireRole(permissions.patients.edit),
  validate({ params: idParamSchema, body: updatePatientSchema }),
  patientsController.update
);

router.delete("/:id", requireRole(["ADMIN"]), validate({ params: idParamSchema }), patientsController.remove);

/**
 * @openapi
 * /patients/merge:
 *   post:
 *     tags: [Patients]
 *     summary: Merge a duplicate patient record into a primary record (admin only)
 *     responses:
 *       200: { description: OK }
 */
router.post("/merge", requireRole(["ADMIN"]), validate({ body: mergePatientsSchema }), patientsController.merge);

export default router;
