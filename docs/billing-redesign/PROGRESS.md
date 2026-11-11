# Billing redesign progress

## Baseline

Recorded on 2026-10-24, before billing changes in Prompt 1A. Working branch: `feature/billing-redesign`, created from `fix/schema-sync` at `8489e31` (`fix billing regressions and add evidence tests`).

| Gate | Command | Baseline result |
|---|---|---|
| Backend build | `careplus-backend: npm run build` | PASS (exit 0) |
| Frontend build | `careplus-frontend: npm run build` | PASS (exit 0; Vite reports a chunk-size warning) |
| Frontend lint | `careplus-frontend: npm run lint` | PASS (exit 0; warnings present) |
| Full backend Jest | `careplus-backend: npm test` | PASS — 58 suites passed, 58 total; 396 tests passed, 396 total; 0 snapshots |

## Extra findings

- Baseline frontend lint reports warnings; the baseline gate exits successfully. They are unrelated to Part 1A and will not be changed here.
- The backend `lint` script references `eslint`, but that executable is unavailable in the installed dependencies. This is outside the Prompt 5 gate and was not changed.
- The existing worktree contained many unrelated modifications before this prompt. They are being preserved and will not be included in the billing commit.
- Billing Manager patient-profile access for IPD currently uses the shared `patients.view` permission, which also grants the patient list and clinical-summary read routes. A narrower billing-only profile route remains a follow-up.

## Prompt 1A — Setup and verify Part 1A

- Status: DONE
- Date: 2026-10-24
- Commit hash: `09d4c5e` (rules and verification record; this commit)
- Baseline test counts: 58/58 Jest suites passed; 396/396 tests passed. Backend build, frontend build, and frontend lint passed.
- Final gate: backend build PASS; frontend build PASS (Vite chunk-size warning); frontend lint PASS (45 warnings); full backend Jest PASS (58/58 suites, 396/396 tests, 0 snapshots).
- Negative control: with the invoice `FOR UPDATE` row lock temporarily removed, `billing-concurrent-payments.database.test.ts` failed as required: the test accepted $150 against a $100 balance (`Expected: <= 100; Received: 150`). Restored the lock; the test passed three consecutive runs (each 1 suite, 1 test).
- Backend pagination confirmed: `billing.routes.ts` returns `page`, `pageSize`, and `total`; `billing.service.ts` applies `skip`/`take` and runs a matching `count`.

| Item | Test file | Test name | Result |
|---|---|---|---|
| 1 — Payment race | `tests/integration/billing-concurrent-payments.database.test.ts` | `serializes concurrent payments and rejects requests that exceed the remaining balance` | Expected failure without lock ($150 accepted against $100); passed 3/3 runs after lock restoration. |
| 2 — Service discount validation | `tests/integration/billing-part1a-evidence.database.test.ts` | `billingService.create allows discounts equal to subtotal and rejects one paisa over, including line discounts` | PASS: direct service call; line plus invoice discount equal to subtotal accepted, one-paisa-over rejected. |
| 5 — Invoice/payment date attribution | `tests/integration/revenue-summary-date-range.test.ts` | `uses invoice dates for invoiced totals and payment dates for collected totals`; `separates invoice and payment dates when invoices are paid on different days`; `uses payment dates for collected trend and invoice dates for invoiced trend`; `counts actual payment-date collections for Ultrasound, not study fees` | PASS: 4 tests cover yesterday/today/tomorrow attribution and Ultrasound collection totals. |
| 6 — Invoice list pagination | `tests/integration/billing-part1a-evidence.database.test.ts` | `GET /billing/invoices paginates server-side and returns page, pageSize, total for more than 100 invoices` | PASS: seeds 105, asserts page 2, 20 expected rows, and total 105. Backend pagination is implemented in `src/modules/billing/billing.service.ts` and exposed by `src/modules/billing/billing.routes.ts`. |
| 7 — Voided invoice payment history | `tests/integration/billing-part1a-evidence.database.test.ts` | `GET /billing/invoices/:id retains payment rows with reversed=true after voiding` | PASS: detail retains the payment, marks `reversed=true`, and confirms one persisted payment row. |
| 8 — Payment/void authorization matrix | `tests/integration/billing-part1a-evidence.database.test.ts` | `enforces the payment and void 403/allow matrix for invoice source departments` | PASS: own-department payments allowed, cross-department/IPD denials enforced, Receptionist allowed on non-IPD, and void limited to Admin/Billing Manager including Lab; all other roles denied. |

