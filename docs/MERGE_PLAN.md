# CarePlus Merge Plan: integration/pre-merge & billing-discharge-workflow

## 1. Overview and Recommended Merge Strategy
- **Base Branch**: `integration/pre-merge` (contains verified stabilization fixes, bed rent 9-case Rule A compliance, role-runtime security hardening, clean lint/build, and comprehensive test suite pass).
- **Incoming Branch**: `billing-discharge-workflow` (contains the multi-department discharge clearance gate and discharge clearance UI).
- **Recommended Strategy**: 
  1. Use `integration/pre-merge` as the merge target base.
  2. Cherry-pick or merge `billing-discharge-workflow` onto `integration/pre-merge`.
  3. Resolve the 5 intersecting conflicts by hand using the resolution notes below.
  4. Ensure migration sorting order and re-verify full test suites before advancing.

---

## 2. Hand-Resolution Notes by Conflicted File

### A. `careplus-backend/src/modules/ipd/ipdBilling.service.ts`
- **Conflict Summary**:
  - `integration/pre-merge` uses standard Prisma checks (`admission.status !== "ACTIVE"`, `updateIpdInvoiceTotals`), and transactional reversal helper `reverseIpdLineInTransaction`.
  - `billing-discharge-workflow` introduces discharge clearance locks (`lockAdmissionInTransaction`, `assertAdmissionChargeAllowed`, `lockIpdInvoiceInTransaction`), `updateInvoiceTotals(..., admission.status === "DISCHARGE_PENDING" ? "FINALIZED" : undefined)`, and `revokeBillingClearanceIfNeeded`.
- **Resolution**:
  - Adopt the discharge clearance validation (`assertAdmissionChargeAllowed`, `revokeBillingClearanceIfNeeded`) from `billing-discharge-workflow`.
  - Retain the clean bed-rent accrual calculation and transaction safety from `integration/pre-merge`.

### B. `careplus-backend/src/modules/lab/lab.service.ts`
- **Conflict Summary**:
  - `integration/pre-merge` fixed syntax errors, resolved decimal typing, deduplicated legacy method wrappers at the bottom of the service, and correctly gates ledger entries.
  - `billing-discharge-workflow` used `invoice.balanceAmount.gt(0)` but duplicated obsolete method declarations.
- **Resolution**:
  - Accept `integration/pre-merge` as the structural base (removing duplicates and keeping syntax fixes).
  - Use Prisma Decimal methods (`balanceAmount.gt(0)`) where appropriate.

### C. `careplus-backend/src/modules/ultrasound/ultrasound.routes.ts`
- **Conflict Summary**:
  - `integration/pre-merge` defined strict role guards (`viewRoles` vs `queueRoles`) matching the route access contract tests (`route-access-contract.test.ts`).
  - `billing-discharge-workflow` had conflicting role lists and extra status endpoints.
- **Resolution**:
  - Keep `integration/pre-merge`'s role guards:
    - `/orders`: `viewRoles` (`ADMIN`, `DOCTOR`, `RECEPTIONIST`, `RADIOLOGIST`, `ULTRASOUND_TECH`, `ULTRASOUND_TECHNICIAN`)
    - `/queue`: `queueRoles` (`ADMIN`, `DOCTOR`, `RADIOLOGIST`, `ULTRASOUND_TECH`, `ULTRASOUND_TECHNICIAN`)
    - Billing Manager accesses invoices through billing routes, not clinical queue routes.

### D. `careplus-backend/src/modules/wards/wards.service.ts`
- **Conflict Summary**:
  - `integration/pre-merge` includes transaction safety, bed state validation, and audit logging for admissions and transfers.
  - `billing-discharge-workflow` adds clearance checks before final discharge.
- **Resolution**:
  - Combine the clearance prerequisite check (`assertAdmissionClearedForDischarge`) into `dischargeAdmission` while retaining the audited transfer and bed allocation logic from `integration/pre-merge`.

### E. `careplus-frontend/src/print/PrintDocuments.tsx`
- **Conflict Summary**:
  - `integration/pre-merge` properly declared and scoped `PharmacyInvoicePrintPage` and `IpdBillPrintPage` components outside the router element and mapped their routes cleanly.
  - `billing-discharge-workflow` introduced route additions within an unclosed code block.
- **Resolution**:
  - Keep the clean component structure from `integration/pre-merge`.
  - Include both `<Route path="ipd-bill/:admissionId" element={<IpdBillPrintPage />} />` and `<Route path="pharmacy-invoice/:invoiceId" element={<PharmacyInvoicePrintPage />} />`.

