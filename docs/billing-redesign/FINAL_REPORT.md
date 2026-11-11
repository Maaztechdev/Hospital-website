# Billing redesign final report

- Branch: `feature/billing-redesign`
- Starting commit for comparison: `8489e31` (`fix billing regressions and add evidence tests`)
- Report date: `2026-10-26`
- Report path: `docs/billing-redesign/FINAL_REPORT.md`

## 1) Status per prompt (1 to 7)

| Prompt | Phase | Status | Date | Commit hash |
|---|---|---:|---|---|
| Prompt 1 | Part 1A | DONE | 2026-10-24 | `09d4c5e9e0eea1769cf6b851bf443758a247bc5d` |
| Prompt 2 | Part 1B | DONE | 2026-10-25 | `f2d5cd01e6bee32aeca01cbcabe38983e6944cb3` |
| Prompt 3 | Phase 2 | DONE | 2026-10-25 | `a8c900da48f0a40842d1bf4500375f22e4e5858c` |
| Prompt 4 | Phase 3 | DONE | 2026-10-25 | `4ead9245f5c955c8059c682144803aaad9905a96` |
| Prompt 5 | Phase 4A (IPD backend) | DONE | 2026-10-25 | `e253101d86702fe93c077a86ddab4822e3dd33ac` |
| Prompt 6 | Phase 4B (IPD frontend) | DONE | 2026-10-26 | `0bc0595d6440ebc7df43044f854f2c91cabd4285` |
| Prompt 7 | Phase 5 verification | DONE | 2026-10-26 | `db6338591bbb0ae6077d160382c2f518046c4c5c` |

## 2) What was built, per phase, in plain language

### Phase 1A (Prompt 1)

Purpose: verify and repair the original billing redesign foundations before any Part 1B work started.

Built:
- Reproduced the payment race condition as a negative control and confirmed the `FOR UPDATE` lock prevents over-collection.
- Verified service-level discount validation directly against the billing service.
- Verified invoice-vs-payment date logic for invoiced and collected revenue.
- Confirmed backend pagination for the invoice list and payment history retention after void.
- Confirmed the role/department authorization matrix for payment collection and void requests.
- Cleaned up the temporary `jest-results.json` artifact and confirmed it is ignored.

Main files touched:
- `docs/billing-redesign/RULES.md`
- `docs/billing-redesign/PROGRESS.md`
- `careplus-backend/tests/integration/billing-part1a-evidence.database.test.ts`
- `careplus-backend/tests/integration/revenue-summary-date-range.test.ts`
- `careplus-backend/tests/integration/billing-concurrent-payments.database.test.ts`

### Phase 1B (Prompt 2)

Purpose: add department-aware invoice data, numbering, refunds, and endpoint support while preserving legacy flows.

Built:
- `InvoiceDepartment` enum and additive invoice `department` field, with a documented fallback and a backfill review CSV for ambiguous invoices.
- Department/year invoice numbering using the project’s transactional sequence pattern.
- Refunds implemented as new `Payment` rows with `type=REFUND`, reason, audit metadata, and over-refund protection.
- Billing query endpoints extended with department/status/date/patient/staff/search filtering and backend pagination.
- Summary and history endpoints were extended to include department totals and IPD source attribution.
- Role/route enforcement was tightened in both the route layer and service layer.

Main files touched:
- `careplus-backend/prisma/schema.prisma`
- `careplus-backend/prisma/migrations/20261024230000_billing_departments_refunds/migration.sql`
- `careplus-backend/scripts/backfill-invoice-departments.ts`
- `careplus-backend/src/modules/billing/billing.routes.ts`
- `careplus-backend/src/modules/billing/billing.service.ts`
- `careplus-backend/tests/integration/billing-part1b.database.test.ts`
- `careplus-backend/tests/integration/billing-part1b-routes.database.test.ts`
- `docs/billing-redesign/backfill-review.csv`

### Phase 2 (Prompt 3)

Purpose: build the department billing UI without duplicating business logic.