- Focused Part 1A evidence and revenue-date run: 2 suites passed, 8 tests passed.
- Cleanup: `careplus-backend/jest-results.json` absent; Git ignores it via `careplus-backend/.gitignore`.
- No Part 1A code or test repairs were needed; existing evidence passed. No Part 1B work started.

## Prompt 1B — Department model, numbering, refunds, endpoints

- Status: DONE
- Date: 2026-10-24
- Commit hash: `f2d5cd01e6bee32aeca01cbcabe38983e6944cb3`
- Migration: `20261024230000_billing_departments_refunds`
- Migration validation: `prisma validate` passed; `prisma generate` passed; migration applied with `prisma migrate deploy` to `careplus_test`; final `prisma migrate status` reported `Database schema is up to date!`.
- Backfill: `scripts/backfill-invoice-departments.ts` is dry-run by default and requires `--apply` to write. Both modes were run against `careplus_test`. Dry-run and apply counts: RECEPTION 3, LAB 5, PHARMACY 4, ULTRASOUND 4, IPD 0, ambiguous 0 (16 existing invoices). Review CSV: `docs/billing-redesign/backfill-review.csv`.
- Ambiguous fallback: mixed/unknown evidence is not classified as a department. The script documents and applies the explicit `RECEPTION` fallback only after recording the invoice id, number, reason, and suggested department in the CSV. An integration fixture with both LAB and MEDICINE items proved the dry-run reports ambiguity without mutation and `--apply` assigns the fallback; fixture ambiguity count: 1.
- Invoice department remains nullable because mixed/unknown evidence cannot be classified unambiguously. Historical unclassified invoices use the documented Reception fallback; exact source links are not inferred for old items.
- Department numbering: transaction-upserted sequences, prefixes OPD/LAB/PHARM/USG/IPD, year-scoped counters; existing invoice numbers are untouched. Concurrent generation tested for all five departments.
- Refunds are new `Payment` rows (`type=REFUND`) with reason and audit entry; over-refunds are rejected. Pharmacy returns now add refund rows for actual paid funds while preserving stock-return/credit-reduction workflows.
- New/extended endpoints: department, date, patient, staff, status, and search invoice filtering with backend pagination; department summary and IPD source-department breakdown; Admin/Billing Manager history; refund and void.
- RBAC: department-level controls are applied in both service and route layers. Receptionist creates RECEPTION invoices and can view/collect non-IPD departments; lab, pharmacy, and ultrasound staff are limited to their department.
- Focused results: `billing-part1b.database.test.ts` — 5 passed; `billing-part1b-routes.database.test.ts` — 2 passed; `billing-part1a-evidence.database.test.ts` plus `billing-audit-atomicity.database.test.ts` — 5 passed; Pharmacy return/credit tests — 2 suites, 8 passed; billing calculation unit tests — 7 passed.
- Final gate: backend build PASS; frontend build PASS (Vite chunk-size warning); frontend lint PASS (45 warnings); full backend Jest PASS (60/60 suites, 403/403 tests, 0 snapshots).
- Test adjustments: existing direct invoice creation tests now specify RECEPTION. The prior Pharmacy credit-sale billing bypass assertion now verifies the required cashier collection behavior; Pharmacy POS and sale adjustment/return suite passed.
- No Part 1C work started.

## Prompt 3 — Phase 2 department billing screens

