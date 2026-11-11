import { createApp } from "./app";
import { env } from "@config/env";
import { logger } from "@config/logger";
import { prisma, disconnectPrisma } from "@config/prisma";
import { redis } from "@config/redis";
import { applyStaleAppointmentStatuses } from "./modules/appointments/staleAppointmentLifecycle";
import { ipdBillingService } from "./modules/ipd/ipdBilling.service";

async function main() {
  // Fail fast if the DB is unreachable at boot.
  await prisma.$connect();
  logger.info("Database connected");

  const app = createApp();

  void applyStaleAppointmentStatuses().catch((error) => {
    logger.warn({ error }, "Initial stale appointment audit failed");
  });

  setInterval(() => {
    void applyStaleAppointmentStatuses().catch((error) => {
      logger.warn({ error }, "Scheduled stale appointment audit failed");
    });
  }, 12 * 60 * 60 * 1000);

  void ipdBillingService.runDailyBedRentJob().then((result) => {
    logger.info(result, "Initial IPD bed-rent job completed");
  }).catch((error) => {
    logger.error({ error }, "Initial IPD bed-rent job failed");
  });

  setInterval(() => {
    void ipdBillingService.runDailyBedRentJob().then((result) => {
      logger.info(result, "Scheduled IPD bed-rent job completed");
    }).catch((error) => {
      logger.error({ error }, "Scheduled IPD bed-rent job failed");
    });
  }, 24 * 60 * 60 * 1000);

  const server = app.listen(env.PORT, () => {
    logger.info(`CarePlus backend listening on port ${env.PORT} (${env.NODE_ENV})`);
    logger.info(`API docs available at http://localhost:${env.PORT}/api-docs`);
  });

  // Prevent race conditions where Node closes keep-alive sockets before client does (ECONNRESET)
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.error(`Port ${env.PORT} is already in use. Stop the existing backend or run with a different PORT.`);
      process.exit(1);
    }
    logger.error({ error }, "Backend server failed");
    process.exit(1);
  });

  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await disconnectPrisma();
      redis.disconnect();
      logger.info("Shutdown complete");
      process.exit(0);
    });
    // Force-exit if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
