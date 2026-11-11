import { prisma } from "../src/config/prisma";
import { redis } from "../src/config/redis";

afterAll(async () => {
  try {
    await prisma.$disconnect();
  } catch {}
  try {
    if (redis.status !== "end") {
      await redis.quit().catch(() => redis.disconnect(false));
    }
  } catch {}
});
