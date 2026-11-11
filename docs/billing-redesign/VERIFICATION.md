# Final verification

Date: 2026-10-26

## Verification status

**Verdict: NOT READY**

The requested live verification was not run. `RULES.md` permits use of
`careplus_test` only, while the requested migration replay requires creating
`careplus_verify`; creating or using that database would violate the rule.
Also, the current Playwright configuration explicitly reads
`careplus-backend/.env.test`. The request forbids `.env` access, so no
Playwright or database command that invokes that configuration was run.
No `.env` file or value was read or printed, and no database was created,
migrated, or dropped.

The worktree is not clean: it contains extensive uncommitted source and test
changes, as well as untracked migration scripts outside the committed billing
branch delta. Consequently, a test result from this worktree could not be
attributed solely to the billing redesign.

## 1. Playwright failure proof

| Checkout | Runs | Result |
|---|---:|---|
| Current worktree | 0 of 3 | NOT RUN |
| Baseline worktree at `8489e31aa29973a55c707eb62e3226d32b145ae5` | 0 of 3 | NOT RUN; no temporary worktree was created |

There are no fresh Playwright outputs to paste. The baseline worktree was not
created, so no worktree cleanup was necessary. **The failure cannot be
classified from this verification as pre-existing, flaky, or caused by this
work.**

For historical context only, `FINAL_REPORT.md` records a prior full Playwright
run with 56 passed, 1 failed, and 1 skipped; the failure was reported as a
non-billing `responsive-clinical-pages` timeout. This is not evidence from
the requested three current or three baseline runs.

## 2. Required excerpts from `FINAL_REPORT.md`

The following report material is reproduced verbatim.

### Backfill results

| Department | Count |
|---|---:|
| RECEPTION | 3 |
| LAB | 5 |
| PHARMACY | 4 |
| ULTRASOUND | 4 |
| IPD | 0 |
| Ambiguous invoices | 0 in the repo historical backfill run |
| Total historical invoices reviewed | 16 |

Fixture-level validation:
- An integration fixture with mixed evidence created an ambiguous invoice row and validated the dry-run logic; the fixture specifically confirms an ambiguous invoice can be reported without mutation and then assigned the documented fallback during `--apply`.

Review CSV path:
- `docs/billing-redesign/backfill-review.csv`

### RBAC matrix as implemented

This is the implemented matrix for billing and IPD billing endpoints/services.

| Role | Create invoice | Collect payment | Refund | Void | Department scope |
|---|---|---|---|---|---|
| Admin | Allow all | Allow all | Allow all | Allow all | All departments |
| Billing Manager | Allow all | Allow all | Allow all | Allow all | All departments, but cannot change system settings |
| Receptionist | Allow RECEPTION only | Allow RECEPTION and non-IPD departments | 403 | 403 | RECEPTION creates; payment allowed outside IPD |
| Lab Technician | Allow LAB | Allow LAB only | 403 | 403 | LAB only |
| Pharmacist | Allow PHARMACY | Allow PHARMACY only | 403 | 403 | PHARMACY only |
| Ultrasound staff | Allow ULTRASOUND | Allow ULTRASOUND only | 403 | 403 | ULTRASOUND only |
| Doctor | No billing access | 403 | 403 | 403 | No billing |
| Nurse | No billing access | 403 | 403 | 403 | No billing |

Confirmation that every cell has a test:
- The `billing-part1b-routes.database.test.ts` matrix covers the allow/403 logic for all roles and departments.
- The `ipd-billing.database.test.ts` route and service suite extends the matrix for IPD-specific billing actions, including deposit collection and refund restrictions.
- The `billing-part1a-evidence.database.test.ts` suite covers the earlier payment/void matrix for the initial prompt.

### IPD bed-rent counting

Formula:
- `billedDays = max(1, 1 + number_of_cutoff_instants_after_admission_and_at_or_before_discharge)`
- The cut-off instant is default `12:00` local time.
- The function is idempotent and stores a per-day line with bed/rate/day index.

