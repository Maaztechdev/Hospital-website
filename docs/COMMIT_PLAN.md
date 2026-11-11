# Git Commit Plan — Billing Redesign & Pre-Commit Verification

> **STATUS**: PROPOSAL ONLY — No commits or pushes have been made. Waiting for explicit user approval.

---

## 1. Overview & Strategy

The working tree contains comprehensive enhancements covering database migrations, multi-role security authorization, IPD/OT billing workflow reconciliation, notification/email mailers, prescription PDF generation, and automated E2E testing harnesses.

To preserve Git bisectability and maintain clean change attribution, changes are divided into **11 atomic, logically isolated commits**, ordered strictly by dependency (Database Schema → Core Services → Domain Workflows → UI & Frontend → Test Harness & Documentation).

---

## 2. Proposed Commit Order & Exact File Lists

### Commit 1: Database Schema, Migrations & Seed Safety
**Commit Message:** `fix(schema): synchronize migrations, indexes and enforce seed environment safety`
**Description:** Adds missing indexes on prescriptions, invoice items, and patient ledger entries; adds legacy `isActive` mapping on `Department` to achieve 0-diff parity with fresh database migrations; hardens seed scripts against production execution.
**Exact Files:**
- `careplus-backend/prisma/schema.prisma`
- `careplus-backend/prisma/seed.ts`
- `careplus-backend/scripts/seed-demo-presentation.ts`
- `careplus-backend/prisma/migrations/20261022230000_add_appointment_gender_and_slot_unique/migration.sql`
- `careplus-backend/prisma/migrations/20261023000000_make_prescription_consultation_optional/migration.sql`
- `careplus-backend/prisma/migrations/20261023120000_exclude_terminal_appointments_from_slot_constraint/migration.sql`
- `careplus-backend/prisma/migrations/20261023130000_require_appointment_gender/migration.sql`
- `careplus-backend/prisma/migrations/20261023210000_add_ultrasound_finalized_status/migration.sql`
- `careplus-backend/prisma/migrations/20261028190000_add_surgery_admission_id/migration.sql`
- `careplus-backend/prisma/migrations/20261030000000_add_prescription_indexes/migration.sql`

---

### Commit 2: Dynamic Role Permissions & Authorization Infrastructure
**Commit Message:** `feat(auth): dynamic role permissions service and fine-grained authorization middleware`
**Description:** Introduces dynamic role-permissions service with in-memory caching and Redis invalidation; enhances `requireRole` and record authorization across backend and frontend.
**Exact Files:**
- `careplus-backend/src/common/services/rolePermissions.service.ts`
- `careplus-backend/src/common/middleware/requireRole.ts`
- `careplus-backend/src/common/permissions.ts`
- `careplus-frontend/src/dashboard/permissions.ts`
- `careplus-frontend/src/dashboard/types.ts`
- `careplus-backend/tests/integration/role-permissions-authorization.database.test.ts`
- `careplus-backend/tests/integration/record-authorization.database.test.ts`

---

### Commit 3: IPD Billing, OT Surgery Linkage & Settle Workflows
**Commit Message:** `feat(ipd): link OT surgeries to IPD admissions, running bills, and refund settlements`
**Description:** Connects Operation Theatre surgeries directly to patient IPD admissions, adds running bill line items, deposit tracking, discharge settlement validation, and money utility functions.
**Exact Files:**
- `careplus-backend/src/modules/ipd/ipdBilling.service.ts`
- `careplus-backend/src/modules/billing/billing.service.ts`
- `careplus-backend/src/modules/ot/ot.routes.ts`
- `careplus-backend/src/modules/wards/wards.service.ts`
- `careplus-backend/src/common/utils/money.ts`
- `careplus-backend/tests/integration/surgery-ipd-billing.database.test.ts`
- `careplus-backend/tests/integration/ipd-billing.database.test.ts`
- `careplus-backend/tests/integration/billing-part1b-routes.database.test.ts`
- `careplus-backend/tests/integration/billing-part1b.database.test.ts`
- `careplus-backend/tests/unit/ipd-bed-rent-days.test.ts`

---

### Commit 4: Departmental Revenue & Refund Reconciliation
**Commit Message:** `fix(reports): reconcile departmental refunds across pharmacy, lab, and IPD billing`
**Description:** Deducts refunds correctly from daily and departmental financial summary reports.
**Exact Files:**
- `careplus-backend/src/modules/reports/reports.routes.ts`
- `careplus-backend/tests/integration/revenue-reports-refunds.database.test.ts`

