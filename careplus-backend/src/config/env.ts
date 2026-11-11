import "dotenv/config";
import { z } from "zod";

export const envBoolean = () => z.enum(["true", "false"]).default("false").transform((value) => value === "true");

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
  SESSION_WARNING_LEAD_MS: z.coerce.number().int().positive().default(120_000),
  SESSION_INACTIVITY_TIMEOUT_MS: z.coerce.number().int().positive().default(13 * 60_000),

  PASSWORD_RESET_SECRET: z.string().min(16),
  PASSWORD_RESET_EXPIRES_IN: z.string().default("30m"),

  FRONTEND_URL: z.string().default("http://localhost:5173"),
  BACKUP_DIR: z.string().default("./backups"),
  UPLOAD_DIR: z.string().default("./uploads"),

  // ── SMTP / Mailer Configuration ──────────────────────────────
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: envBoolean(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Khalida Medicare Hospital <no-reply@khalida.pk>"),
  AUTO_BACKUP_ENABLED: envBoolean(),
  BACKUP_RETENTION_DAYS: z.coerce.number().default(30),
  BACKUP_CRON_SCHEDULE: z.string().default("0 2 * * *"),
  EXPOSE_DEV_RESET_TOKEN: envBoolean(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().default("System Administrator"),

  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(10),
  LOGIN_RATE_LIMIT_IP_MAX: z.coerce.number().default(100),
  LOGIN_ACCOUNT_FAIL_MAX: z.coerce.number().default(20),
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

export class ProductionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionConfigError";
  }
}

export function assertProductionConfigSafe(config: {
  NODE_ENV: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  PASSWORD_RESET_SECRET: string;
  DATABASE_URL: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  EXPOSE_DEV_RESET_TOKEN?: boolean;
}): void {
  if (config.NODE_ENV !== "production") return;

  if (config.EXPOSE_DEV_RESET_TOKEN) {
    throw new ProductionConfigError(
      "Production security violation: EXPOSE_DEV_RESET_TOKEN must be false in production."
    );
  }

  const forbiddenSecretSubstrings = [
    "change_me",
    "careplus-super-secret",
    "careplus_jwt",
    "placeholder",
    "default",
    "demo",
    "123456",
    "your-secret",
    "<generate",
  ];

  const secrets = [
    { name: "JWT_ACCESS_SECRET", val: config.JWT_ACCESS_SECRET },
    { name: "JWT_REFRESH_SECRET", val: config.JWT_REFRESH_SECRET },
    { name: "PASSWORD_RESET_SECRET", val: config.PASSWORD_RESET_SECRET },
  ];

  for (const { name, val } of secrets) {
    if (!val || val.length < 32) {
      throw new ProductionConfigError(
        `Production security violation: ${name} must be at least 32 characters in production.`
      );
    }
    const lower = val.toLowerCase();
    for (const forbidden of forbiddenSecretSubstrings) {
      if (lower.includes(forbidden)) {
        throw new ProductionConfigError(
          `Production security violation: ${name} contains forbidden default/demo placeholder "${forbidden}".`
        );
      }
    }
  }

  // Database URL check
  const dbLower = (config.DATABASE_URL || "").toLowerCase();
  const forbiddenDbStrings = [
    "carepluspass123",
    ":password@",
    ":postgres@",
    ":admin@",
    "<db-password>",
    "change_me",
  ];
  for (const forbidden of forbiddenDbStrings) {
    if (dbLower.includes(forbidden)) {
      throw new ProductionConfigError(
        `Production security violation: DATABASE_URL contains placeholder/demo password "${forbidden}".`
      );
    }
  }

  // Bootstrap admin password check if present
  if (config.BOOTSTRAP_ADMIN_PASSWORD) {
    const adminPassLower = config.BOOTSTRAP_ADMIN_PASSWORD.toLowerCase();
    const forbiddenAdminPass = ["admin@12345", "admin", "password", "12345678", "doctor@12345", "staff@12345"];
    for (const forbidden of forbiddenAdminPass) {
      if (adminPassLower === forbidden) {
        throw new ProductionConfigError(
          `Production security violation: BOOTSTRAP_ADMIN_PASSWORD cannot be a known demo password ("${forbidden}").`
        );
      }
    }
  }
}

if (env.NODE_ENV === "production") {
  try {
    assertProductionConfigSafe(env);
  } catch (error) {
    console.error("❌ " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