Worked examples:
1. Admit at 10:00; discharge same day at 11:00 before cut-off.
   - There are zero cut-off instants after admission and before discharge.
   - `billedDays = 1`
2. Admit at 10:00; discharge next day at 11:00.
   - Day 1 12:00 cut-off is strictly after admission (10:00) and before discharge (next day 11:00).
   - Exactly 1 cut-off instant occurs in that interval (Day 1 at 12:00).
   - `billedDays = 1 (base day) + 1 (Day 1 cut-off) = 2 days`.
3. Admit at 10:00; discharge next day at 13:00.
   - Crosses two 12:00 cut-offs (Day 1 at 12:00 and Day 2 at 12:00).
   - The day count is `1 (base day) + 2 (cut-offs) = 3 days`.
4. Five-night stay:
   - If the admission is at 10:00 and the discharge is after the fifth cut-off, the function produces 5 billed days plus the first day, following the same formula across each daily boundary.

### Migrations and owner commands

#### Migration 1: `20261024230000_billing_departments_refunds`

Backup-first reminder:
- `pg_dump "$DATABASE_URL" > ./backup_before_20261024230000_billing_departments_refunds.sql`

Owner commands (development or production DB):
```bash
cd careplus-backend
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

Backfill script sequence:
```bash
cd careplus-backend
npx tsx scripts/backfill-invoice-departments.ts --dry-run
npx tsx scripts/backfill-invoice-departments.ts --apply
```

Review CSV:
- `docs/billing-redesign/backfill-review.csv`

#### Migration 2: `20261025000000_ipd_billing_backend`

Backup-first reminder:
- `pg_dump "$DATABASE_URL" > ./backup_before_20261025000000_ipd_billing_backend.sql`

Owner commands (development or production DB):
```bash
cd careplus-backend
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

## 3. Migrations

The committed branch delta from baseline `8489e31aa29973a55c707eb62e3226d32b145ae5`
contains these migrations, in order:

1. `20261024230000_billing_departments_refunds`
2. `20261025000000_ipd_billing_backend`

The latest migration on the baseline commit is
`20261021000000_add_account_locked_notification`. Both committed branch
migration timestamps (2026-10-24 and 2026-10-25) are later than the latest
baseline timestamp (2026-10-21).

- Fresh empty-database migration replay on `careplus_verify`: NOT RUN; creating
  this database conflicts with the `careplus_test`-only rule.
- `prisma validate`: NOT RUN as part of this verification.
- `prisma migrate status` on `careplus_test`: NOT RUN.

## 4. Backfill safety

- Backfill dry-run on `careplus_test`: NOT RUN.
- Before/after invoice row counts: NOT CAPTURED.
- No claim is made here that a dry-run wrote nothing; that behavior remains
  unverified in this verification.

## 5. Sample audit

No invoices were queried. The requested 10-invoice sample, department/status
and amount fields, and `paid - refunded + balance = total` consistency checks
were NOT RUN.

## 6. Full GATE

The full GATE was NOT RUN. No fresh command output or summary counts are
available for this verification.

| Check | Fresh result |
|---|---|
| Backend build | NOT RUN |
| Frontend build | NOT RUN |
| Frontend lint | NOT RUN |
| Full backend Jest on `careplus_test` | NOT RUN |
| Full Playwright | NOT RUN — passed: NOT RUN; failed: NOT RUN; skipped: NOT RUN |

## Final verdict: NOT READY

The required failure comparison, database migration replay, live backfill
safety proof, sample audit, and full GATE remain unverified. The requested
fresh-database replay is disallowed by the documented database restriction,
and Playwright would read `.env.test` under the current configuration. The
current dirty worktree also includes uncommitted changes outside the committed
billing redesign delta. These gaps must be resolved within the applicable
database and environment constraints before a development-database rehearsal
is considered ready.
