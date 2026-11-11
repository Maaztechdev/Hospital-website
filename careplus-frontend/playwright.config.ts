import { defineConfig, devices } from "@playwright/test"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    let val = trimmed.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) {
      process.env[key] = val
    }
  }
}

// Load backend .env.test first, then optional .env.e2e
loadEnvFile(path.resolve(__dirname, "../careplus-backend/.env.test"))
loadEnvFile(path.resolve(__dirname, ".env.e2e"))

// Dedicated ports for E2E
const backendPort = process.env.E2E_BACKEND_PORT ? parseInt(process.env.E2E_BACKEND_PORT, 10) : 4100
const frontendPort = process.env.E2E_FRONTEND_PORT ? parseInt(process.env.E2E_FRONTEND_PORT, 10) : 5180
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${frontendPort}`
const apiURL = process.env.PLAYWRIGHT_API_URL ?? `http://127.0.0.1:${backendPort}/api/v1`

// Ensure environment variables are populated for fixtures and test-helpers
process.env.PLAYWRIGHT_BASE_URL = baseURL
process.env.PLAYWRIGHT_API_URL = apiURL

// Hard assertion: database MUST end with _test
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public"
process.env.DATABASE_URL = databaseUrl
const dbMatch = databaseUrl.match(/\/([^/?]+)(\?|$)/)
const dbName = dbMatch ? dbMatch[1] : ""
if (!dbName || !dbName.endsWith("_test")) {
  throw new Error(`CRITICAL E2E HARNESS SAFETY ABORT: Database "${dbName}" does not end with "_test"!`)
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npx tsx src/server.ts",
      cwd: "../careplus-backend",
      url: `http://127.0.0.1:${backendPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        PORT: String(backendPort),
        LOGIN_RATE_LIMIT_MAX: "1000",
        LOGIN_RATE_LIMIT_IP_MAX: "1000",
        DATABASE_URL: databaseUrl,
        REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "test_access_secret_min_32_characters_long",
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "test_refresh_secret_min_32_characters_long",
        PASSWORD_RESET_SECRET: process.env.PASSWORD_RESET_SECRET ?? "test_reset_secret_min_32_characters_long",
        FRONTEND_URL: baseURL,
      },
    },
    {
      command: `npx vite preview --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      cwd: ".",
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_URL: apiURL,
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})