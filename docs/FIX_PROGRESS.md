# Fix Progress

## Item 0 - Earlier fixes verification

Focused code review found these items already present:

- A shared backend record-authorization helper is used for doctor-owned surgery and admission records; surgeon and attending-doctor defaults already resolve to the signed-in doctor, while administrators can select another doctor.
- OT scheduling already checked room/surgeon overlap and returned structured validation/conflict errors. The frontend already passed server error messages to toasts.
- Ward status transitions already supported Cleaning to Available for administrator/nurse roles, and occupied bed data already included patient and doctor names.
- Prescription printing already included structured dose/frequency/duration, blood pressure, patient allergies, hospital address, doctor registration details, and a verification QR code. Vitals had realistic range validation.
- Consultation already had a skeleton, patient-name heading, autosaved drafts, and bottom padding for its sticky action bar.
- Appointment status values were shared with the backend; approve/reject actions, real doctor names, clickable doctor KPI cards, and an appointments doctor-filter guard were present.

Fixed during verification:

- Removed the Emergency admission default and now require an explicit admission type.
- Changed advance deposits to allow PKR 0 while rejecting negative or over-PKR-10,000,000 amounts; added an in-flight guard and spinner to prevent duplicate admission submits.
- Added patient, attending doctor, and days-admitted details to occupied bed cards.
- Replaced native consultation completion confirmation with the app confirmation dialog and removed the doctor-facing All doctors filter from the OPD queue.
- Extended error toast visibility to six seconds and replaced generic HTTP fallback errors with status-specific messages.

Focused verification: backend ward admission, consultation-vitals, and prescription unit suites passed (3 suites, 18 tests). The final consultation E2E pass also succeeded for the print + autosave workflow (2 tests).

## Item 7 - Schedule Surgery

Implemented:

- Added backward-compatible surgery metadata fields and a matching Prisma migration (priority, anesthesia, assistant surgeon, notes); aligned the assistant-surgeon index in the Prisma schema.
- Added quarter-hour time slots and Pakistan-time validation (08:00-20:00 unless Emergency), past-date rejection, live shared room/surgeon/patient conflict detection, patient double-booking protection, and saved pre-op checklist fields.
- Added procedure catalog/custom entry, priority, anesthesia, optional assistant, cancellation reason, and the Pre-op -> In Progress -> Recovery -> Completed actions.
- Extended OT integration coverage for past dates and patient double-booking; revised the OT Playwright workflow to schedule, find in week view, and complete a surgery.

Backend and frontend builds passed. Integration tests initially ran before the requested migration reset and failed because `careplus_test` had not been migrated. The focused run also uncovered and repaired malformed test-only authorization lines and Prisma query typings. Final database-backed and E2E verification remains pending.

## Item 8 - Cross-app consistency and polish

Implemented:

- Added the shared Asia/Karachi formatter for 12-hour times and `DD Mon YYYY` dates, replaced date/time duplicates in dashboard/public appointment flows, and added shared time-of-day parsing for a correctly ordered schedule timeline.
- Added status-specific API error fallbacks (preserving server messages) and six-second toast visibility.
- Added the access-token expiry warning with a working “Stay signed in” action.
- Verified seed data contains Dr. Fatima Sheikh and added realistic Ayesha Malik and Nadia Iqbal fixtures, a same-day appointment for the cardiology doctor, and a verified low haemoglobin result so the doctor dashboard has useful first-login content.
- Verified audit writes already cover consultation completion, prescription signing, bed status/admission, and surgery scheduling/cancellation.

Still needs broader verification: contrast/focus/icon-label audit across the whole app; responsive checks at 1366x768, 1024px, and 390px for all named screens; complete seed presentation review and browser-level checks. No `Request failed` generic string remains in frontend source. The backend lint script is currently unusable because ESLint is not installed or declared in the backend package.

## Item 9 - Doctor productivity features

Implemented:

- 9a: Per-doctor template create/list/update/delete endpoints, ownership checks, audit logging, and consultation UI to save/update/apply/delete structured prescriptions.
- 9b: Bundled common ICD-10 JSON catalog, search helper/API, and consultation diagnosis-code persistence/autocomplete.
- 9c: Local drug-interaction table and warning confirmation before signing; allergy-match override confirmation remains logged by the backend audit trail.
- 9d: Last-five-visit BP/pulse/weight/SpO2 sparklines and BMI calculation when height is entered.
- 9e: Generated prescription PDF with hospital/doctor/patient/medication/vitals/allergy details and a QR verification URL; authenticated upload creates a seven-day, high-entropy, hash-stored share link, and WhatsApp opens with the PDF URL.
- 9f: Doctor dashboard schedule timeline, assigned active admissions, abnormal lab alerts, and existing “Call next patient” action.

