import { Router } from "express";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { patientsController } from "./patients.controller";
import {
  createPatientSchema,
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
router.get("/", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ query: listPatientsQuerySchema }), patientsController.list);

router.get("/:id", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), patientsController.getById);

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
  requireRole(["ADMIN", "RECEPTIONIST"]),
  validate({ body: createPatientSchema }),
  patientsController.create
);

router.patch(
  "/:id",
  requireRole(["ADMIN", "RECEPTIONIST"]),
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
