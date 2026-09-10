import { Router } from "express";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { appointmentsController } from "./appointments.controller";
import { prisma } from "@config/prisma";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import {
  cancelSchema,
  createAppointmentSchema,
  idParamSchema,
  listAppointmentsQuerySchema,
  publicAppointmentSchema,
  rejectSchema,
  rescheduleSchema,
} from "./appointments.validators";

const router = Router();

router.get("/public/departments", asyncHandler(async (_req, res) => {
  const departments = await prisma.department.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, icon: true, _count: { select: { doctors: true } } },
    orderBy: { name: "asc" },
  });
  sendSuccess(res, 200, { data: departments });
}));

router.get("/public/doctors", asyncHandler(async (_req, res) => {
  const doctors = await prisma.doctor.findMany({
    where: { isAvailable: true, department: { status: "ACTIVE" } },
    include: { user: { select: { name: true } }, department: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  sendSuccess(res, 200, { data: doctors });
}));

router.post("/public", validate({ body: publicAppointmentSchema }), appointmentsController.createPublic);

router.use(authenticate);

router.get("/doctors", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "LAB_TECHNICIAN", "PHARMACIST", "NURSE"]), asyncHandler(async (_req, res) => {
  const doctors = await prisma.doctor.findMany({
    where: { isAvailable: true, department: { status: "ACTIVE" } },
    include: { user: { select: { name: true } }, department: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  sendSuccess(res, 200, { data: doctors });
}));

router.get("/doctors/:doctorId/slots", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), appointmentsController.getAvailableSlots);

/**
 * @openapi
 * /appointments:
 *   get:
 *     tags: [Appointments]
 *     summary: List/filter appointments by date/doctor/department/status
 *     responses:
 *       200: { description: OK }
 */
router.get("/", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ query: listAppointmentsQuerySchema }), appointmentsController.list);

router.get("/:id", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), appointmentsController.getById);

/**
 * @openapi
 * /appointments:
 *   post:
 *     tags: [Appointments]
 *     summary: Book an appointment (auto token number, prevents double-booking)
 *     responses:
 *       201: { description: Created }
 *       409: { description: Slot already booked }
 */
router.post(
  "/",
  requireRole(["ADMIN", "RECEPTIONIST"]),
  validate({ body: createAppointmentSchema }),
  appointmentsController.create
);

router.post("/:id/approve", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR"]), validate({ params: idParamSchema }), appointmentsController.approve);

router.post(
  "/:id/reject",
  requireRole(["ADMIN", "RECEPTIONIST"]),
  validate({ params: idParamSchema, body: rejectSchema }),
  appointmentsController.reject
);

router.post(
  "/:id/reschedule",
  requireRole(["ADMIN", "RECEPTIONIST"]),
  validate({ params: idParamSchema, body: rescheduleSchema }),
  appointmentsController.reschedule
);

router.post(
  "/:id/cancel",
  requireRole(["ADMIN", "RECEPTIONIST"]),
  validate({ params: idParamSchema, body: cancelSchema }),
  appointmentsController.cancel
);

router.post("/:id/mark-done", requireRole(["ADMIN", "DOCTOR"]), validate({ params: idParamSchema }), appointmentsController.markDone);

router.post(
  "/:id/mark-no-show",
  requireRole(["ADMIN", "RECEPTIONIST"]),
  validate({ params: idParamSchema }),
  appointmentsController.markNoShow
);

export default router;