---

## 3. Migration Ordering Proposal
- **Existing Latest Migration in `integration/pre-merge`**: `20261030000000_add_prescription_indexes`
- **Branch Migration to Merge**: `20261028000000_discharge_workflow`
- **Proposal**:
  - Rename `20261028000000_discharge_workflow` to `20261030010000_discharge_workflow`.
  - This ensures it deterministically sorts **after** `20261030000000_add_prescription_indexes` and avoids any migration timestamp collisions or out-of-order execution during `prisma migrate deploy`.
  - **Prerequisite Check**: Confirm that `20261028000000_discharge_workflow` has never been applied to any staging/production environment before renaming. (In the local clean test environment, `_prisma_migrations` has only applied up to `20261030000000_add_prescription_indexes`).

---

## 4. Post-Merge Re-Test Checklist
After completing the merge and applying the proposed hand resolutions:
1. **Migrations & Seed**:
   - `npx prisma migrate deploy` (apply 88 migrations total).
   - `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-database ...` (must return no difference).
   - `npm run prisma:seed` (seed completes without errors).
2. **Backend Unit & Integration Tests**:
   - `npm test -- --runInBand --forceExit` (all 68+ suites must pass).
   - `careplus-backend/tests/unit/ipd-bed-rent-days.test.ts` (9/9 pass in UTC and Asia/Karachi).
3. **Frontend Builds & E2E Suites**:
   - `npm run build` in `careplus-backend` and `careplus-frontend`.
   - `npx playwright test tests/e2e/smoke-roles.spec.ts` (all 61 pages pass with 0 4xx/5xx).
   - `npx playwright test tests/e2e/role-runtime.spec.ts` (5/5 pass).
   - `npx playwright test tests/e2e/ipd-billing-frontend.spec.ts` (pass).
   - `npx playwright test tests/e2e/ot-workflow.spec.ts` (pass).
   - `npx playwright test tests/e2e/lab-payment-gating.spec.ts` (4/4 pass).
   - `npx playwright test tests/e2e/responsive-clinical-pages.spec.ts` (3 consecutive passes).


---

## 5. Bed-Rent Accrual Impact & Safe Backfill Strategy
- **Rule A Definition**: Every admission receives 1 base day for admission plus 1 additional day for each daily cut-off instant (default 12:00 PKT) strictly after admission and at or before discharge/calculation end time.
- **Risk Assessment on Real / Existing Data**:
  - Admissions admitted in the morning (prior to 12:00 PKT) whose stay extended past 12:00 PKT on Day 1 were previously underbilled by 1 day because the old loop began checking cutoffs on Day 2.
  - Active admissions: Will automatically accrue the correct days upon their next scheduled nightly accrual or when running bills / discharge invoices are viewed.
  - Discharged & Finalized admissions: Modifying finalized IPD invoices directly poses accounting and legal risks (receipts already issued, patients settled).
- **Safe Backfill Approach**:
  1. Never mutate finalized invoices or settled payments automatically via migration scripts.
  2. Run an audit query (reporting counts and admission numbers only) to identify all finalized admissions admitted before 12:00 PKT whose invoice closed with fewer bed-rent days than Rule A dictates.
  3. Provide an administrative financial report to hospital billing management for review. If recovery or adjustment is warranted, hospital accountants issue standard adjustment/supplementary debit invoices manually per hospital policy.

---

## 6. Squash-Merge Command Sequence into `main` (Excluding .env Files)
To safely merge `integration/pre-merge` into `main` without bringing any historical `.env` or `.env.test` file modifications:

```bash
# 1. Switch to main branch
git checkout main

# 2. Perform a squash merge without committing
git merge --squash integration/pre-merge

# 3. Unstage any .env or credential file modifications from the index
git reset HEAD -- .env* careplus-backend/.env* careplus-frontend/.env*

# 4. Discard any local modifications to env files, reverting them to main's versions
git checkout -- .env* careplus-backend/.env* careplus-frontend/.env*

# 5. Clean any untracked env copies if created
git clean -fd -- .env* careplus-backend/.env* careplus-frontend/.env*

# 6. Commit the clean squash merge
git commit -m "feat: merge integration/pre-merge into main (stabilization, billing Rule A, and role runtime hardening)"
```
*(Do NOT run this sequence or push to remote until full approval is granted).*