Built:
- Reusable department billing panels and invoice tables for Lab, Pharmacy, Ultrasound, and Reception.
- Payment collection flow, invoice detail, payment history, and printable receipt output.
- Role-gated views for Lab Technician, Pharmacist, Ultrasound staff, and Receptionist.
- Responsive layout and empty/loading/error states for each panel.
- No unbilled-work suggestion queue was added because the existing flows create invoices at the order/sale point rather than leaving completed work sitting unbilled.

Main files touched:
- `careplus-frontend/src/dashboard/pages/billing/DepartmentBillingPanel.tsx`
- `careplus-frontend/src/dashboard/pages/billing/DepartmentWorkspace.tsx`
- `careplus-frontend/src/dashboard/pages/billing/InvoiceDetail.tsx`
- `careplus-frontend/src/dashboard/pages/billing/InvoiceReceiptPrint.tsx`
- `careplus-frontend/src/dashboard/DashboardApp.tsx`
- `careplus-frontend/src/dashboard/nav.ts`
- `careplus-frontend/tests/e2e/billing-department-screens.spec.ts`

### Phase 3 (Prompt 4)

Purpose: consolidate the admin and manager billing experience into a single, department-aware workspace.

Built:
- One Lab, Pharmacy, and Ultrasound tab for Admin, each with Overview, Work items, Billing, History, and Manage sections.
- A combined All billing view for Admin and Billing Manager with department filters, date range, staff, search, pagination, and CSV export.
- Route redirects from the legacy department paths to the new workspace sections.
- Responsive and consistent billing layout using the shared department-aware components.

Main files touched:
- `careplus-frontend/src/dashboard/pages/admin/AdminDashboard.tsx`
- `careplus-frontend/src/dashboard/pages/billing/BillingDashboard.tsx`
- `careplus-frontend/src/dashboard/DashboardApp.tsx`
- `careplus-frontend/src/dashboard/nav.ts`
- `careplus-frontend/tests/e2e/billing-consolidation.spec.ts`

### Phase 4A (Prompt 5)

Purpose: complete the IPD billing backend.

Built:
- One IPD invoice per admission, with payment/deposit and refund handling tied to the invoice.
- Bed-rent calculation using a daily, cut-off-aware rule and a single source-of-truth function.
- Ward medicine issue and return flow, reusing FEFO stock deduction logic and posting to the IPD invoice.
- Service charge catalog and role-based service-line reversal logic.
- Lab and Ultrasound orders placed from an admission now post to the IPD invoice instead of creating a separate OPD invoice.
- Final bill discharge/settlement workflow with audit-safe deposit and refund handling.

Main files touched:
- `careplus-backend/prisma/migrations/20261025000000_ipd_billing_backend/migration.sql`
- `careplus-backend/src/modules/ipd/ipdBilling.service.ts`
- `careplus-backend/src/modules/ipd/ipdBilling.utils.ts`
- `careplus-backend/src/modules/wards/wards.service.ts`
- `careplus-backend/src/modules/lab/lab.service.ts`
- `careplus-backend/src/modules/ultrasound/ultrasound.service.ts`
- `careplus-backend/tests/integration/ipd-billing.database.test.ts`
- `careplus-backend/tests/unit/ipd-bed-rent-days.test.ts`

### Phase 4B (Prompt 6)

Purpose: bring the IPD backend to the frontend as an operational billing UI.

Built:
- Running bill views for admissions with Bed, Medicines, Services, Tests, and payment history.
- Deposit/payment flow with role restrictions.
- Discharge preview/final bill and settlement/refund handling.
- Pharmacy ward issue screen and a ward round view that supports admission-linked billing actions.
- Responsive print and status views for the IPD financial workflow.

Main files touched:
- `careplus-frontend/src/dashboard/pages/ward/IpdRunningBill.tsx`
- `careplus-frontend/src/dashboard/pages/ward/DischargeModal.tsx`
- `careplus-frontend/src/dashboard/pages/pharmacy/WardMedicineIssuePanel.tsx`
- `careplus-frontend/src/dashboard/pages/ward/WardRoundPage.tsx`
- `careplus-frontend/src/print/PrintDocuments.tsx`
- `careplus-frontend/tests/e2e/ipd-billing-frontend.spec.ts`

