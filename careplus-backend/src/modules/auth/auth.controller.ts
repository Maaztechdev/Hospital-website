import { Request, Response } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import { UnauthorizedError } from "@common/errors/AppError";
import { authService } from "./auth.service";

export const authController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await authService.login(email, password, req);
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("careplus_refresh_token", result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    sendSuccess(res, 200, { data: result, message: "Login successful" });
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const cookieToken = (req as any).cookies?.careplus_refresh_token;
    const tokenToUse = req.body?.refreshToken || cookieToken;
    if (!tokenToUse) throw new UnauthorizedError("Refresh token missing");
    const result = await authService.refresh(tokenToUse);
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("careplus_refresh_token", result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    sendSuccess(res, 200, { data: result, message: "Token refreshed" });
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const cookieToken = (req as any).cookies?.careplus_refresh_token;
    const tokenToRevoke = req.body?.refreshToken || cookieToken;
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    await authService.logout(tokenToRevoke, accessToken, req.user.sub);
    res.clearCookie("careplus_refresh_token", { path: "/" });
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

  verifyResetToken: asyncHandler(async (req: Request, res: Response) => {
    const token = (req.query.token as string) || (req.body.token as string);
    const result = await authService.verifyResetToken(token);
    sendSuccess(res, 200, { data: result, message: "Reset token is valid" });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await authService.changePassword(req.user.sub, req.body.currentPassword, req.body.newPassword);
    sendSuccess(res, 200, { message: result.message });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await authService.getCurrentUser(req.user.sub) });
  }),
};
