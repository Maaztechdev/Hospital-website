- Work only on branch `feature/billing-redesign`. Commit at the end of each prompt with a clear message. Never push. Never touch `main`.
- Use only the `careplus_test` database. Never read or print `.env` values. Never run migrations against the development database.
- Migrations are additive only (no drops, no renames, no editing already-applied migrations). Keep `prisma/schema.prisma` in sync, run `prisma validate` and `prisma generate` after each schema change, and prove each migration by applying it to the test DB.
- Report real command output only. No claims without output.
- Do not change unrelated behavior. Record extra defects under "Extra findings" in `PROGRESS.md`.
- Existing flows (Pharmacy POS, Lab, Ultrasound, Reception billing) and existing tests must keep working.
- Money uses `Prisma.Decimal` with the shared helper in `src/common/utils/money.ts`.
- Use the existing toast and error-handling patterns. No silent catches. UI must work on mobile widths.
- GATE at the end of every prompt: backend build, frontend build, frontend lint, full backend Jest suite on `careplus_test` must all pass (no new failures versus the baseline in `PROGRESS.md`). If a gate fails, fix it within the scope of the current prompt, up to 3 attempts. If still failing, write status BLOCKED with details into `PROGRESS.md` and STOP.
- BEFORE starting any prompt: read this file and `PROGRESS.md`. If the latest status in `PROGRESS.md` is BLOCKED, do nothing and STOP.
- Role names: use the real role enum names found in the code (Admin, Billing Manager, Receptionist, Lab Technician, Pharmacist, Ultrasound staff, Doctor, Nurse).

## DECISIONS (final)

- Payments can be collected by the department's own staff and by the Receptionist.
- Refund and void: ADMIN and BILLING_MANAGER only (Billing Manager may also void Lab invoices).
- Receptionist has no refund or void.
- Billing Manager cannot change system settings.
- Admin gets ONE tab per department (Lab, Pharmacy, Ultrasound), each with Overview, Work items, Billing, History, plus existing management pages kept inside the tab. Plus an "All billing" view.
- Invoice departments: RECEPTION, LAB, PHARMACY, ULTRASOUND, IPD. Per-department, per-year numbering (for example LAB-2026-000123). Old numbers unchanged.
- Collected revenue is by payment date; invoiced revenue by invoice date.
- IPD: one invoice per admission, open until discharge. Bed rent is counted per night with a configurable cut-off time (default 12:00 local time): billed days = 1 + number of cut-off instants that fall after admission and at or before discharge (or now), minimum 1. Ward medicines are issued by Pharmacy to the ward and post automatically to the IPD invoice. Lab and Ultrasound ordered from a ward post to the IPD invoice (no separate OPD invoice).
