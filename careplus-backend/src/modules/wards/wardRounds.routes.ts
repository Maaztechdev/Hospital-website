import { Request, Response, Router } from "express";
import { z } from "zod";
import { UnauthorizedError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import { wardRoundsService } from "./wardRounds.service";

const admissionIdSchema = z.object({ id: z.string().uuid() });
const createRoundSchema = z.object({
  subjective: z.string().trim().max(5000).optional(),
  findings: z.string().trim().max(5000).optional(),
  assessment: z.string().trim().max(5000).optional(),
  plan: z.string().trim().max(5000).optional(),
});
const readySchema = z.object({ ready: z.boolean() });

export const wardRoundRoutes = Router();
wardRoundRoutes.use(authenticate);
wardRoundRoutes.get(
  "/admissions/:id/rounds",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: admissionIdSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardRoundsService.list(req.user, req.params.id) });
  })
);
wardRoundRoutes.post(
  "/admissions/:id/rounds",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: admissionIdSchema, body: createRoundSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 201, { data: await wardRoundsService.create(req.user, req.params.id, req.body, req), message: "Ward round recorded" });
  })
);
wardRoundRoutes.patch(
  "/admissions/:id/ready-for-discharge",
  requireRole(["ADMIN", "DOCTOR"]),
  validate({ params: admissionIdSchema, body: readySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardRoundsService.setReadyForDischarge(req.user, req.params.id, req.body.ready, req), message: "Discharge readiness updated" });
  })
);

export const doctorWardRoundRoutes = Router();
doctorWardRoundRoutes.use(authenticate);
doctorWardRoundRoutes.get(
  "/me/ward-rounds/today",
  requireRole(["ADMIN", "DOCTOR"]),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await wardRoundsService.today(req.user) });
  })
);