Focused ICD-10 and interaction unit tests passed (2 suites, 4 tests). Frontend production build passed after the UI additions. Prisma sharing migration and the full integration/E2E paths still require final verification.

## Verification caveats

- The worktree contained substantial pre-existing, uncommitted edits before this task. Those unrelated edits have been preserved and must not be accidentally staged or reverted.
- PostgreSQL and Redis are reachable locally; the configured development database is `careplus`, and the Jest/Playwright test database is `careplus_test`. Migration status showed 12 unapplied migrations, including this task's migrations. Reset only the dedicated test database for validation.
- Frontend build passed twice during implementation; backend build passed after Prisma client regeneration. Focused unit tests passed (2 suites, 4 tests). Focused integration tests failed against the unmigrated database and were stopped after Jest held open connections; rerun after reset.
- Frontend lint exits nonzero on existing warnings; backend lint exits because the backend package's `eslint` executable is missing.
- Full database reset/seed, full backend suite, final build/lint, and complete Playwright verification remain pending.

## Ward Admit Patient 403 - 2026-10-04

Status: backend admission and doctor-default fixes implemented; doctor-facing admission E2E blocked by a patient-search full-name limitation (see verification).

Root cause:

- The modal previously submitted the first doctor in the loaded list when its doctor state initialized before the logged-in doctor's profile was available. In the reported session, this selected Dr. Ahmed Khan while the actor was Dr. Fatima Sheikh. The admission service passed the submitted doctor-profile ID to the shared ownership check, which compared it with the actor's doctor-profile ID and returned 403. The prior generic error obscured the mismatch. See `careplus-frontend/src/dashboard/pages/ward/AdmitPatientModal.tsx` and `careplus-backend/src/common/utils/recordAuthorization.ts`.
- OT scheduling used the same doctor-profile ownership pattern. Its direct ownership check is now routed through that shared helper with the OT-specific denial reason. The focused backend regression test confirms self-scheduling succeeds and scheduling as another surgeon returns 403.
- The added UI E2E attempts exposed a separate fixture/search blocker: `PatientSearchSelect` sends the entire entered full name as one search value, but `patients.service.ts` compares that entire string independently against first name and last name. A doctor-visible "Nadia Iqbal" therefore returns no result when entered as a full name. After two different fixture attempts, this E2E subtask is marked blocked per the work rules; no failing spec was retained.

Implemented:

- Added a shared doctor patient-access predicate and admission authorization: doctors may admit under their own attending profile or for patients they already own; administrators, nurses, receptionists, and other explicitly authorized non-doctor roles are not constrained by doctor ownership. The ward route now admits nurses.
- The doctor modal derives Attending Doctor directly from the logged-in doctor's profile; admin/nurse/receptionist selection remains available. Roles without admission permission see a disabled action with an explanatory title.
- Made bed claiming conditional and transactional. Concurrent admits to one bed can produce only one admission; the loser gets 409 `Bed <number> is no longer available`. Doctor ownership failures return 403 `Doctors can only admit patients under their own name`.
- Admission type is required with no silent default; added Transfer and Day care enum values and a forward-only Prisma migration. The UI keeps server error messages in the existing six-second toast and preserves form values after errors.
- Deposit is an integer from PKR 0 through PKR 1,000,000 on both client and server. Added optional expected stay (1-365 days) and a daily-rate estimate. Occupied cards include admission date, and the existing authorized Cleaning -> Available action remains connected to the audited bed-status endpoint.

Focused verification:

- Backend typecheck: passed.
- Frontend typecheck: passed.
- `tests/unit/ward-admission-validation.test.ts`: 1 suite passed, 9 tests passed, including nurse admission 201, doctor authorization 403 with exact message, occupied bed 409, concurrent single-winner admission, invalid deposit 422 with field name, and OT self/other-surgeon authorization.
- Doctor ward-admit Playwright spec: attempted twice; each attempt timed out at the patient picker because full-name search returned no results. 0 E2E tests passed, 1 failed per attempt. The patient-search issue prevented reaching the admission request; no admission was created.
- Applied the admission enum migration to `careplus_test` only. PostgreSQL and Redis were already listening; port 5173 was free before Playwright started its test servers. No full suite, lint, or build was run.

Manual checks:

1. Sign in as Dr. Fatima Sheikh, open Ward Board > Admit Patient, verify Attending Doctor is Dr. Fatima Sheikh, explicitly choose an admission type, enter a zero or positive whole-number deposit, then admit a patient and verify the occupied card and counters.
2. Retry a bed after another user occupies it; verify the 409 bed-specific message and that the modal values remain.
3. Sign in as admin/nurse and verify the attending doctor remains selectable. Confirm unsupported roles cannot open admission.
4. To complete the blocked UI E2E, fix full-name patient matching in the existing patient search service and rerun the ward-admit spec.
