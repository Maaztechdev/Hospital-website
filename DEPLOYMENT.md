# CarePlus Production Deployment & Delivery Guide

This document defines the production delivery requirements, security hardening checklist, and verified operational procedures for deploying the CarePlus Hospital Management System.

---

## Pre-Deployment Delivery Checklist

Before going live in any production environment, every item on this checklist must be verified and signed off by the engineering and clinical operations teams.

### 1. Credentials & Demo Accounts
- [ ] **Demo Passwords Eliminated:** Verify that demo credentials (`admin@careplus.local`, `dr.ahmed@careplus.local`, `pharmacist@careplus.local`, etc.) from development seeds are **not** present in the production database.
- [ ] **First Admin Bootstrapped via Script:** Run `npm run bootstrap:admin` with unique, high-entropy administrator credentials.
- [ ] **Password Policy Enforced:** All user passwords must satisfy the system policy: minimum 8 characters, with uppercase, lowercase, digit, and special character.

### 2. Secret Keys & Environment Protection
- [ ] **Generate Fresh JWT Secrets:**
  - `JWT_ACCESS_SECRET` (minimum 32 random characters).
  - `JWT_REFRESH_SECRET` (minimum 32 random characters, different from access secret).
  - `PASSWORD_RESET_SECRET` (minimum 32 random characters).
  ```bash
  # Generate 32+ character cryptographically secure secrets:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- [ ] **Refuse Default Secrets:** Verify `NODE_ENV=production` is set in the runtime environment. The backend will refuse to start if demo or placeholder secrets are detected.
- [ ] **No Secrets in Source Control:** Verify `.env` is absent from git:
  ```bash
  git ls-files | Select-String -Pattern "env"
  ```
- [ ] **Private Repository:** Ensure the repository is hosted as a private repository with branch protection rules enabled on `main`.

### 3. Database & Network Security
- [ ] **Dedicated Production Database:** Use a standalone PostgreSQL 16 instance. Never run tests against the production database (`_test` database names only for testing).
- [ ] **Strict Connection Strings:** Ensure `DATABASE_URL` uses SSL (`?sslmode=require` or verify-full) and a unique database user with minimal necessary schema privileges.
- [ ] **CORS Origin Locked Down:** Set `FRONTEND_URL` in `careplus-backend/.env` strictly to the production frontend domain (e.g. `https://careplus.yourhospital.com`). Wildcards (`*`) or `localhost` are rejected in production.
- [ ] **Reverse Proxy & HTTPS:** Terminate TLS/SSL (Let's Encrypt / Cloudflare / Nginx) before requests reach the application. Set `TRUST_PROXY_HOPS=1` (or matching your proxy hops).
- [ ] **Redis Protection:** Ensure Redis 7 instance is password-protected (`requirepass`) and accessible only over a private subnet or Unix socket.

### 4. Backups & Disaster Recovery
- [ ] **Nightly Automated Backups Configured:**
  - Option A (In-app scheduler): Set `AUTO_BACKUP_ENABLED=true` and `BACKUP_RETENTION_DAYS=30` in backend `.env`.
  - Option B (System cron / Task Scheduler): Configure external cron running `pg_dump` daily at off-peak hours (e.g. 02:00 AM).
- [ ] **Disaster Recovery Tested:** Verify that a database dump can be restored cleanly into an isolated database without errors (tested and verified with table row parity checks).
- [ ] **Offsite Replication:** Sync `./backups` directory to secure encrypted offsite object storage (AWS S3 with Object Lock / Azure Blob).

---

## Verified Step-by-Step Production Deployment

### Step 1: Database Migration
Deploy Prisma migrations without schema recreation or destructive actions:

```bash
cd careplus-backend
NODE_ENV=production npx prisma migrate deploy
```

### Step 2: Bootstrap Initial Administrator
Provision the initial hospital administrator account using deployment secrets:

```bash
cd careplus-backend
BOOTSTRAP_ADMIN_NAME="Hospital Administrator" \
BOOTSTRAP_ADMIN_EMAIL="admin@yourhospital.com" \
BOOTSTRAP_ADMIN_PASSWORD="StrongProductionAdminPassword#2026" \
NODE_ENV=production npm run bootstrap:admin
```

### Step 3: Build & Start Backend Service
```bash
cd careplus-backend
npm run build
NODE_ENV=production npm start
```

### Step 4: Build & Serve Frontend Bundle
```bash
cd careplus-frontend
VITE_API_URL="https://api.yourhospital.com/api/v1" npm run build
# The resulting `dist/` folder is served via Nginx or Cloudflare Pages with HTTPS.
```

---

## Production Health & Verification Commands

All commands below have been tested and verified against the running services:

### 1. Backend Application Health Check
```bash
curl -I http://localhost:4000/health
```
Expected response:
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
```
Payload:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-10-21T...",
    "uptime": 123.45,
    "environment": "production"
  }
}
```

### 2. Startup Guard Verification
Verify that starting in production with a demo secret fails immediately:
```bash
JWT_ACCESS_SECRET="careplus-super-secret" NODE_ENV=production node dist/server.js
# Exits with status 1: Production security violation: JWT_ACCESS_SECRET contains forbidden default/demo placeholder.
```

### 3. Database Row Verification (Post-Restore Check)
```bash
npx tsx scripts/verify-backup-restore-test.ts
# Automatically dumps, restores to an isolated _test database, verifies table row counts, and cleans up.
```