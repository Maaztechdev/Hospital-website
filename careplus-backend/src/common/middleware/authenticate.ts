import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "@config/env";
import { UnauthorizedError } from "@common/errors/AppError";
import { Role } from "@prisma/client";
import { isAccessTokenBlacklisted } from "@modules/auth/token.utils";

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

/**
 * Verifies the JWT access token from the Authorization header.
 * Applied to every route except login/refresh/health (see route files).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    isAccessTokenBlacklisted(token).then((blacklisted) => {
      if (blacklisted) return next(new UnauthorizedError("Invalid or expired access token"));
      req.user = payload;
      next();
    }).catch(() => next(new UnauthorizedError("Invalid or expired access token")));
  } catch {
    next(new UnauthorizedError("Invalid or expired access token"));
  }
}
