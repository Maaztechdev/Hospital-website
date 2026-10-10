import { Request, Response } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { usersService } from "./users.service";

export const usersController = {
  listUltrasoundStaff: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, 200, { data: await usersService.listUltrasoundStaff() });
  }),

  getProfile: asyncHandler(async (req: Request, res: Response) => {
    const profile = await usersService.getProfile(req.params.id);
    sendSuccess(res, 200, { data: profile });
  }),

  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const profile = await usersService.updateProfile(req.user.sub, req.params.id, req.body, {
      signature: files?.signature,
      stamp: files?.stamp,
      profilePicture: files?.profilePicture,
    });
    sendSuccess(res, 200, { data: profile, message: "Staff profile updated" });
  }),
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { role, isActive, search } = req.query as Record<string, string | undefined>;
    const { items, total } = await usersService.list({ ...page, role, isActive, search });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const user = await usersService.getById(req.params.id);
    sendSuccess(res, 200, { data: user });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const user = await usersService.create(req.user.sub, req.body);
    sendSuccess(res, 201, { data: user, message: "User created" });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const user = await usersService.update(req.user.sub, req.params.id, req.body);
    sendSuccess(res, 200, { data: user, message: "User updated" });
  }),

  deactivate: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const user = await usersService.deactivate(req.user.sub, req.params.id);
    sendSuccess(res, 200, { data: user, message: "User deactivated" });
  }),
};