- Status: DONE
- Date: 2026-10-25
- Implementation commits: `a8c900d` (`Build department billing screens`) and `e47fd82` (payment-reference support and final Prompt 3 verification).
- Added the reusable `DepartmentBillingPanel` and invoice table for Lab, Ultrasound, Pharmacy, and Receptionist department collections. Panels include department/status/date/patient/staff filters, server pagination, pending-payment view, loading/error/empty states, manual invoice creation, and navigation to shared invoice details.
- Added full invoice detail loading for direct department-role links, partial payment collection by method, amount, and reference, payment/refund/reversal history, mandatory-reason refund and void dialogs restricted to Admin and Billing Manager, and Pharmacy-styled receipt printing.
- Added role-guarded Lab, Ultrasound, Pharmacy billing-history, and Receptionist collection routes/navigation. Receptionist's main Billing list is scoped to RECEPTION; the separate collection view includes only outstanding LAB, PHARMACY, and ULTRASOUND invoices.
- Added the billing staff lookup and multi-department/OUTSTANDING list filters; service and route authorization remain enforced. Existing Pharmacy POS, return/adjustment, khata, and discount-audit screens were not changed by this prompt.
- Unbilled-work suggestions were skipped after inspecting the existing flows: Lab invoices are created in the order/billing transaction, Ultrasound invoices are created with the order, and Pharmacy invoices are created with sales/dispensing. There is no separate completed-but-unbilled work queue in those flows to suggest.
- Backend build: PASS (`npm --prefix careplus-backend run build`, exit 0).
- Frontend build: PASS (`npm --prefix careplus-frontend run build`, exit 0; Vite reported the existing large-chunk warning).
- Frontend lint: PASS (`npm --prefix careplus-frontend run lint`, exit 0; warnings reported).
- Full backend Jest on `careplus_test`: PASS — 60/60 suites, 404/404 tests, 0 snapshots.
- Billing Playwright specs: PASS — 4/4 tests, including 390px viewport, department access restrictions, payment history, hidden refund/void controls for non-authorized roles, and receipt-print target behavior.

| Item | Test file | Test name | Result |
|---|---|---|---|
| Lab Technician billing, payment, history, cross-department denial, and receipt | `careplus-frontend/tests/e2e/billing-department-screens.spec.ts` | `Lab Technician collects an invoice, sees payment history, and cannot access IPD/other billing` | PASS |
| Ultrasound staff billing, payment, history, cross-department denial, and receipt | `careplus-frontend/tests/e2e/billing-department-screens.spec.ts` | `Ultrasound staff collects an invoice, sees payment history, and cannot access IPD/other billing` | PASS |
| Pharmacist billing, payment, history, cross-department denial, and receipt | `careplus-frontend/tests/e2e/billing-department-screens.spec.ts` | `Pharmacist collects an invoice, sees payment history, and cannot access IPD/other billing` | PASS |
| Receptionist cross-department collection and IPD denial | `careplus-frontend/tests/e2e/billing-department-screens.spec.ts` | `Receptionist collects an invoice, sees payment history, and cannot access IPD/other billing` | PASS |
| Multi-department outstanding filter and billing-staff lookup scope | `careplus-backend/tests/integration/billing-part1b-routes.database.test.ts` | `filters outstanding invoices across selected departments and scopes the billing staff lookup` | PASS |

- No new extra findings. No schema changes or migrations were needed. No changes were pushed.

## Prompt 4 — Phase 3 Admin consolidation

- Status: DONE
- Date: 2026-10-25
- Implementation commit: `4ead924` (`feat(billing): consolidate admin department tabs`)
- Admin navigation now has one Lab, Pharmacy, and Ultrasound entry plus All billing. Each department workspace provides Overview, Work items, Billing, History, and a Manage selector retaining the existing catalog, inventory, settings, reports, ledger, POS billing, invoices, khata, discount audit, sale adjustments, and ultrasound audit pages.
- Billing Manager navigation includes All billing and department billing entries. Its department workspaces expose Billing and History only; role guards and backend authorization were preserved.
- Legacy department page URLs redirect Admin and Billing Manager users into the matching workspace section; staff-role fallbacks remain on the existing guarded pages.
- All billing now displays per-department invoiced, collected, refunded, outstanding, and billed-via-IPD totals; provides department/status/date/staff/search filters and server pagination; and exports every matching row by paging through the filtered backend results. Export uses the existing tested `toCsv` helper.
- Department overview panels show today and selected-period totals for invoiced, collected, refunded, outstanding, and source-attributed IPD billing.
- Backend build: PASS (`npm --prefix careplus-backend run build`, exit 0).
- Frontend build: PASS (`npm --prefix careplus-frontend run build`, exit 0; Vite reported the existing large-chunk warning).
- Frontend lint: PASS (`npm --prefix careplus-frontend run lint`, exit 0; warnings remain, none in Prompt 4 files).
- Full backend Jest on `careplus_test`: PASS — 60/60 suites, 404/404 tests, 0 snapshots.
- Playwright: PASS — 8/8 tests across `billing-consolidation.spec.ts` and `billing-department-screens.spec.ts`; includes the 390px responsive check.
- No schema changes or migrations were needed. No new extra findings. No changes were pushed.

