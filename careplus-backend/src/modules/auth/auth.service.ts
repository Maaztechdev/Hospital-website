import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { env } from "@config/env";
import { UnauthorizedError, LockedError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import {
  buildAccessTokenPayload,
  clearFailedLogins,
  getFailedLoginCount,
  recordFailedLogin,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  blacklistAccessToken,
  revokeAllUserRefreshTokens,
  createPasswordResetToken,
  consumePasswordResetToken,
} from "./token.utils";

async function logAttempt(email: string, success: boolean, req: Request, userId?: string) {
  await prisma.authAttempt.create({
    data: {
      email,
      success,
      userId: userId ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    },
  });
}

export const authService = {
  async login(email: string, password: string, req: Request) {
    const lockKey = email.toLowerCase();
    const failedAttempts = await getFailedLoginCount(lockKey);
    if (failedAttempts >= env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS) {
      await logAttempt(email, false, req);
      throw new LockedError(
        `Account locked due to too many failed attempts. Try again in ${Math.ceil(
          env.ACCOUNT_LOCKOUT_WINDOW_SECONDS / 60
        )} minutes.`
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.deletedAt || !user.isActive) {
      await recordFailedLogin(lockKey, env.ACCOUNT_LOCKOUT_WINDOW_SECONDS);
      await logAttempt(email, false, req);
      throw new UnauthorizedError("Invalid email or password");
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      const attempts = await recordFailedLogin(lockKey, env.ACCOUNT_LOCKOUT_WINDOW_SECONDS);
      await logAttempt(email, false, req, user.id);
      if (attempts >= env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS) {
        throw new LockedError("Account locked due to too many failed attempts.");
      }
      throw new UnauthorizedError("Invalid email or password");
    }

    await clearFailedLogins(lockKey);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAttempt(email, true, req, user.id);
    await writeAuditLog({ userId: user.id, action: "LOGIN", module: "auth", entityType: "User", entityId: user.id, req });

    const accessToken = signAccessToken(buildAccessTokenPayload(user));
    const refreshToken = await signRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  },

  async refresh(refreshToken: string) {
    let payload;
    try {
      payload = await verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedError("User no longer active");
    }

    const newRefreshToken = await rotateRefreshToken(payload.jti, user.id);
    const accessToken = signAccessToken(buildAccessTokenPayload(user));

    return { accessToken, refreshToken: newRefreshToken };
  },

  async logout(refreshToken: string | undefined, accessToken: string | undefined, userId: string) {
    if (refreshToken) {
      try {
        const payload = jwt.decode(refreshToken) as { jti?: string } | null;
        if (payload?.jti) await revokeRefreshToken(payload.jti);
      } catch {
        // ignore malformed token on logout
      }
    }
    if (accessToken) {
      await blacklistAccessToken(accessToken);
    }
    await writeAuditLog({ userId, action: "LOGOUT", module: "auth", entityType: "User", entityId: userId });
  },

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    // Always behave the same whether or not the user exists (avoid user enumeration)
    if (!user || user.deletedAt || !user.isActive) {
      return { message: "If that account exists, a reset link has been sent." };
    }

    const resetToken = await createPasswordResetToken(user.id);

    // In production this would be emailed. We return it here only in non-production
    // environments to enable local/dev/test flows without an email provider.
    return {
      message: "If that account exists, a reset link has been sent.",
      ...(env.EXPOSE_DEV_RESET_TOKEN ? { devResetToken: resetToken } : {}),
    };
  },

  async resetPassword(token: string, newPassword: string) {
    const userId = await consumePasswordResetToken(token);
    if (!userId) throw new UnauthorizedError("Invalid or expired reset token");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundError("User not found");

    const passwordHash = await argon2.hash(newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await revokeAllUserRefreshTokens(user.id);
    await writeAuditLog({ userId: user.id, action: "UPDATE", module: "auth", entityType: "User", entityId: user.id, newValues: { passwordReset: true } });

    return { message: "Password has been reset. Please log in again." };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundError("User not found");

    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) throw new UnauthorizedError("Current password is incorrect");

    const passwordHash = await argon2.hash(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await revokeAllUserRefreshTokens(userId);
    await writeAuditLog({ userId, action: "UPDATE", module: "auth", entityType: "User", entityId: userId, newValues: { passwordChanged: true } });

    return { message: "Password changed. Please log in again." };
  },
};
