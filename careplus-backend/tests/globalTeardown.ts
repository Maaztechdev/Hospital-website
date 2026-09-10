import { prisma } from "../src/config/prisma";
import { redis } from "../src/config/redis";

export default async function globalTeardown() {
  await prisma.$disconnect();
  if (redis.status === "ready") await redis.quit();
  else redis.disconnect();
}
