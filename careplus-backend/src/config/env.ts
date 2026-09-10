import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default("/api/v1"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  PASSWORD_RESET_SECRET: z.string().min(16),
  PASSWORD_RESET_EXPIRES_IN: z.string().default("30m"),

  FRONTEND_URL: z.string().default("http://localhost:5173"),
  BACKUP_DIR: z.string().default("./backups"),
  UPLOAD_DIR: z.string().default("./uploads"),
  EXPOSE_DEV_RESET_TOKEN: z.coerce.boolean().default(false),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(10),
  ACCOUNT_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().default(5),
  ACCOUNT_LOCKOUT_WINDOW_SECONDS: z.coerce.number().default(900),

  LOG_LEVEL: z.string().default("info"),

  MR_NUMBER_PREFIX: z.string().default("MR"),
  INVOICE_NUMBER_PREFIX: z.string().default("INV"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === "production") {
  const placeholderSecrets = [
    env.JWT_ACCESS_SECRET,
    env.JWT_REFRESH_SECRET,
    env.PASSWORD_RESET_SECRET,
  ].some((secret) => secret.toLowerCase().includes("change_me"));

  if (placeholderSecrets) {
    console.error("Production secrets must be replaced with deployment-provided values");
    process.exit(1);
  }
}
