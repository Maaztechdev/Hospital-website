import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("error", (err) => {
  logger.error({ errorName: err.name }, "Redis connection error");
});

redis.on("connect", () => {
  logger.info("Redis connected");
});
