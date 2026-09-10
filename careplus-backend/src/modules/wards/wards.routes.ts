import { Request, Response, Router } from "express";
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
  admitPatientSchema,
  createBedSchema,
  createRoomSchema,
  createWardSchema,
  dischargeSchema,
  idParamSchema,
  listAdmissionsQuerySchema,
  transferBedSchema,
} from "./wards.validators";

const bedStatusSchema = z.object({ status: z.enum(["AVAILABLE", "CLEANING", "MAINTENANCE", "RESERVED"]) });

export const wardsController = {
  listWards: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await wardsService.listWards() });
  }),
  createWard: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.createWard(req.user, req.body, req), message: "Ward created" });
  }),
  createRoom: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.createRoom(req.user, req.body, req), message: "Room created" });
  }),
  createBed: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.createBed(req.user, req.body, req), message: "Bed created" });
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
  admit: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardsService.admit(req.user, req.body, req), message: "Patient admitted" });
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
};

const router = Router();
router.use(authenticate);

router.get("/", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), wardsController.listWards);
router.post("/", requireRole(["ADMIN"]), validate({ body: createWardSchema }), wardsController.createWard);
router.post("/rooms", requireRole(["ADMIN"]), validate({ body: createRoomSchema }), wardsController.createRoom);
router.post("/beds", requireRole(["ADMIN"]), validate({ body: createBedSchema }), wardsController.createBed);
router.get("/beds/availability", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), wardsController.bedAvailability);
router.patch("/beds/:id/status", requireRole(["ADMIN", "NURSE"]), validate({ params: idParamSchema, body: bedStatusSchema }), wardsController.setBedStatus);

router.get("/admissions", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ query: listAdmissionsQuerySchema }), wardsController.listAdmissions);
router.get("/admissions/:id", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]), validate({ params: idParamSchema }), wardsController.getAdmission);
router.post("/admissions", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR"]), validate({ body: admitPatientSchema }), wardsController.admit);
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
