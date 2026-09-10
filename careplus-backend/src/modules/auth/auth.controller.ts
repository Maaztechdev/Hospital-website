import { Request, Response } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import { UnauthorizedError } from "@common/errors/AppError";
import { authService } from "./auth.service";

export const authController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await authService.login(email, password, req);
    sendSuccess(res, 200, { data: result, message: "Login successful" });
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    sendSuccess(res, 200, { data: result, message: "Token refreshed" });
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    await authService.logout(req.body?.refreshToken, accessToken, req.user.sub);
    sendSuccess(res, 200, { message: "Logged out" });
  }),

  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.forgotPassword(req.body.email);
    sendSuccess(res, 200, { data: result, message: result.message });
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.resetPassword(req.body.token, req.body.newPassword);
    sendSuccess(res, 200, { message: result.message });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await authService.changePassword(req.user.sub, req.body.currentPassword, req.body.newPassword);
    sendSuccess(res, 200, { message: result.message });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: req.user });
  }),
};
