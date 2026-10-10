import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4000",
      cwd: "../careplus-backend",
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        LOGIN_RATE_LIMIT_MAX: "1000",
        DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://careplus:careplus_pw@localhost:5432/careplus_test?schema=public",
        REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "test_access_secret_min_32_characters_long",
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "test_refresh_secret_min_32_characters_long",
        PASSWORD_RESET_SECRET: process.env.PASSWORD_RESET_SECRET ?? "test_reset_secret_min_32_characters_long",
        FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:5173",
      },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5173",
      cwd: ".",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_URL: process.env.VITE_API_URL ?? "http://127.0.0.1:4000/api/v1",
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})