---

### Commit 5: Notification Templates & Password Reset Mailer Service
**Commit Message:** `feat(mailer): email notification template rendering and testable password reset mailer`
**Description:** Implements testable Nodemailer abstraction with test-harness hooks, robust template placeholder rendering, and password-reset delivery fallback.
**Exact Files:**
- `careplus-backend/src/common/utils/mailer.ts`
- `careplus-backend/src/common/utils/notify.ts`
- `careplus-backend/src/modules/auth/auth.controller.ts`
- `careplus-backend/src/modules/auth/auth.service.ts`
- `careplus-backend/src/modules/auth/auth.routes.ts`
- `careplus-backend/src/modules/auth/auth.validators.ts`
- `careplus-backend/src/modules/auth/token.utils.ts`
- `careplus-backend/src/common/constants/`
- `careplus-backend/tests/unit/password-reset-mailer.test.ts`
- `careplus-backend/tests/integration/notification-template-renderer.database.test.ts`

---

### Commit 6: Prescription PDF Generation & Consultation Vitals
**Commit Message:** `feat(prescriptions): PDF pad generation service and clinical consultation vitals`
**Description:** Implements pdfkit-based prescription download/streaming service and enforces vital signs validation on consultation workflows.
**Exact Files:**
- `careplus-backend/src/modules/prescriptions/prescriptionPdf.service.ts`
- `careplus-backend/src/modules/prescriptions/prescriptions.routes.ts`
- `careplus-backend/src/modules/prescriptions/prescriptions.service.ts`
- `careplus-backend/src/modules/prescriptions/prescriptions.validators.ts`
- `careplus-backend/src/modules/consultations/consultations.routes.ts`
- `careplus-backend/src/modules/consultations/consultations.service.ts`
- `careplus-backend/src/modules/consultations/consultations.validators.ts`
- `careplus-backend/tests/integration/prescription-pdf-generation.database.test.ts`
- `careplus-backend/tests/integration/consultation-vitals-critical.test.ts`

---

### Commit 7: Ultrasound & Lab Diagnostic Workflow Hardening
**Commit Message:** `fix(diagnostics): harden ultrasound lifecycle states and lab verification rules`
**Description:** Adds audit logging, turnaround calculation, STAT priority normalization, and credit ledger safeguards.
**Exact Files:**
- `careplus-backend/src/modules/ultrasound/ultrasound.routes.ts`
- `careplus-backend/src/modules/ultrasound/ultrasound.service.ts`
- `careplus-backend/src/modules/ultrasound/ultrasoundWorkflow.ts`
- `careplus-backend/src/modules/lab/lab.service.ts`
- `careplus-backend/src/modules/lab/lab.workflowUtils.ts`
- `careplus-backend/src/modules/lab/labLedger.service.ts`
- `careplus-backend/tests/integration/ultrasound-reporting.test.ts`
- `careplus-backend/tests/unit/ultrasound-validators.test.ts`

---

### Commit 8: Appointments, OPD Queue & Clinical History Services
**Commit Message:** `fix(appointments): handle terminal appointment exclusion and clinical summaries`
**Description:** Excludes cancelled appointments from unique slot constraints, adds call-next OPD queue capabilities, and enhances patient clinical profile history.
**Exact Files:**
- `careplus-backend/src/modules/appointments/appointments.routes.ts`
- `careplus-backend/src/modules/appointments/appointments.service.ts`
- `careplus-backend/src/modules/appointments/appointments.validators.ts`
- `careplus-backend/src/modules/patients/patients.service.ts`
- `careplus-backend/src/modules/pharmacy/pharmacy.service.ts`
- `careplus-backend/src/modules/backup/backup.routes.ts`
- `careplus-backend/src/modules/backup/backup.service.ts`
- `careplus-backend/src/modules/settings/settings.routes.ts`
- `careplus-backend/tests/integration/appointment-date-roundtrip.test.ts`
- `careplus-backend/tests/integration/doctor-queue-actions.database.test.ts`
- `careplus-backend/tests/integration/opd-call-next.database.test.ts`
- `careplus-backend/tests/integration/patient-clinical-summary.database.test.ts`
- `careplus-backend/tests/integration/patients-list-regression.test.ts`
- `careplus-backend/tests/integration/pharmacy-prescription-dispense.database.test.ts`
- `careplus-backend/tests/unit/backup-service.test.ts`

