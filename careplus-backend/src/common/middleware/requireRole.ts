import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { ForbiddenError, UnauthorizedError } from "@common/errors/AppError";

/**
 * Guards a route to a set of allowed roles. Must run after `authenticate`.
 * Usage: router.post('/', authenticate, requireRole(['ADMIN']), controller.create)
 */
export function requireRole(allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(`Role '${req.user.role}' is not permitted to perform this action`);
    }
    next();
  };
}
