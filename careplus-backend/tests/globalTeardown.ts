import { prisma } from "../src/config/prisma";
import { redis } from "../src/config/redis";

export default async function globalTeardown() {
  try {
    await prisma.$disconnect();
  } catch {}
  try {
    if (redis.status !== "end") {
      redis.disconnect(false);
    }
  } catch {}
}
