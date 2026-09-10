import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { createHash, randomBytes } from "crypto";
import { env } from "@config/env";
import { redis } from "@config/redis";
import { Role } from "@prisma/client";
import { AccessTokenPayload } from "@common/middleware/authenticate";

const REFRESH_PREFIX = "refresh_token:"; // refresh_token:<jti> -> userId
const BLACKLIST_PREFIX = "blacklist_access:"; // blacklist_access:<jti> -> "1"
const LOCKOUT_PREFIX = "lockout:"; // lockout:<email> -> attempt count
const PASSWORD_RESET_PREFIX = "password_reset:";

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

function expiresInToSeconds(expr: string): number {
  const match = /^(\d+)([smhd])$/.exec(expr);
  if (!match) return 7 * 24 * 3600;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit];
}

/**
 * Issues a refresh token and stores its jti in Redis (rotation + blacklisting support).
 */
export async function signRefreshToken(userId: string): Promise<string> {
  const jti = randomUUID();
  const options: jwt.SignOptions = { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"] };
  const token = jwt.sign({ sub: userId, jti } as RefreshTokenPayload, env.JWT_REFRESH_SECRET, options);

  const ttlSeconds = expiresInToSeconds(env.JWT_REFRESH_EXPIRES_IN);
  await redis.set(`${REFRESH_PREFIX}${jti}`, userId, "EX", ttlSeconds);
  return token;
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  const stored = await redis.get(`${REFRESH_PREFIX}${payload.jti}`);
  if (!stored || stored !== payload.sub) {
    throw new Error("Refresh token has been revoked or expired");
  }
  return payload;
}

/** Rotates a refresh token: revokes the old jti, issues a new token. */
export async function rotateRefreshToken(oldJti: string, userId: string): Promise<string> {
  await redis.del(`${REFRESH_PREFIX}${oldJti}`);
  return signRefreshToken(userId);
}

export async function revokeRefreshToken(jti: string): Promise<void> {
  await redis.del(`${REFRESH_PREFIX}${jti}`);
}

/** Revokes ALL refresh tokens for a user by scanning (used on password reset). */
export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${REFRESH_PREFIX}*`, "COUNT", 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      const values = await redis.mget(...keys);
      const toDelete = keys.filter((_, i) => values[i] === userId);
      if (toDelete.length > 0) await redis.del(...toDelete);
    }
  } while (cursor !== "0");
}

/** Blacklists an access token's jti until its natural expiry (used on logout). */
export async function blacklistAccessToken(token: string): Promise<void> {
  const decoded = jwt.decode(token) as (jwt.JwtPayload & { jti?: string }) | null;
  if (!decoded?.exp) return;
  const ttl = decoded.exp - Math.floor(Date.now() / 1000);
  if (ttl > 0) {
    await redis.set(`${BLACKLIST_PREFIX}${token}`, "1", "EX", ttl);
  }
}

export async function isAccessTokenBlacklisted(token: string): Promise<boolean> {
  const result = await redis.get(`${BLACKLIST_PREFIX}${token}`);
  return result === "1";
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await redis.set(`${PASSWORD_RESET_PREFIX}${tokenHash}`, userId, "EX", expiresInToSeconds(env.PASSWORD_RESET_EXPIRES_IN));
  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return redis.getdel(`${PASSWORD_RESET_PREFIX}${tokenHash}`);
}

// ── Account lockout (5 failed attempts) ─────────────────────────

export async function recordFailedLogin(email: string, windowSeconds: number): Promise<number> {
  const key = `${LOCKOUT_PREFIX}${email}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, windowSeconds);
  }
  return attempts;
}

export async function getFailedLoginCount(email: string): Promise<number> {
  const key = `${LOCKOUT_PREFIX}${email}`;
  const val = await redis.get(key);
  return val ? parseInt(val, 10) : 0;
}

export async function clearFailedLogins(email: string): Promise<void> {
  await redis.del(`${LOCKOUT_PREFIX}${email}`);
}

export function buildAccessTokenPayload(user: { id: string; role: Role; email: string }): AccessTokenPayload {
  return { sub: user.id, role: user.role, email: user.email };
}
