# Security

## Authentication
- Argon2id password hashing (`argon2` npm package, memory-hard, OWASP-recommended over bcrypt)
- JWT access tokens (short-lived, default 15m) + refresh tokens (default 7d)
- Refresh tokens are tracked in Redis by `jti` and rotated on every use (old jti revoked
  immediately) — a stolen refresh token becomes useless after its first legitimate use
- Access tokens can be blacklisted (logout) — checked against Redis until natural expiry
- Account lockout after `ACCOUNT_LOCKOUT_MAX_ATTEMPTS` (default 5) failed logins within
  `ACCOUNT_LOCKOUT_WINDOW_SECONDS` (default 15 min), tracked in Redis
- No public registration endpoint — users are provisioned by an Admin only

## Authorization
- Role-based access control on every route via `requireRole([...])`
- Roles: `ADMIN, RECEPTIONIST, DOCTOR, LAB_TECHNICIAN, PHARMACIST, NURSE`
- Ownership checks where relevant (e.g. only the assigned doctor or an Admin may
  edit/sign a consultation; a user cannot deactivate their own account)

## Input validation
- Every request body/query/params validated with Zod before touching the database
- Centralized error handler never leaks stack traces in production

## Data protection
- Soft deletes on Patients, Users, Prescriptions, Payments — nothing clinical or
  financial is ever hard-deleted
- Full audit trail (`audit_logs`) on every create/update/delete/sign/void/status-change,
  including actor, IP address, user agent, and before/after values — read-only, admin-only,
  no delete endpoint exists for this table
- Passwords never returned in any API response (explicit `select` allow-lists on User)

## Transport & headers
- `helmet()` for standard security headers (HSTS, X-Content-Type-Options, etc.)
- CORS locked to `FRONTEND_URL`
- Rate limiting: login (10/15min), forgot-password (5/15min), global API (300/min)

## Secrets
- All secrets loaded from environment variables, validated at boot with Zod
  (the app refuses to start with missing/short secrets)
- `.env` is never committed — see `.env.example` for the required shape
- Rotate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `PASSWORD_RESET_SECRET`
  independently; rotating a secret invalidates all tokens signed with the old one

## Database
- Parameterized queries exclusively via Prisma — no raw SQL string concatenation
- Foreign key constraints enforce referential integrity (`onDelete: Restrict` on
  clinical/financial relations to prevent accidental cascading data loss)

## Reporting a vulnerability
This is an internal client project. Report findings directly to the maintainer
rather than filing a public issue.