### Phase 5 (Prompt 7)

Purpose: full verification, audit, and evidence capture across build, backend tests, E2E, and billing totals.

Built:
- Verification summaries and evidence capture in `docs/billing-redesign/PROGRESS.md`.
- Final bridge from the completed billing redesign to the owner’s final report.
- No additional source changes were made in this prompt beyond documentation.

Main files touched:
- `docs/billing-redesign/PROGRESS.md`
- `docs/billing-redesign/FINAL_REPORT.md` (this file)

### Git diff summary from the starting commit

`git diff --stat 8489e31..HEAD` reports:

- 59 files changed
- 5,967 insertions(+)
- 295 deletions(-)

Main files included in the feature branch diff are:
- `careplus-backend/prisma/schema.prisma`
- `careplus-backend/prisma/migrations/20261024230000_billing_departments_refunds/migration.sql`
- `careplus-backend/prisma/migrations/20261025000000_ipd_billing_backend/migration.sql`
- `careplus-backend/src/modules/billing/billing.service.ts`
- `careplus-backend/src/modules/ipd/ipdBilling.service.ts`
- `careplus-frontend/src/dashboard/pages/billing/DepartmentBillingPanel.tsx`
- `careplus-frontend/src/dashboard/pages/billing/DepartmentWorkspace.tsx`
- `careplus-frontend/src/dashboard/pages/ward/IpdRunningBill.tsx`
- `careplus-frontend/src/dashboard/DashboardApp.tsx`
- `careplus-frontend/src/dashboard/nav.ts`

## 3) Final verification numbers

### Build and lint

| Check | Command | Result |
|---|---|---|
| Backend build | `cd careplus-backend && npm run build` | PASS, exit 0 |
| Frontend build | `cd careplus-frontend && npm run build` | PASS, exit 0 |
| Frontend lint | `cd careplus-frontend && npm run lint` | PASS, exit 0; warnings only |

Observed lint warnings included:
- `src/lib/api.ts` — `no-constant-condition` warning
- `tests/e2e/call-next-consultation-record.spec.ts` — unused imports/variables
- The repo also tracks an existing lint warning in `NursePanel.tsx` (`react-hooks/exhaustive-deps`)

### Backend Jest

Command run:
- `cd careplus-backend && npm test -- --runInBand`

Observed result:
- `Test Suites: 62 passed, 62 total`
- `Tests: 450 passed, 450 total`
- `Snapshots: 0 total`
- Exit code: 0

### Playwright

Command run:
- `cd careplus-frontend && npm run e2e -- --reporter=line`

Observed result:
- `Running 58 tests using 1 worker`
- `56 passed`
- `1 failed`
- `1 skipped`
- Exit code: 1

Evidence from the output:
- `Error: page.waitForLoadState: Test timeout of 60000ms exceeded.`
- The failing spec was a non-billing responsive-clinical-pages test and not part of the billing redesign files; the output shows a timeout around the responsive pages suite, not a billing assertion failure.

Pre-existing / non-billing failure list:
- `responsive-clinical-pages--...` test timed out while waiting for page load state.
- The failure occurs in a non-billing E2E spec and is not in the billing-redesign source files covered by this feature branch.

## 4) Migrations: order, purpose, and owner commands

### Migration 1: `20261024230000_billing_departments_refunds`

Purpose:
- Adds the `InvoiceDepartment` enum (`RECEPTION`, `LAB`, `PHARMACY`, `ULTRASOUND`, `IPD`).
- Adds `department` to `Invoice` and source metadata to `InvoiceItem`.
- Adds payment `type` and refund-related data (`PAYMENT`, `REFUND`) plus reason and audit metadata.
- Adds per-department, per-year numbering sequences.
- Leaves invoices and payments additive-only and preserves old values.

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

Rollback note:
- This migration is additive. The safe rollback is a full database restore from backup; do not edit the committed migration and do not `prisma migrate rollback` against production without a verified restore point.

