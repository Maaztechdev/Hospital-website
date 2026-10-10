import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";

import { env } from "@config/env";
import { logger } from "@config/logger";
import { swaggerSpec } from "@config/swagger";
import { requestId } from "@common/middleware/requestId";
import { errorHandler } from "@common/middleware/errorHandler";
import { globalApiRateLimiter } from "@common/middleware/rateLimiter";
import { NotFoundError, ServiceUnavailableError } from "@common/errors/AppError";
import { prisma } from "@config/prisma";

import authRoutes from "@modules/auth/auth.routes";
import usersRoutes from "@modules/users/users.routes";
import patientsRoutes from "@modules/patients/patients.routes";
import appointmentsRoutes from "@modules/appointments/appointments.routes";
import opdQueueRoutes from "@modules/opd-queue/opd-queue.routes";
import consultationsRoutes from "@modules/consultations/consultations.routes";
import prescriptionsRoutes from "@modules/prescriptions/prescriptions.routes";
import labRoutes from "@modules/lab/lab.routes";
import ultrasoundRoutes from "@modules/ultrasound/ultrasound.routes";
import pharmacyRoutes from "@modules/pharmacy/pharmacy.routes";
import billingRoutes from "@modules/billing/billing.routes";
import wardsRoutes from "@modules/wards/wards.routes";
import { doctorWardRoundRoutes, wardRoundRoutes } from "@modules/wards/wardRounds.routes";
import nursingRoutes from "@modules/nursing/nursing.routes";
import otRoutes from "@modules/ot/ot.routes";
import notificationsRoutes from "@modules/notifications/notifications.routes";
import reportsRoutes from "@modules/reports/reports.routes";
import settingsRoutes from "@modules/settings/settings.routes";
import auditLogsRoutes from "@modules/audit-logs/audit-logs.routes";
import backupRoutes from "@modules/backup/backup.routes";
import { maintenanceMiddleware } from "@common/middleware/maintenance";
import privateFilesRoutes from "@modules/files.routes";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  if (env.TRUST_PROXY_HOPS > 0) app.set("trust proxy", env.TRUST_PROXY_HOPS);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).id,
      customProps: (req) => ({ requestId: (req as Request).id }),
      autoLogging: { ignore: (req) => req.url === "/health" },
    })
  );

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        const allowedOrigins = new Set(
          env.NODE_ENV === "production"
            ? [env.FRONTEND_URL]
            : [env.FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"]
        );

        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: false,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    })
  );
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  if (env.NODE_ENV !== "test") app.use(globalApiRateLimiter);

  // ── Health check (unauthenticated, excluded from rate limit consideration) ──
  app.get("/health", async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ success: true, data: { status: "ok", database: "ok", timestamp: new Date().toISOString() }, requestId: req.id });
    } catch (error) {
      next(new ServiceUnavailableError("Database unavailable"));
    }
  });

  // ── API docs ──────────────────────────────────────────────
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.use(`${env.API_PREFIX}/files`, privateFilesRoutes);

  // ── Versioned API routes ──────────────────────────────────
  const router = express.Router();
  router.use(maintenanceMiddleware);
  router.use("/auth", authRoutes);
  router.use("/users", usersRoutes);
  router.use("/patients", patientsRoutes);
  router.use("/appointments", appointmentsRoutes);
  router.use("/opd-queue", opdQueueRoutes);
  router.use("/consultations", consultationsRoutes);
  router.use("/prescriptions", prescriptionsRoutes);
  router.use("/lab", labRoutes);
  router.use("/ultrasound", ultrasoundRoutes);
  router.use("/pharmacy", pharmacyRoutes);
  router.use("/billing", billingRoutes);
  router.use("/wards", wardsRoutes);
  router.use("/wards", wardRoundRoutes);
  router.use("/doctors", doctorWardRoundRoutes);
  router.use("/nursing", nursingRoutes);
  router.use("/ot", otRoutes);
  router.use("/notifications", notificationsRoutes);
  router.use("/reports", reportsRoutes);
  router.use("/settings", settingsRoutes);
  router.use("/audit-logs", auditLogsRoutes);
  router.use("/admin/backup", backupRoutes);

  app.use(env.API_PREFIX, (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  }, router);

  // ── 404 handler ───────────────────────────────────────────
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
  });

  // ── Centralized error handler (must be last) ─────────────
  app.use(errorHandler);

  return app;
}
