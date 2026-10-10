import { Request, Response } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { consultationsService } from "./consultations.service";

export const consultationsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { appointmentId, patientId, doctorId } = req.query as Record<string, string | undefined>;
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await consultationsService.list(req.user, { ...page, appointmentId, patientId, doctorId });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const c = await consultationsService.getById(req.user, req.params.id);
    sendSuccess(res, 200, { data: c });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const c = await consultationsService.create(req.user, req.body, req);
    sendSuccess(res, 201, { data: c, message: "Consultation created" });
  }),
  start: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const c = await consultationsService.start(req.user, req.body, req);
    sendSuccess(res, 201, { data: c, message: "Consultation started" });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const c = await consultationsService.update(req.user, req.params.id, req.body, req);
    sendSuccess(res, 200, { data: c, message: "Consultation updated" });
  }),

  sign: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const c = await consultationsService.sign(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: c, message: "Consultation signed" });
  }),

  complete: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const c = await consultationsService.complete(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: c, message: "Consultation completed" });
  }),
  addAddendum: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const addendum = await consultationsService.addAddendum(req.user, req.params.id, req.body.note, req);
    sendSuccess(res, 201, { data: addendum, message: "Addendum recorded" });
  }),
};
