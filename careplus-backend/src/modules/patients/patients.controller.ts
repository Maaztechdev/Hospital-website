import { Request, Response } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { patientsService } from "./patients.service";

export const patientsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const search = req.query.search as string | undefined;
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await patientsService.list(req.user, { ...page, search });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const patient = await patientsService.getById(req.user, req.params.id);
    sendSuccess(res, 200, { data: patient });
  }),

  getProfile: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await patientsService.getProfile(req.user, req.params.id) });
  }),

  getClinicalSummary: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await patientsService.getClinicalSummary(req.user, req.params.id) });
  }),

  updateClinicalHistory: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, {
      data: await patientsService.updateClinicalHistory(req.user, req.params.id, req.body, req),
      message: "Patient clinical history updated",
    });
  }),

  printSummary: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await patientsService.getPrintSummary(req.user, req.params.id) });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const patient = await patientsService.create(req.user.sub, req.body, req);
    sendSuccess(res, 201, { data: patient, message: "Patient registered" });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const patient = await patientsService.update(req.user.sub, req.params.id, req.body, req);
    sendSuccess(res, 200, { data: patient, message: "Patient updated" });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    await patientsService.softDelete(req.user.sub, req.params.id, req);
    sendSuccess(res, 200, { message: "Patient deactivated (soft delete)" });
  }),

  merge: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await patientsService.merge(req.user.sub, req.body.primaryPatientId, req.body.duplicatePatientId, req);
    sendSuccess(res, 200, { data: result, message: "Patients merged" });
  }),
};
