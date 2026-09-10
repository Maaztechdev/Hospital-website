import { NextFunction, Request, Response } from "express";
import { ServiceUnavailableError } from "@common/errors/AppError";

let maintenance = false;

export function isMaintenanceMode() {
  return maintenance;
}

export function beginMaintenance() {
  if (maintenance) throw new ServiceUnavailableError("Another restore is already in progress");
  maintenance = true;
}

export function endMaintenance() {
  maintenance = false;
}

export function maintenanceMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (maintenance && !req.path.startsWith("/admin/backup")) {
    throw new ServiceUnavailableError("Hospital system is temporarily in maintenance mode");
  }
  next();
}
