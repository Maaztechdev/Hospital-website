import { execSync } from "child_process";
import dotenv from "dotenv";
import path from "path";

// Load test environment variables
const envPath = path.resolve(__dirname, "../.env.test");
dotenv.config({ path: envPath });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set in .env.test");
}

// Extract database name
const match = databaseUrl.match(/\/([^/?]+)(\?|$)/);
const dbName = match ? match[1] : "";

console.log(`[Safety Check] Target test database: "${dbName}"`);

// STRICT SAFETY ASSERTION
if (!dbName || !dbName.endsWith("_test")) {
  console.error(`FATAL: Database name "${dbName}" DOES NOT end with "_test"! Aborting destructive action.`);
  process.exit(1);
}

console.log(`✓ Safety check passed: Database name "${dbName}" ends with "_test".`);

// Prepare postgres admin connection URL (connecting to 'postgres' database without query params)
const postgresUrl = databaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres");

// 1. Drop and recreate database
console.log(`Dropping and recreating "${dbName}"...`);
const psqlCmd = `psql "${postgresUrl}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}';" -c "DROP DATABASE IF EXISTS \\"${dbName}\\" WITH (FORCE);" -c "CREATE DATABASE \\"${dbName}\\" OWNER careplus;"`;
execSync(psqlCmd, { stdio: "inherit" });

const backendDir = path.resolve(__dirname, "..");

// 2. Run prisma migrate deploy on the test database
console.log(`Running prisma migrate deploy on "${dbName}"...`);
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  cwd: backendDir,
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

// 3. Seed the test database
console.log(`Running seed on "${dbName}"...`);
execSync("npx tsx prisma/seed.ts", {
  stdio: "inherit",
  cwd: backendDir,
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

console.log(`✓ Fresh test database "${dbName}" successfully recreated, migrated, and seeded!`);
