import { Router } from "express";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { appointmentsController } from "@modules/appointments/appointments.controller";

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /opd-queue:
 *   get:
 *     tags: [OPD Queue]
 *     summary: Derived queue view — appointments where status IN (CONFIRMED, WAITING)
 *     responses:
 *       200: { description: OK }
 */
router.get("/", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), appointmentsController.opdQueue);

/**
 * @openapi
 * /opd-queue/{doctorId}/call-next:
 *   post:
 *     tags: [OPD Queue]
 *     summary: Call the next patient in a doctor's queue (by priority then token order)
 *     responses:
 *       200: { description: OK }
 */
router.post("/:doctorId/call-next", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), appointmentsController.callNext);

/**
 * @openapi
 * /opd-queue/{id}/start-consultation:
 *   post:
 *     tags: [OPD Queue]
 *     summary: Move an appointment from WAITING to IN_CONSULTATION
 *     responses:
 *       200: { description: OK }
 */
router.post("/:id/start-consultation", requireRole(["ADMIN", "DOCTOR"]), appointmentsController.startConsultation);

/**
 * @openapi
 * /opd-queue/{id}/requeue:
 *   post:
 *     tags: [OPD Queue]
 *     summary: Skip/requeue a waiting patient back to CONFIRMED
 *     responses:
 *       200: { description: OK }
 */
router.post("/:id/requeue", requireRole(["ADMIN", "RECEPTIONIST", "NURSE"]), appointmentsController.requeue);

export default router;