---

### Commit 9: Frontend Billing Manager Workspace & Multi-Role UI Guards
**Commit Message:** `feat(frontend): billing manager navigation, role routes, and preview port auto-detection`
**Description:** Adds Billing Manager sidebar navigation and route bindings, maps specialized roles in login handler, auto-detects E2E test backend on port 5180, and aligns UI permissions.
**Exact Files:**
- `careplus-frontend/src/lib/api.ts`
- `careplus-frontend/src/dashboard/nav.ts`
- `careplus-frontend/src/dashboard/pages/Login.tsx`
- `careplus-frontend/src/dashboard/DashboardApp.tsx`
- `careplus-frontend/src/dashboard/components/Header.tsx`
- `careplus-frontend/src/dashboard/components/Layout.tsx`
- `careplus-frontend/src/dashboard/components/Sidebar.tsx`
- `careplus-frontend/src/dashboard/components/StatusBadge.tsx`
- `careplus-frontend/src/dashboard/store/DashboardContext.tsx`
- `careplus-frontend/src/dashboard/pages/admin/AdminDashboard.tsx`
- `careplus-frontend/src/dashboard/pages/admin/BackupPage.tsx`
- `careplus-frontend/src/dashboard/pages/appointments/AppointmentsPage.tsx`
- `careplus-frontend/src/dashboard/pages/appointments/OPDQueue.tsx`
- `careplus-frontend/src/dashboard/pages/billing/CreateInvoiceModal.tsx`
- `careplus-frontend/src/dashboard/pages/doctor/ConsultationRecord.tsx`
- `careplus-frontend/src/dashboard/pages/doctor/DoctorConsultation.tsx`
- `careplus-frontend/src/dashboard/pages/doctor/DoctorDashboard.tsx`
- `careplus-frontend/src/dashboard/pages/lab/LabOrderDetail.tsx`
- `careplus-frontend/src/dashboard/pages/lab/LabSettingsPage.tsx`
- `careplus-frontend/src/dashboard/pages/ot/SurgeryDetail.tsx`
- `careplus-frontend/src/dashboard/pages/patients/PatientProfile.tsx`
- `careplus-frontend/src/dashboard/pages/pharmacy/PharmacyBillingPage.tsx`
- `careplus-frontend/src/dashboard/pages/pharmacy/PharmacyDashboard.tsx`
- `careplus-frontend/src/dashboard/pages/pharmacy/PharmacyInvoicesPage.tsx`
- `careplus-frontend/src/dashboard/pages/pharmacy/PharmacyKhataPage.tsx`
- `careplus-frontend/src/dashboard/pages/pharmacy/PharmacyPrintDocuments.tsx`
- `careplus-frontend/src/dashboard/pages/settings/SettingsPage.tsx`
- `careplus-frontend/src/dashboard/pages/ultrasound/UltrasoundDashboard.tsx`
- `careplus-frontend/src/dashboard/pages/ultrasound/UltrasoundReportsPage.tsx`
- `careplus-frontend/src/dashboard/pages/ward/AdmitPatientModal.tsx`
- `careplus-frontend/src/dashboard/pages/ward/IpdRunningBill.tsx`
- `careplus-frontend/src/pages/Appointment.tsx`
- `careplus-frontend/src/print/PrintDocuments.tsx`
- `careplus-frontend/src/index.css`
- `careplus-frontend/package.json`
- `careplus-frontend/tsconfig.app.json`

---

