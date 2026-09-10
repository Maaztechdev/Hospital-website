# CarePlus Backend

Production-grade REST API for the CarePlus Hospital Management System.
Node.js · Express · TypeScript · Prisma · PostgreSQL · Redis.

Covers all 17 modules: Auth, Users, Patients, Appointments, OPD Queue, Consultations,
Prescriptions, Lab, Pharmacy, Billing, Wards, Nursing, OT, Notifications, Reports,
Settings, and Audit Logs.

## Quick start

### 1. Prerequisites
- Node.js 20+
- PostgreSQL 16 (or use `docker-compose up postgres redis`)
- Redis 7

### 2. Install & configure
```bash
npm install
cp .env.example .env
# edit .env — set real secrets, DATABASE_URL, REDIS_URL
```

### 3. Database
```bash
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
```

> **Note:** `npx prisma generate` downloads the query engine binary from
> `binaries.prisma.sh`. This must be run somewhere with unrestricted network access
> (e.g. your local machine or CI) before the project will type-check or run — it
> cannot complete in network-sandboxed environments that only allow specific domains.

### 4. Run
```bash
npm run dev        # tsx watch, http://localhost:4000
npm run build && npm start   # production build
```

API docs (Swagger UI): `http://localhost:4000/api-docs`
Health check: `http://localhost:4000/health`

### 5. Docker (full stack)
```bash
docker compose up --build
```

## Seeded accounts (after `npm run prisma:seed`)

| Role | Email | Password |
|---|---|---|
| Admin | admin@careplus.local | Admin@12345 |
| Doctor | dr.ahmed@careplus.local | Doctor@12345 |
| Doctor | dr.fatima@careplus.local | Doctor@12345 |
| Receptionist | reception@careplus.local | Staff@12345 |
| Pharmacist | pharmacist@careplus.local | Staff@12345 |
| Lab Technician | labtech@careplus.local | Staff@12345 |
| Nurse | nurse@careplus.local | Staff@12345 |

## Architecture

```
src/
  app.ts, server.ts        Express app assembly + graceful-shutdown bootstrap
  config/                  env, prisma client, redis client, logger, swagger
  common/
    middleware/            authenticate, requireRole (RBAC), validate (Zod),
                            errorHandler, requestId, rateLimiter
    errors/                AppError hierarchy (400/401/403/404/409/422/423)
    utils/                 apiResponse envelope, asyncHandler, pagination,
                            sequence generators (MR/invoice/token), auditLog, notify
  modules/<name>/
    <name>.routes.ts        Express router + Swagger JSDoc annotations
    <name>.controller.ts     thin HTTP layer
    <name>.service.ts        business logic, Prisma calls, transactions
    <name>.validators.ts     Zod schemas
prisma/
  schema.prisma             full 17-module data model
  seed.ts                   departments, users, doctors, lab tests, medicines, wards
tests/
  unit/                     pure-logic tests (state machine, FEFO algorithm, JWT)
  integration/               supertest against the real Express app (validation/auth)
```

### Design patterns used throughout
- **Consistent response envelope**: `{ success, data, message, errors, pagination? }`
- **RBAC**: `authenticate` (JWT) + `requireRole([...])` on every protected route
- **Validation**: Zod schemas on body/query/params via `validate()` middleware
- **Audit logging**: every mutating action writes to `audit_logs` (immutable, admin-readable)
- **Transactions**: MR numbers, invoice numbers, token numbers, FEFO dispensing,
  bed admit/transfer/discharge, and OT scheduling all use `prisma.$transaction`
  to guarantee atomicity and avoid race conditions under concurrent requests
- **Soft deletes**: Patients, Users, Prescriptions, Payments — `deletedAt`, never hard-deleted
- **State machines**: Appointment status, Prescription/Consultation sign-lock,
  Surgery status, Bed status all enforce explicit allowed transitions

### Key business rules implemented
- **MR numbers**: `MR-YYYY-NNNNNN`, sequence-generated inside a transaction (race-safe)
- **Appointment tokens**: per-doctor per-day sequential, double-booking prevented by
  a DB unique constraint on `(doctorId, appointmentDate, timeSlot)`
- **Pharmacy FEFO**: dispensing always consumes the earliest-expiring, non-expired
  batch first; refuses to dispense from expired stock; refuses partial dispensing
  (all-or-nothing, no stock deducted on shortfall)
- **Dispensing gate**: cannot dispense against a prescription that isn't `SIGNED`
- **Lab CRITICAL results**: auto-notifies doctors/admins; amending a result creates
  a new `LabResult` row and supersedes the old one (full history retained, never overwritten)
- **Billing**: invoice numbers `INV-YYYY-NNNNNN`; payments can't exceed balance;
  void reverses logically (soft-deletes payments, never hard-deletes)
- **Wards**: admit requires an `AVAILABLE` bed; discharge sets the bed to `CLEANING`
  (must be manually cycled to `AVAILABLE` after housekeeping) — occupied beds can
  never be marked available directly
- **OT**: scheduling checks both OT-room and surgeon time-window overlap; cannot
  start surgery until all 7 pre-op checklist items are confirmed

## Testing
```bash
npm test              # all tests
npm run test:unit     # pure-logic tests, no DB/Redis required
npm run test:integration  # supertest against the app (validation/auth guards)
```

## Backups

The admin-only backup API stores full PostgreSQL dumps in `BACKUP_DIR` (default
`./backups`), never in a public folder. Files use the format
`careplus-backup-YYYY-MM-DD-HHmmss.sql`. Restore requires password confirmation,
creates a safety backup, and enables maintenance mode for the duration. Allow
disk space for the database dump and at least one safety copy. For an API
outage, use the PostgreSQL client directly:

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction \
  --file backups/careplus-backup-YYYY-MM-DD-HHmmss.sql
```

## Security
See `SECURITY.md`.