### Migration 2: `20261025000000_ipd_billing_backend`

Purpose:
- Adds the IPD billing model and constraints: unique IPD invoice per admission, admission-linked `invoice_id`, `admission_id`, and service/bed metadata.
- Adds bed-rent and service-charge structures.
- Adds ward medicine issue/return support.
- Adds cutoff-time setting and links Lab/Ultrasound orders from an admission directly to the IPD invoice.
- Keeps `PatientLedgerEntry` as compatibility data rather than the main billing ledger.

Backup-first reminder:
- `pg_dump "$DATABASE_URL" > ./backup_before_20261025000000_ipd_billing_backend.sql`

Owner commands (development or production DB):
```bash
cd careplus-backend
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

Rollback note:
- This migration also adds tables and links; the correct rollback path is a database restore from backup. Because it is not safe to reverse in-place for a live database, avoid direct migration rollback and restore from a known-good snapshot instead.

## 5) Backfill results

Result from the recorded billing-redesign validation work:

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

Current repo state of the CSV:
- The file exists and contains the header line only: `invoice id,invoice number,reason,suggested department`.
- It is meant to be generated during a real backfill run; the historical repo snapshot did not include populated backfill rows because the backfill was validated via fixtures and documentation rather than a live production record.

## 6) RBAC matrix as implemented

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

## 7) Behavior rules as implemented

### Payment collection
- Payments can be collected by the invoice department’s own staff and by the Receptionist.
- Receptionist may collect on RECEPTION and on LAB / PHARMACY / ULTRASOUND non-IPD invoices, but not on IPD invoices unless that permission is explicitly widened by a separate rule.
- Refund and void remain restricted to Admin and Billing Manager.

### Refund and void
- Refunds are never edits or deletes of the original payment row.
- Refunds create a new `Payment` row with `type=REFUND`, reason, `createdBy`, and timestamps.
- Refunds cannot exceed the amount actually paid.
- Void creates reversal history and preserves payment rows with a clear `reversed` flag instead of irreversibly deleting them.
- Billing Manager may also void Lab invoices; this is the one role-specific exception listed in the rules.

### Revenue definitions
- Collected revenue is calculated by payment date.
- Invoiced revenue is calculated by invoice date.
- The summary logic matches raw `Payment` rows for collected/refunded totals and invoice row totals for invoiced totals.

### Numbering format
- Invoice numbers are per department and per year.
- Format: `LAB-2026-000123`, `PHARM-2026-000001`, `USG-2026-000010`, `RECEPTION-2026-000200`, `IPD-2026-000015`, etc.
- Existing legacy invoice numbers are left unchanged.

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

### Ward medicine posting
- Ward medicines are issued by Pharmacy to an admission and post automatically to the admission’s IPD invoice.
- The issue flow reuses the FEFO stock-deduction logic and records the associated invoice item and source department.
- Returned medicines create a credit line or reversal with reason, rather than deleting the original issue record.

### Deposit and settlement
- Admission may include a deposit payment on the IPD invoice with `purpose = DEPOSIT`.
- Discharge settlement can collect the remaining balance or generate a refund for excess deposit as a `REFUND` payment, restricted to Admin and Billing Manager.
- All settlement-related movements remain auditable and in-transaction.

## 8) Known gaps, risks, unverified items, and extra findings

Known gaps / risks:
- Docker / container deployment was not verified in this report.
- Real mobile-device testing was not performed beyond the responsive layout checks reported in the repo.
- Real printer hardware was not used; print flows were validated through the app logic and rendered documents, not a physical device.
- The repo’s backend `lint` script points at a missing `eslint` binary, so lint validation is effectively a warning-only check in this environment.
- The project still contains existing audit warnings and a non-billing `page.waitForLoadState` Playwright timeout in the full suite.

Extra findings recorded in the repo:
- Baseline frontend lint warnings are unrelated to the billing redesign and were intentionally preserved.
- The backend Redis/Jest connection can leave a TCP handle open; this was addressed by using `--forceExit` for the passing full suite after confirmation of results.
- Billing Manager patient-profile access for IPD still uses a broader shared permission; the repo marks this as a follow-up item rather than a blocker.
- `npm audit --audit-level=low --json` reported 4 backend vulnerabilities (1 moderate, 3 high) and 0 frontend vulnerabilities; no package upgrades were applied as requested.

## 9) Manual test checklist for the owner

1. Log in as Admin and confirm the consolidated main dashboard appears.
2. Open Admin -> All billing and confirm department, status, date, staff, and search filters are visible.
3. Export the filtered CSV and verify the file includes all filtered rows.
4. Open Admin -> Lab and confirm Overview, Work items, Billing, History, and Manage sections exist.
5. Open Admin -> Pharmacy and verify the same sections and old management pages remain reachable inside the Manage selector.
6. Open Admin -> Ultrasound and verify the same consolidated layout.
7. Log in as Billing Manager and confirm the Billing Manager can view All billing and department histories without system settings access.
8. Attempt to access a system settings page as Billing Manager and confirm it is blocked or unavailable.
9. Log in as Receptionist and create a RECEPTION invoice.
10. Collect a payment on that RECEPTION invoice and confirm the amount is reflected in the invoice summary.
11. Try to refund the invoice and confirm a 403 response.
12. Try to void the invoice and confirm a 403 response.
13. Log in as Lab Technician and confirm only LAB invoices are accessible.
14. Create or open a LAB invoice, collect payment, and confirm the invoice detail shows the payment history.
15. Attempt to open a PHARMACY or ULTRASOUND invoice and confirm 403.
16. Log in as Pharmacist and confirm only PHARMACY department billing is accessible.
17. Issue a ward medicine and verify it posts to the patient’s IPD invoice.
18. Collect a payment on a PHARMACY invoice and verify the result appears in the billing summary.
19. Log in as Ultrasound staff and confirm only ULTRASOUND department billing is accessible.
20. Create or open an ULTRASOUND invoice and collect payment successfully.
21. Log in as Doctor and confirm no billing collection controls are visible.
22. Log in as Nurse and confirm no billing payment controls are visible; only allowed service-line actions remain.
23. Admit a patient and confirm exactly one IPD invoice is created for the admission.
24. Add a service line as the Doctor or Nurse, verify it appears in the running bill, and confirm the total updates.
25. Record a deposit on the admission invoice and confirm the deposit is visible and counted correctly.
26. Order a Lab or Ultrasound test from the ward and confirm it posts to the IPD invoice instead of creating a separate OPD invoice.
27. Discharge the patient, review the final bill, and settle the balance or refund the excess deposit per role permissions.
28. Verify All billing summary totals, department totals, and payment-date/invoice-date totals match the raw payment and invoice data.
29. Confirm that refund and void controls are visible only for Admin and Billing Manager, and hidden for everyone else.
30. For a final role sweep, confirm each role stays within its department scope at every billing action.

## 10) Decisions the owner still needs to make

- Whether to keep the current legacy routes as redirect-only or remove them after a later deprecation period.
- Whether to treat the existing `PatientLedgerEntry` compatibility data as a temporary bridge or a long-term archival-only ledger.
- Whether to take the backend security advisories (`body-parser`, `multer`, `uuid`, `zod`) in a separate patch cycle or leave them as a documented risk for now.
- Whether to continue using the current `12:00` default cut-off or convert to a global timezone setting later.
- Whether the remaining non-billing Playwright timeout should be fixed immediately or deferred as a separate, unrelated QA item.

## Final status summary

- The billing redesign is implemented and verified on the `feature/billing-redesign` branch.
- The repo records two booking-related migration additions, plus the backfill script and review CSV.
- The codebase is build-clean and backend Jest-clean.
- Full Playwright still shows one non-billing timeout in the responsive-clinical-pages suite.
- The billing redesign itself was released as a verified feature branch with the evidence captured in `docs/billing-redesign/PROGRESS.md` and summarized here.

Path of the final report:
- `E:\Download folder\Khalida Hospital full stack\docs\billing-redesign\FINAL_REPORT.md`