### Commit 10: Tooling, ESLint Rules, E2E Test Suite & Deterministic Waits
**Commit Message:** `test(e2e): add specialized role runtime tests and stabilize smoke assertions`
**Description:** Updates ESLint ignore patterns and downgrades `@typescript-eslint/no-explicit-any` to warn so backend lint exits 0; adds deterministic DOM visibility assertions to `smoke-roles.spec.ts`; introduces `role-runtime.spec.ts` testing 5 specialized staff roles.
**Exact Files:**
- `careplus-backend/.eslintrc.cjs`
- `careplus-backend/jest.config.js`
- `careplus-backend/package.json`
- `careplus-backend/package-lock.json`
- `careplus-backend/src/app.ts`
- `careplus-backend/src/config/env.ts`
- `careplus-backend/src/common/middleware/rateLimiter.ts`
- `careplus-backend/tests/setupAfterEnv.ts`
- `careplus-backend/tests/globalTeardown.ts`
- `careplus-backend/tests/helpers/print-e2e-fixture.ts`
- `careplus-backend/tests/helpers/e2e-appointment-cleanup.ts`
- `careplus-backend/tests/tsconfig.json`
- `careplus-frontend/playwright.config.ts`
- `careplus-frontend/tests/e2e/smoke-roles.spec.ts`
- `careplus-frontend/tests/e2e/role-runtime.spec.ts`
- `careplus-frontend/tests/e2e/appointment-lifecycle.spec.ts`
- `careplus-frontend/tests/e2e/backup-restore-workflow.spec.ts`
- `careplus-frontend/tests/e2e/billing-round-trip.spec.ts`
- `careplus-frontend/tests/e2e/dashboard-hydration.spec.ts`
- `careplus-frontend/tests/e2e/doctor-admission-financial-steps.spec.ts`
- `careplus-frontend/tests/e2e/doctor-consultation.spec.ts`
- `careplus-frontend/tests/e2e/doctor-full-flow.spec.ts`
- `careplus-frontend/tests/e2e/ipd-billing-frontend.spec.ts`
- `careplus-frontend/tests/e2e/journey-a-consultation.spec.ts`
- `careplus-frontend/tests/e2e/journey-b-lab-pharmacy-billing.spec.ts`
- `careplus-frontend/tests/e2e/lab-round-trip.spec.ts`
- `careplus-frontend/tests/e2e/ot-workflow.spec.ts`
- `careplus-frontend/tests/e2e/patient-clinical-summary.spec.ts`
- `careplus-frontend/tests/e2e/patient-lifecycle.spec.ts`
- `careplus-frontend/tests/e2e/pharmacy-billing.spec.ts`
- `careplus-frontend/tests/e2e/pharmacy-inventory-batches.spec.ts`
- `careplus-frontend/tests/e2e/pharmacy-overview.spec.ts`
- `careplus-frontend/tests/e2e/pharmacy-prescription-dispense.spec.ts`
- `careplus-frontend/tests/e2e/prescription-round-trip.spec.ts`

---

### Commit 11: Reports, Documentation & Gitignore Test Artifact Cleanup
**Commit Message:** `docs: add sanitized audit reports and commit execution plan`
**Description:** Adds audit reports sanitized of secrets and records the pre-commit review plan; stages deletion of untracked test run traces from git cache.
**Exact Files:**
- `docs/billing-redesign/FINAL_REPORT.md`
- `AUDIT_REPORT.md`
- `docs/COMMIT_PLAN.md`
- Staged removal of cached test artifacts:
  - `careplus-frontend/test-results/.last-run.json`
  - `careplus-frontend/test-results/lab-round-trip-Lab-order-s-022d6-ckend-round-trip-and-reload-chromium/error-context.md`
  - `careplus-frontend/test-results/lab-round-trip-Lab-order-s-022d6-ckend-round-trip-and-reload-chromium/trace.zip`

---

## 3. Files Flagged as Unrelated or Risky

The following files exist in the workspace but should **NOT** be committed directly to main branches:

| File | Status / Risk | Recommendation |
| :--- | :--- | :--- |
| `careplus-backend/scripts/test-phase2-e2e.ts` | Scratch Phase 2 runner script | Keep locally / move to `scratch/` |
| `careplus-backend/scripts/test-phase3-e2e.ts` | Scratch Phase 3 runner script | Keep locally / move to `scratch/` |
| `careplus-backend/scripts/test-phase4-e2e.ts` | Scratch Phase 4 runner script | Keep locally / move to `scratch/` |
| `careplus-backend/scripts/test-phase5-e2e.ts` | Scratch Phase 5 runner script | Keep locally / move to `scratch/` |
| `careplus-backend/scripts/verify-fresh-db-diff.ts` | Temporary Prisma diff verification helper | Optional scratch script or retain for local dev |
| `OVERNIGHT_REPORT.md` | Local overnight progress report (already in `.gitignore`) | Retain locally; ignored by git |