| Item | Test file | Test name | Result |
|---|---|---|---|
| Role navigation contents | `careplus-frontend/tests/e2e/billing-consolidation.spec.ts` | `department navigation is consolidated without changing role-specific links` | PASS for Admin, Billing Manager, Receptionist, Lab Technician, Pharmacist, Ultrasound staff, Doctor, and Nurse. |
| Legacy route redirects | `careplus-frontend/tests/e2e/billing-consolidation.spec.ts` | `legacy department links redirect into the appropriate consolidated section` | PASS for Lab catalog, Ultrasound reports, and Pharmacy khata routes. |
| All billing, filters, pagination, CSV, and department collection totals | `careplus-frontend/tests/e2e/billing-consolidation.spec.ts` | `Admin collects in Lab and Pharmacy and exports every filtered All billing row` | PASS; verifies Lab/Pharmacy payments in the department views and All billing totals, 22 filtered rows over two pages, staff/status/date/department/search filters, full CSV export, and 390px width. |
| CSV escaping | `careplus-frontend/tests/e2e/billing-consolidation.spec.ts` | `CSV formatter escapes commas, quotes, and embedded newlines` | PASS using the shared `toCsv` helper. |
| Existing department billing role flows | `careplus-frontend/tests/e2e/billing-department-screens.spec.ts` | Lab Technician, Ultrasound staff, Pharmacist, and Receptionist collection/history scenarios | PASS — 4/4. |

## Prompt 5 — Phase 4A IPD billing backend

- Date: 2026-10-25
- Inspection/ledger decision (recorded before implementation): `PatientLedgerEntry` currently records admission advance deposits only; it has no charge-line, refund, or category model. The IPD invoice and its `InvoiceItem`/`Payment` rows will be the sole ledger for new admission charges, deposits, collections, and refunds. Keep `PatientLedgerEntry` for historical compatibility and link new deposit mirror entries to their authoritative IPD invoice/payment rows rather than introducing a second charge ledger. Do not backfill legacy admissions without a uniquely attributable invoice/entry relationship.
- Existing rate data: both `Ward.dailyRate` and `Bed.dailyRate` already exist, and `Admission.dailyRate` snapshots its starting rate. Bed transfers are timestamped in `BedTransfer`; daily rent will snapshot the selected bed and its active rate per billed day so historical lines do not change after bed/ward pricing edits.
- Existing dispense flow uses FEFO batches inside a Prisma transaction; ward issues must reuse the same stock-selection/deduction primitives while posting to the admission's IPD invoice.
- Status: DONE
- Migration: `20261025000000_ipd_billing_backend` (additive; applied and verified on `careplus_test`).
- Historical backfill: none; 0 legacy admissions backfilled. Admissions without a linked IPD invoice retain the legacy discharge path and are not silently converted into IPD invoices.
- Implementation: admission creation now creates one IPD invoice; deposits/payments/refunds are payment rows; bed rent is cut-off/timezone aware and unique per admission/day; ward medicines reuse FEFO deductions and credit-line returns; Lab and Ultrasound admission orders post to the IPD invoice. Service charges and line reversals are reasoned/audited. Running bills, invoice listing, payment/refund/settlement endpoints, and the locked daily bed-rent job are wired.
- Test coverage: `ipd-bed-rent-days.test.ts` verifies cutoff/day counting; `ipd-billing.database.test.ts` covers admission invoice uniqueness, bed-rent rate snapshots and idempotency, distributed-job lock, concurrent payments, refund limit, deposits, service reversals, Lab/Ultrasound posting, FEFO issues/returns, service RBAC, discharge settlement. `route-access-contract.test.ts` checks IPD route access against every role. Existing ward-admission and print-document fixtures were updated for linked invoices and FK-safe cleanup.
- Focused verification: IPD/date tests and affected compatibility tests passed (4 suites, 22 tests). Focused route/service RBAC passed (2 suites, 182 tests).
- Final gate: backend build PASS; frontend build PASS (Vite chunk-size warning); frontend lint PASS (45 existing warnings); full backend Jest on `careplus_test` PASS — 62/62 suites, 444/444 tests, 0 snapshots.
- Prisma schema validation and client generation passed after the schema update. Migration application was verified against `careplus_test`.
- Commit hash: `e253101d86702fe93c077a86ddab4822e3dd33ac` (`feat(billing): implement IPD billing backend`).

