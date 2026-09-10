import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { AppError } from "@common/errors/AppError";
import { env } from "@config/env";
import { logger } from "@config/logger";
import multer from "multer";

/**
 * Centralized error handler. Must be the LAST middleware registered in app.ts.
 * - Maps AppError subclasses to their status codes.
 * - Maps known Prisma errors (unique constraint, FK violation, not found) to 409/404.
 * - Never leaks stack traces in production.
 * - Logs every error with the request ID for traceability.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.id;

  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    logger.warn({ requestId, errorCode: err.code }, "Upload rejected: file too large");
    res.status(413).json({ success: false, data: null, message: "Uploaded file is too large", errors: null, requestId });
    return;
  }

  if (err instanceof AppError) {
    logger.warn({ requestId, statusCode: err.statusCode }, "Handled application error");
    res.status(err.statusCode).json({
      success: false,
      data: null,
      message: err.message,
      errors: err.errors ?? null,
      requestId,
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    let statusCode = 500;
    let message = "Database error";

    switch (err.code) {
      case "P2002":
        statusCode = 409;
        message = `Duplicate value for unique field(s): ${(err.meta?.target as string[])?.join(", ") ?? "unknown"}`;
        break;
      case "P2003":
        statusCode = 409;
        message = "Foreign key constraint failed — related record does not exist or is in use";
        break;
      case "P2025":
        statusCode = 404;
        message = "Record not found";
        break;
      default:
        statusCode = 400;
        message = "Database request error";
    }

    logger.warn({ requestId, code: err.code }, "Prisma known error");
    res.status(statusCode).json({ success: false, data: null, message, errors: null, requestId });
    return;
  }

  // Unknown / unexpected error
  logger.error({ requestId, errorName: err instanceof Error ? err.name : "UnknownError" }, "Unhandled error");
  res.status(500).json({
    success: false,
    data: null,
    message: "Internal server error",
    errors: env.NODE_ENV === "development" ? String(err) : null,
    requestId,
  });
}
