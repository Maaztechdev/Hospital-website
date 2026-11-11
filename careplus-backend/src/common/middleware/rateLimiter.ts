import { Request } from "express";
import rateLimit from "express-rate-limit";
import { env } from "@config/env";

export function getClientIp(req: Request): string {
  if (req.app && req.app.get("trust proxy")) {
    return req.ip || req.socket.remoteAddress || "127.0.0.1";
  }
  return req.socket?.remoteAddress || "127.0.0.1";
}

export function normalizeEmail(email: unknown): string {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

export const loginAccountRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.LOGIN_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${getClientIp(req)}:${normalizeEmail(req.body?.email)}`,
  message: {
    success: false,
    data: null,
    message: "Too many login attempts for this account. Please try again later.",
    errors: null,
  },
});

export const loginAccountFailureLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.LOGIN_ACCOUNT_FAIL_MAX,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => normalizeEmail(req.body?.email) || getClientIp(req),
  message: {
    success: false,
    data: null,
    message: "Too many failed login attempts for this account. Please try again later.",
    errors: null,
  },
});

export const loginIpRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.LOGIN_RATE_LIMIT_IP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => getClientIp(req),
  message: {
    success: false,
    data: null,
    message: "Too many login attempts from this IP address. Please try again later.",
    errors: null,
  },
});

export const loginRateLimiter = [loginIpRateLimiter, loginAccountFailureLimiter, loginAccountRateLimiter];

export function resetLoginRateLimits(email: string): void {
  const normalized = normalizeEmail(email);
  if (normalized && typeof (loginAccountFailureLimiter as unknown as { resetKey?: (k: string) => void }).resetKey === "function") {
    (loginAccountFailureLimiter as unknown as { resetKey: (k: string) => void }).resetKey(normalized);
  }
}

export const forgotPasswordRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.NODE_ENV === "production" ? 5 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    data: null,
    message: "Too many password reset requests. Please try again later.",
    errors: null,
  },
});

export const resetPasswordRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.NODE_ENV === "production" ? 5 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    data: null,
    message: "Too many password reset attempts. Please try again later.",
    errors: null,
  },
});

export const globalApiRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
