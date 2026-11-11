import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { ForbiddenError, UnauthorizedError } from "@common/errors/AppError";
import { checkPermission, resolvePermissionTarget } from "@common/services/rolePermissions.service";
import { isConfigurablePermission } from "@common/permissions";

/**
 * Guards a route to a set of allowed roles. Must run after `authenticate`.
 * Evaluates stored RolePermission configuration for configurable module/action pairs,
 * falling back safely to hard-coded baseline defaults when unconfigured or on lookup error.
 * Admin role is strictly safeguarded against lockout.
 *
 * Usage: router.post('/', authenticate, requireRole(['ADMIN']), controller.create)
 */
export function requireRole(allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        if (!req.user) {
          throw new UnauthorizedError();
        }

        // Check if route matches a configurable module/action pair
        const target = resolvePermissionTarget(allowedRoles, req);
        if (target && isConfigurablePermission(target.module, target.action)) {
          // Hard-coded safeguard: Admin must never lose access on configurable modules
          if (req.user.role === "ADMIN") {
            return next();
          }

          const isAllowed = await checkPermission(req.user.role, target.module, target.action, allowedRoles);
          if (!isAllowed) {
            throw new ForbiddenError(`Role '${req.user.role}' is not permitted to perform '${target.action}' on '${target.module}'`);
          }
          return next();
        }

        // Hard-coded safeguard: Admin must never lose access on routes where Admin is in baseline allowedRoles
        if (req.user.role === "ADMIN" && allowedRoles.includes("ADMIN")) {
          return next();
        }

        // Standard hard-coded baseline fallback
        if (!allowedRoles.includes(req.user.role)) {
          throw new ForbiddenError(`Role '${req.user.role}' is not permitted to perform this action`);
        }
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