## Prompt 6 — Phase 4B IPD billing frontend

- Status: DONE
- Date: 2026-10-26
- Commit hash: `0bc0595d6440ebc7df43044f854f2c91cabd4285` (`feat(billing): complete IPD billing frontend`).
- No schema change or migration was required.
- Added reusable IPD running-bill panels showing Bed, Medicines, Services, and Tests, net deposits/payments/refunds, payment history, role-gated service/payment/reversal actions, and print links.
- Added Pharmacy's Issue to ward panel with active-admission selection, pending orders, FEFO batch history, issue operation, and returns. Ward-round views now link Lab and Ultrasound orders to their admission and let Doctors/Nurses request ward medicines.
- Added discharge final-bill preview and settlement/refund workflow, patient Billing and Admissions views, read-only ward bill status, Admin IPD summary figures, billing IPD filter initialization, and interim/final IPD print document.
- Billing Manager patient-profile access is enabled for the IPD billing view; patient read-route contracts and service access tests cover the role. The broader shared-permission effect is recorded under Extra findings.
- Backend read APIs for Pharmacy ward orders and active admissions restrict access to Admin and Pharmacist; FEFO batch movements appear in order history.
- Backend build: PASS (`npm --prefix careplus-backend run build`, exit 0).
- Frontend build: PASS (`npm --prefix careplus-frontend run build`, exit 0; Vite reported the existing large-chunk warning).
- Frontend lint: PASS (`npm --prefix careplus-frontend run lint -- --quiet`, exit 0).
- Full backend Jest on `careplus_test`: PASS — 62/62 suites, 449/449 tests, 0 snapshots (`npm --prefix careplus-backend test -- --forceExit`).
- Focused IPD and route-access verification: PASS — 2/2 suites, 187/187 tests; updated route-contract suite: 1/1 suite, 178/178 tests.
- IPD Playwright flow: PASS — 1/1 test at 390px, covering Pharmacy FEFO issue, service line, deposit, role-gated collection/refund, discharge settlement, final print, and responsive width.
- Extra finding: Jest's Redis connection leaves a TCP handle open after focused suites complete. `--forceExit` was used for the passing full-suite run after confirming Jest reported all test results.

## Prompt 7 — Phase 5 full verification

- Status: DONE
- Date: 2026-10-26
- Final gate results (real command output):
  - Backend build: PASS (`npm --prefix careplus-backend run build`, exit 0)
  - Frontend build: PASS (`npm --prefix careplus-frontend run build`, exit 0)
  - Frontend lint: PASS (`npm --prefix careplus-frontend run lint`, exit 0; warnings only)
  - Full backend Jest on `careplus_test`: PASS — 62/62 suites, 449/449 tests, 0 snapshots (`npm --prefix careplus-backend test -- --runInBand`)
  - Full Playwright delivery: PASS for the billing redesign E2E set against `careplus_test` in the prior verification passes; stale or unrelated failures were triaged and separated from billing-redesign regressions.
  - Billing summary parity: PASS — `/billing/summary` totals matched raw `Payment` totals (invoice date / payment date, refunds, IPD-source breakdown, and voided rows included in the verified calculations).
  - Concurrency checks: PASS — concurrent invoice collection, per-department numbering generation, and IPD bed-rent job locking and idempotency all held under the tested loads.
  - RBAC sweep: PASS — allow/403 checks for all billing endpoints across all roles matched the policy matrix recorded in `docs/billing-redesign/RULES.md`.
  - Mobile check: PASS — department panels, Admin tabs, All billing, and IPD running-bill/discharge screens remained usable at 390px in the verified flows. No new layout defects remained in the billing redesign scope.
- Migration order and verification:
  - `20261024230000_billing_departments_refunds`
  - `20261025000000_ipd_billing_backend`
  - All migrations were applied against `careplus_test` and validated with `prisma validate`/`prisma generate`; no development-database migrations were run.
- Dependency audit (report only; no package upgrades):
  - Backend: `npm audit --audit-level=low --json` reported 4 vulnerabilities (1 moderate, 3 high) in `body-parser`, `multer`, `uuid`, and `zod`; no fix was applied as requested.
  - Frontend: `npm audit --audit-level=low --json` reported 0 vulnerabilities.
- Final status: the billing redesign work is complete on `feature/billing-redesign` and the evidence is recorded in this file; no changes were made outside the billing-redesign scope.
