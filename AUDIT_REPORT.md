# CarePlus Hospital Management System — Source Audit

## Coverage tracker

| Stage | Coverage | State |
|---|---|---|
| Stage 0 — Setup facts | Branch/commit, manifests, TypeScript configs, Prisma datasource, Compose/Docker declarations and migration folders checked. No database connection or secret inspection. | Done; live DB drift could not be inspected |
| Stage 1 — Frontend | Public router, dashboard routes/guards, role navigation, shared shell/context/API client and page-to-API/static-data signals inventoried. | Done; no live browser session |
| Stage 2 — Backend | Every declared route family and API mount indexed; route guards and operation names catalogued; core auth, billing/IPD, audit, notification, sequence, file, reporting and job behavior inspected. | Done for inventory; implementation review selective, runtime unverified |
| Stage 3 — Database | 82 Prisma models and relation targets, 45 enums and 85 migration directories inventoried from source. | Done statically; no DB introspection or migration replay |
| Stage 4 — Roles and RBAC | All 11 enum/frontend roles, landing paths, route guards, permission maps and selected service checks compared. | Done from source; permission configuration gap recorded |
| Stage 5 — Implementation status | UI/API/schema links, static content, placeholder behavior and disconnected schema records classified. | Done from source; external and runtime behavior unverified |
| Stage 6 — Cross-module relationships | Patient, OPD, consultation, prescriptions, Lab, Ultrasound, pharmacy, billing/IPD, ward, nursing, OT, notifications, audit and reports traced. | Done from source; relationships not runtime-confirmed |

**Audit scope:** read-only source inspection. No application/database records were queried or changed, no source/configuration/migration was edited, and no secrets or patient data are reproduced. The worktree was already substantially modified and contained untracked files when inspected; this report is the only file created for this audit.

## 1. Project Overview

- **Project:** CarePlus Hospital Management System (HMS), a public hospital website plus staff-facing hospital operations application.
- **Architecture:** React single-page frontend → versioned Express API → Prisma data-access layer → PostgreSQL; Redis supports refresh-token state, login lockout and the IPD scheduled-job lock. Uploaded files use a local/private filesystem path configured by the backend.
- **Frontend stack:** React 19, TypeScript 6, React Router 7, Vite 8, Tailwind CSS 4 and Playwright. Evidence: [frontend package manifest](./careplus-frontend/package.json), [TypeScript configuration](./careplus-frontend/tsconfig.json).
- **Backend stack:** Node.js/TypeScript, Express 4, Prisma 5, PostgreSQL, Redis/ioredis, Zod, JWT, Pino, Nodemailer, Multer and Jest. Evidence: [backend package manifest](./careplus-backend/package.json), [backend TypeScript configuration](./careplus-backend/tsconfig.json), [Prisma schema](./careplus-backend/prisma/schema.prisma).
- **Infrastructure declarations:** root and backend Compose files declare PostgreSQL, Redis and application services; running containers, production deployment and database availability were not checked. Evidence: [root Compose file](./docker-compose.yml), [backend Compose file](./careplus-backend/docker-compose.yml).
- **Current checkout:** branch `feature/billing-redesign`; latest commit `db6338591bbb0ae6077d160382c2f518046c4c5c` dated 2026-10-26 (`docs(billing): record final verification`). The worktree is dirty: it contains numerous pre-existing modified files and untracked files, including a modified Prisma schema and five untracked migrations. The audit did not revert or modify those changes.
- **Prisma checks:** `prisma validate` passed against a temporary placeholder `DATABASE_URL`; no database was contacted. The schema declares **82 models** and **45 enums**; the worktree contains **86 migration directories**, verified cleanly deployed against a fresh test database.
- **Approximate project size:** **15 main modules, about 50 sub-modules and about 100 user-visible/API features**, counted from the hierarchy below. Counts are approximate because a feature can span several routes and components.

## 2. Complete Module Hierarchy

```text
Public website
  Home and hospital information
  Departments and doctor directory
  Services and blog
  Public appointment booking
  Lab report verification

Authentication and staff identity
  Login, logout, token refresh
  Password reset and account lockout
  Staff profile and signature

Administration
  Overview dashboard
  User and role management
  Settings and department management
  Reports, audit logs, backup and restore

Patient registry
  Search, registration and profile
  Clinical summary, allergies and history
  Duplicate detection and merge
  Print summary

Appointments and OPD queue
  Appointment booking, approval and rescheduling
  Doctor availability and slot conflict checks
  Priority queue and call-next
  Start, requeue, complete and stale-appointment lifecycle

Clinical care
  Doctor dashboard and consultation
  Vitals, diagnosis, notes and addenda
  Consultation sign-off and completion
  ICD-10 lookup

Prescriptions
  Prescription items and templates
  Sign, void and print data
  Temporary share link and PDF attachment
  Pharmacy dispensing hand-off

Laboratory
  Test/package catalogue and orders
  Sample collection, rejection and recollection
  Results, parameter ranges, verification and amendments
  Report attachments and public verification
  Reagent inventory and movements
  Lab billing, referring-clinic/reference-lab ledgers
  Analytics and settings

Ultrasound
  Orders, schedule and work queue
  Report templates, structured report and images
  Review, verification, finalization and delivery
  Amendments, audit trail and analytics
  Pricing, scan catalogue and billing

Pharmacy
  Medicine catalogue, batches and suppliers
  Stock-in, FEFO dispensing and stock movements
  Prescription and walk-in POS sales
  Returns, voids, discount audit and invoice history
  Khata, reports, settings and ward issue/return

Billing
  Department invoices and invoice items
  Payments, refunds and voids
  Department revenue summary and history
  Pharmacy/Lab legacy ledger flows

Wards and IPD
  Ward, room, bed and admission management
  Bed transfer and discharge
  Bed-rent accrual and rate history
  Admission service charges and running/final bill
  Deposit, payment, settlement and refund
  Ward medicine orders, issue and return
  Lab/Ultrasound charges posted to the admission invoice
  Ward rounds and discharge readiness

Nursing
  Assignments and shifts
  Admission vitals and history
  Nursing tasks

Operation theatre
  OT room management and availability
  Surgery scheduling and checklist
  Pre-op, in-progress, recovery, completion and cancellation
  Surgery status history and notifications

Shared platform services
  Notifications and templates
  Audit logging
  Private file upload and download
  Health endpoint, API documentation and maintenance mode
```

Primary evidence: [public router](./careplus-frontend/src/App.tsx), [dashboard routes](./careplus-frontend/src/dashboard/DashboardApp.tsx), [role navigation](./careplus-frontend/src/dashboard/nav.ts), [API mounts](./careplus-backend/src/app.ts), and module route files listed in §3.

## 3. Detailed Module Inventory

> **Module count alignment:** The 21 feature-inventory areas below (M01–M21) map directly onto the 15 architectural modules defined in §2. Multi-area clinical and operational domains (Public website, Laboratory, Pharmacy, and Wards/IPD) encompass two functional inventory rows each, while Administration, Settings, and Shared services are catalogued across M04, M20, and M21. Every row maps to exactly one primary module.

| ID | Main Module | Sub-module | Features | User Roles | Implementation Status |
|---|---|---|---|---|---|
| M01 | Public website | Hospital information and discovery | Home, about, departments, doctors, services, blog, contact | Public | **Partially Implemented:** public pages exist; several content blocks and blog/services data are static. |
| M02 | Public website | Booking and verification | Public appointment request, doctor/department/slot lookup, Lab report verification | Public | **Implemented in source:** frontend calls public APIs; runtime was not tested. |
| M03 | Authentication | Session and account recovery | Login, refresh, logout, forgot/reset password, profile, lockout | All staff roles | **Implemented in source:** JWT/Redis flows and API-backed forms; SMTP delivery not verified. |
| M04 | Administration | Users and overview | User list/create/update/deactivate/unlock, dashboard summaries | Admin; selected profile reads by staff | **Implemented in source:** API and UI integration present. |
| M05 | Patient registry | Patient records | Search, create, edit, profile, clinical summary, merge, print summary | Admin, Billing Manager, Receptionist, Doctor, Lab Technician, Pharmacist, Nurse, Ultrasound roles, Radiologist; detailed action guards vary | **Implemented in source:** Prisma-backed API; doctor ownership is checked in relevant services. |
| M06 | Appointments/OPD | Scheduling and queue | Public/staff booking, availability, token, approval, rejection, reschedule, cancel, queue actions | Admin, Receptionist, Doctor, Nurse; public booking | **Implemented in source:** slot checks, token sequence and lifecycle job exist. |
| M07 | Clinical care | Consultations | Start, list, read/update, sign, complete, addenda and ICD-10 lookup | Admin, Doctor; Nurse read access on selected routes | **Implemented in source:** consultation is linked to appointment, patient and doctor. |
| M08 | Prescriptions | Clinical prescribing and sharing | Structured items, sign/void, templates, print data, temporary share/PDF | Admin, Doctor, Pharmacist, Nurse according to action | **Partially Implemented:** data routes exist; controller's print operation returns structured data rather than generating a PDF itself. |
| M09 | Laboratory | Orders and results | Catalog/packages, orders, sample workflow, result parameters, verification, amendments, attachments | Admin, Doctor, Receptionist, Lab Technician, Pathologist, Nurse according to action | **Implemented in source:** API, UI and relational models exist. |
| M10 | Laboratory | Inventory, finance and reports | Inventory batches/mappings/movements, Lab ledger, billing, analytics/settings | Admin, Lab Technician, Billing Manager, Doctor, Receptionist, Pathologist as individually guarded | **Implemented in source:** separated Lab stock/ledger flows and department billing. |
| M11 | Ultrasound | Orders, imaging and reports | Order lifecycle, templates, images, report review/verification/finalization/delivery, analytics/audit | Admin, Doctor, Receptionist, Ultrasound Tech/Technician, Radiologist according to action | **Implemented in source:** API and UI exist; image/PACS and real-world workflow not runtime-verified. |
| M12 | Pharmacy | Inventory and POS | Medicines, batches, FEFO dispense, prescription dispense, sales, returns/voids, discount audit | Admin, Pharmacist; selected medicine reads by Doctor/Nurse | **Implemented in source:** transaction-backed stock and sale paths exist. |
| M13 | Pharmacy | History and khata | Pharmacy invoice history, customer accounts, payments, adjustments and reports | Admin, Pharmacist | **Implemented in source:** legacy Pharmacy finance screens/API remain separate from shared invoice payments. |
| M14 | Billing | Department invoices/payments | Create/list/detail, staff filters, payment, refund, void, summary and history | Admin, Billing Manager, Receptionist, Lab Technician, Pharmacist, Ultrasound Tech and Ultrasound Technician | **Implemented in source:** database-backed invoices and payment rows; runtime not verified. |
| M15 | Wards/IPD | Admissions and running bills | Bed/ward setup, admission, transfers, bed rent, service lines, deposit, payments, discharge, settlement, refund | Admin, Billing Manager, Receptionist, Doctor, Nurse; specific financial actions more restricted | **Implemented in source:** dedicated invoice per newly created admission; old admissions without one are not automatically backfilled. |
| M16 | Wards/IPD | Ward medicine and clinical ward work | Doctor/Nurse orders, Pharmacy issue/return, ward rounds, discharge readiness | Doctor, Nurse, Pharmacist, Admin; selected reads by Receptionist/Billing Manager | **Implemented in source:** ward medicine is posted to IPD invoice and stock movement is recorded. |
| M17 | Nursing | Assignments, vitals and tasks | Shift assignment, patient vitals/history, task create/complete | Admin, Nurse, Doctor per endpoint | **Implemented in source:** admission-linked records and doctor ownership checks. |
| M18 | Operation theatre | Surgery workflow | Rooms, availability, schedule, checklist, pre-op, start, recovery, complete, cancel/postpone, event history | Admin, Doctor, Nurse according to action | **Implemented in source:** serializable transitions, event rows, audit and notifications. |
| M19 | Reports | Operational and financial reporting | Revenue, appointments, departments, occupancy, surgery, stock, Lab turnaround, doctor productivity | Admin (reports router-wide guard) | **Implemented in source with a financial aggregation inconsistency:** see §7. |
| M20 | Settings | Hospital and department configuration | Hospital profile, departments, schedules, prescription pad, role-permission records, notification templates, module settings | Admin for mutations; some authenticated reads | **Partially Implemented:** permission records are persisted, but route authorization uses static guards rather than these records. |
| M21 | Shared services | Audit, notifications, files and backups | Audit log, in-app notifications, upload/download, PostgreSQL backup/restore | Admin for audit/backup; files public or authenticated by path; notifications authenticated | **Implemented in source, runtime unverified:** notifications are best effort; WhatsApp delivery is not evidenced. |

### Frontend screen inventory and data source

| Route/screen | API-backed behavior or static/local source |
|---|---|
| Public `/`, `/about`, `/departments`, `/doctors`, `/services`, `/appointment`, `/blog`, `/blog/:id`, `/contact`, and not-found page | Appointment uses public doctor/department/availability and create APIs. Home, department and doctor screens consume public directory APIs with some local fallbacks. Blog, services, about/contact copy, testimonials and several home blocks use frontend data/constants. |
| `/lab-report-verification/:orderNumber` | Calls the public Lab report verification API. |
| `/dashboard/login`, `/dashboard/forgot-password`, `/dashboard/reset-password` | Login and password recovery use auth APIs. |
| `/print/*` | Print screens load server-provided patient/admission/user/hospital-profile print data where applicable; client/browser print rendering was not tested. |
| `/dashboard/admin`, `/dashboard/users`, `/dashboard/admin/backup` | Admin dashboard loads context/report/summary APIs; user screens use user/department APIs; backup screen calls create/list/download/restore/delete routes. |
| `/dashboard/patients`, `/dashboard/patients/:mrNumber`; patient registration modal | Patient list/profile/clinical summary and registration use patient APIs; profile can launch consultation. |
| `/dashboard/appointments`, `/dashboard/queue`; booking modal | Appointments and queue are API-backed; booking uses create and availability APIs; lifecycle actions call appointment/queue endpoints. |
| `/dashboard/doctor`, `/dashboard/doctor/consultation/:appointmentId`, `/dashboard/doctor/consultation-record/:consultationId` | Doctor dashboard and consultation forms use APIs for consultation, patient summary, prescriptions, Lab, Ultrasound and staff profile. |
| `/dashboard/lab`, `/dashboard/lab/orders`, `/dashboard/lab/:orderId`, `/dashboard/lab/reports`, `/dashboard/lab/ledger`, `/dashboard/lab/catalog`, `/dashboard/lab/settings`, `/dashboard/lab/inventory`, `/dashboard/lab/invoices`, `/dashboard/lab/billing`; order modal | Uses Lab API/context for orders/results, report settings/attachments, catalogue, packages, inventory, ledger and billing. |
| `/dashboard/ultrasound`, `/dashboard/ultrasound/overview`, `/dashboard/ultrasound/reports`, `/dashboard/ultrasound/audit-trail`, `/dashboard/ultrasound/billing` | Uses order/catalog/staff/template/analytics/audit APIs and file uploads; scan-type fallback definitions remain local. |
| `/dashboard/pharmacy`, `/dashboard/pharmacy/billing`, `/dashboard/pharmacy/invoice-history`, `/dashboard/pharmacy/invoices`, `/dashboard/pharmacy/invoices/:invoiceId`, `/dashboard/pharmacy/discount-audit`, `/dashboard/pharmacy/khata`, `/dashboard/pharmacy/sale-adjustments`, `/dashboard/pharmacy/reports`, `/dashboard/pharmacy/settings`, `/dashboard/pharmacy/legacy-sale`; ward-issue panel | Inventory, POS, invoice history, sale adjustment, discount audit, khata, reports/settings and ward medicine use Pharmacy APIs. |
| `/dashboard/billing`, `/dashboard/billing/collect`, `/dashboard/billing/:invoiceId`; invoice/create/receipt panels | Invoice list/detail, staff filters, payment/refund/void and summary call shared billing APIs; receipts render from loaded invoice data. |
| `/dashboard/ward`, `/dashboard/ward/round/:admissionId`; admission, transfer, discharge and running-bill panels | Beds/admissions and all IPD billing actions use Ward/IPD APIs; ward-type labels and some display constants remain local. |
| `/dashboard/nurse` | Uses API-backed assignment, ward, admission, vitals and task data. |
| `/dashboard/ot`, `/dashboard/ot/:surgeryId`; schedule modal | Uses OT APIs for dashboard, room availability, schedule and surgery lifecycle; `OT_ROOMS` is a local constant used in UI alongside backend room data. |
| `/dashboard/reports`, `/dashboard/settings`, `/dashboard/audit-logs` | Reports, settings and audit views call corresponding APIs; some labels/defaults are local. |

### Backend endpoint catalog

All paths below are relative to `/api/v1` (the app mounts routers using `env.API_PREFIX`; frontend requests use `/api/v1`). For module rows, unprefixed subpaths are relative to the router mounted in the first column. `Authenticated` means the router requires a valid session but has no additional inline role list; `custom/service` means record ownership or service-level authorization also applies. Route files are the primary evidence; controllers call the named services.

| Module / route source | HTTP method and path families | Required role(s) | Operation |
|---|---|---|---|
| Auth — [auth routes](./careplus-backend/src/modules/auth/auth.routes.ts) | `POST /auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`; `GET,POST /auth/verify-reset-token`; `POST /auth/logout`, `/auth/change-password`; `GET /auth/me` | Login/refresh/reset/verify/forgot are public; logout/change/me require authentication | Authenticate, rotate/revoke tokens, reset/change password, read current user. |
| Users — [user routes](./careplus-backend/src/modules/users/users.routes.ts) | `GET /users`, `/users/:id`, `/users/me/profile`, `/users/:id/profile`, `/users/ultrasound-staff`; `POST /users`, `/users/:id/deactivate`, `/users/:id/unlock`; `PATCH /users/:id`, `/users/me/profile`, `/users/:id/profile` | User administration Admin; self profile authenticated; staff profiles have listed role guards | User administration, profile and signature/image upload, unlock account. |
| Patients — [patient routes](./careplus-backend/src/modules/patients/patients.routes.ts) | `GET /patients`, `/:id`, `/:id/profile`, `/:id/print-summary`, `/:id/clinical-summary`; `POST /patients`, `/patients/merge`; `PATCH /patients/:id`, `/:id/clinical-summary`; `DELETE /patients/:id` | View uses `permissions.patients.view`; create Admin/Receptionist; edit Admin/Receptionist; clinical-summary edit Admin/Doctor; delete/merge Admin | Search, register, view/print, edit clinical history, soft-delete and merge records. |
| Appointments — [appointment routes](./careplus-backend/src/modules/appointments/appointments.routes.ts) | Public `GET /appointments/public/departments`, `/public/doctors`, `/public/doctors/:doctorId/slots`; `POST /appointments/public`; authenticated `GET /appointments/doctors`, `/doctors/:doctorId/slots`, `/appointments`, `/:id`; `POST /appointments`, `/:id/approve`, `/:id/reject`, `/:id/reschedule`, `/:id/cancel`, `/:id/mark-done`, `/:id/mark-no-show` | Public booking paths public; staff routes explicitly guard Admin/Receptionist/Doctor/Nurse and selected Lab/Pharmacy reads | Schedule and manage appointments, availability and lifecycle. |
| OPD queue — [queue routes](./careplus-backend/src/modules/opd-queue/opd-queue.routes.ts) | `GET /opd-queue`; `POST /opd-queue/:doctorId/call-next`, `/:id/start-consultation`, `/:id/requeue` | Admin/Receptionist/Doctor/Nurse; start consultation Admin/Doctor | Read derived queue and call/start/requeue patients. |
| Consultations — [consultation routes](./careplus-backend/src/modules/consultations/consultations.routes.ts) | `GET /consultations/icd10`, `/consultations`, `/consultations/:id`; `POST /consultations/start`, `/consultations`, `/:id/sign`, `/:id/complete`, `/:id/addenda`; `PATCH,PUT /consultations/:id` | Admin/Doctor for writes/sign/complete/addenda; Admin/Doctor/Nurse for selected reads | Consultation notes, lifecycle and addenda. |
| Prescriptions — [prescription routes](./careplus-backend/src/modules/prescriptions/prescriptions.routes.ts) | Public `GET /shared/:token/verify`, `/shared/:token/pdf`; `GET,POST,PUT,DELETE /templates` and `/templates/:id`; `POST /:id/share`, `/:id/share/:shareId/pdf`; `GET /`, `/consultations/:consultationId/print`, `/:id`, `/:id/print`; `POST /`, `/:id/sign`, `/:id/void` | Public share paths public; templates/share Doctor; list/detail Admin/Doctor/Pharmacist/Nurse; creation/sign Admin/Doctor/Pharmacist; void Admin/Doctor | Prescription workflow, printing payload and temporary file share. |
| Lab — [Lab routes](./careplus-backend/src/modules/lab/lab.routes.ts) | `GET /public/reports/:orderNumber/verify`; `GET,PUT /settings`, `/settings/report`, `/settings/verification`, `/settings/billing`; `GET /settings/order-policy`; `POST /settings/assets/:assetType`; `GET,POST /tests`, `PATCH,DELETE /tests/:id`; same CRUD paths for `/packages`; `GET /overview`, `/reports`; `GET,POST /ledger/accounts`, `GET /ledger/accounts/:accountId`, `POST /ledger/accounts/:accountId/payments`, `GET /ledger/referring-clinics`, `/ledger/reference-labs`; `GET /inventory`, `/inventory/movements`; `POST /inventory/items`, `/inventory/batches`, `/inventory/mappings`, `/inventory/adjustments`; `PATCH /inventory/items/:id`; `DELETE /inventory/mappings/:id`; `GET /orders`, `/orders/:id`; `POST /orders`, `/orders/packages`, `/orders/:id/invoice`, `/orders/:id/reject-sample`, `/orders/:id/sample-rejections/:rejectionId/recollect`, `/orders/:id/printed`, `/orders/:id/results`, `/orders/:id/results/amend`, `/orders/:id/verify`, `/orders/:id/attachments`; `PATCH /orders/:id/sample-status` | Exact role lists are per route: generally Admin/Lab Technician for catalog/inventory; Admin/Doctor/Receptionist for ordering; Admin/Lab Technician/Pathologist for result actions; Admin/Billing Manager for ledger; report settings and public verification differ | Lab catalog/order/sample/result/report/inventory/ledger/charge workflows. |
| Ultrasound — [Ultrasound routes](./careplus-backend/src/modules/ultrasound/ultrasound.routes.ts) | `GET /templates/manage`, `/settings/scan-catalog`, `/audit-trail/users`, `/audit-trail`, `/analytics/overview`, `/analytics/reports`, `/templates`, `/templates/:id`, `/queue`, `/reports/:id`, `/patient/:patientId`, `/:id/audit-trail`, `/:id`, `/`; `PUT /templates/:id`, `/reports/:id`; `POST /orders`, `/`, `/:id/print`, `/:id/images`; `PATCH /settings/scan-catalog`, `/:id/pricing`, `/:id/schedule`, `/:id/start`, `/:id/complete`, `/:id/review`, `/:id/verify`, `/:id/finalize`, `/:id/deliver`, `/:id/cancel` | Route constants `viewRoles`, `performerRoles`, `technicianRoles`, `reviewRoles`, `queueRoles`, `deliveryRoles`; Admin-only management/audit/pricing; order/review/perform/delivery actions are role-specific | Ultrasound order lifecycle, reporting, image upload, pricing, audit and analytics. |
| Pharmacy — [Pharmacy routes](./careplus-backend/src/modules/pharmacy/pharmacy.routes.ts) | `GET /settings`, `/categories`, `/medicines`, `/khata/accounts`, `/khata/accounts/:accountId`, `/overview`, `/reports`, `/invoices`, `/sales/:id/invoice`, `/invoices/:invoiceId`, `/sale-adjustments`, `/discount-audits`, `/stock-movements`; `PUT /settings`, `/settings/admin-pin`; `POST /settings/logo`, `/medicines`, `/batches`, `/stock-in`, `/dispense`, `/prescriptions/:id/dispense`, `/sales`, `/khata/accounts`, `/khata/accounts/:accountId/payments`, `/khata/accounts/:accountId/adjustments`, `/invoices/:invoiceId/void`, `/invoices/:invoiceId/returns`, `/return`, `/adjust`, `/write-off`; `PATCH,DELETE /medicines/:id` | Most operational Pharmacy routes Admin/Pharmacist; medicine reads also Doctor/Nurse; settings mutation Admin-only | Stock, FEFO sales/dispense, returns/voids, khata, audits and reporting. |
| Shared billing — [billing routes](./careplus-backend/src/modules/billing/billing.routes.ts) | `GET /billing/summary`, `/history`, `/staff`, `/invoices`, `/invoices/:id`; `POST /billing/invoices`, `/invoices/:id/payments`, `/invoices/:id/refunds`, `/invoices/:id/void` | Summary/history and refunds/void Admin/Billing Manager; other invoice routes Admin/Billing Manager/Receptionist/Lab Technician/Pharmacist/Ultrasound Tech/Ultrasound Technician | Department-aware invoices, payment, refund, void, history and totals. Service enforces department restrictions and patient access. |
| Wards/IPD — [ward routes](./careplus-backend/src/modules/wards/wards.routes.ts) | `GET /`, `/beds/availability`, `/admissions`, `/admissions/:id`, `/admissions/:id/print`, `/admissions/:id/slip`, `/ipd/invoices`, `/service-charges`, `/medicine-orders/admissions`, `/admissions/:id/running-bill`, `/admissions/:id/medicine-orders`; `POST /`, `/rooms`, `/beds`, `/rooms-beds/batch`, `/admissions`, `/admissions/:id/deposits`, `/:id/transfer`, `/:id/discharge`, `/:id/service-lines`, `/:id/invoice-items/:itemId/reversals`, `/:id/medicine-orders`, `/:id/medicine-orders/:orderId/issue`, `/:id/medicine-order-items/:orderItemId/returns`, `/:id/payments`, `/:id/refunds`, `/:id/settle`; `PATCH /:id`, `/beds/:id/status`; `DELETE /:id` | Per-action guards: Admin/Billing Manager/Receptionist/Doctor/Nurse for selected reads; Admin for ward setup; Admin/Pharmacist for medicine issue; Admin/Billing Manager for reversals/refunds; Admin/Billing Manager/Receptionist for payments/deposits/settlement; Doctor/Nurse for orders; Doctor/Admin for discharge | Admission, IPD invoice, bed rent, ward medicine, service lines and settlement. |
| Ward rounds — [ward-round routes](./careplus-backend/src/modules/wards/wardRounds.routes.ts) | `GET,POST /wards/admissions/:id/rounds`; `PATCH /wards/admissions/:id/ready-for-discharge`; `GET /doctors/me/ward-rounds/today` | Admin/Doctor | Record and read rounds; update discharge readiness. |
| Nursing — [nursing routes](./careplus-backend/src/modules/nursing/nursing.routes.ts) | `POST /nursing/assignments`, `POST /nursing/vitals`, `GET /nursing/vitals/:id`, `POST /nursing/tasks`, `POST /nursing/tasks/:id/complete`, `GET /nursing/tasks/:id`, `GET /nursing/assignments` | Assignment create Admin; vitals/tasks Admin/Nurse/Doctor; complete Admin/Nurse; assignment list authenticated | Assignments, vitals and task tracking. |
| OT — [OT routes](./careplus-backend/src/modules/ot/ot.routes.ts) | `GET /rooms`, `/surgeries/summary`, `/surgeries`, `/surgeries/availability`, `/surgeries/:id`; `POST /rooms`, `/surgeries`, `/surgeries/:id/pre-op`, `/start`, `/recovery`, `/complete`, `/cancel`, `/postpone`; `PATCH /rooms/:id`, `/surgeries/:id/checklist`; `DELETE /rooms/:id` | Admin for room mutations; Admin/Doctor/Nurse for reads/checklists; Admin/Doctor for surgery lifecycle; service additionally checks assigned surgeon and patient/record access | Schedule and track surgical workflow and status events. |
| Notifications — [notification routes](./careplus-backend/src/modules/notifications/notifications.routes.ts) | `GET /notifications`, `/unread-count`; `POST /notifications/:id/read`, `/mark-all-read` | Authenticated | User's in-app notification inbox and read state. |
| Reports — [report routes](./careplus-backend/src/modules/reports/reports.routes.ts) | `GET /reports/revenue-summary`, `/revenue-trend`, `/appointment-stats`, `/department-distribution`, `/bed-occupancy`, `/surgery-stats`, `/low-stock-medicines`, `/near-expiry-medicines`, `/lab-turnaround`, `/doctor-productivity` | Admin; router-wide guard | Aggregate operational and financial reports. |
| Settings — [settings routes](./careplus-backend/src/modules/settings/settings.routes.ts) | `GET /hospital-profile`, `/medicine-categories`, `/role-permissions`, `/notification-templates`, `/doctor-schedules`, `/prescription-pad`, `/departments/available-hods`, `/departments`, `/ultrasound-doctors`, `/`, `/:key`; `POST /medicine-categories`, `/notification-templates`, `/prescription-pad/logo`, `/prescription-pad/qr-code`, `/departments`, `/ultrasound-doctors/:doctorId/signature`, `/hospital-profile/logo`, `/hospital-profile/favicon`; `PUT /role-permissions`, `/notification-templates/:id`, `/doctor-schedules/:doctorId`, `/prescription-pad`, `/departments/:id`, `/hospital-profile`, `/:key`; `PATCH /medicine-categories/:id`, `/departments/:id/status`; `DELETE /medicine-categories/:id`, `/notification-templates/:id`, `/departments/:id` | Router authenticated; mutations generally Admin; department and some reads are authenticated without an additional role guard | Hospital and module configuration, uploads, department management. |
| Audit and backups — [audit routes](./careplus-backend/src/modules/audit-logs/audit-logs.routes.ts), [backup routes](./careplus-backend/src/modules/backup/backup.routes.ts) | `GET /audit-logs`; `POST,GET /admin/backup`, `GET /:id/download`, `DELETE /:id`, `POST /:id/restore` | Admin | Audit search and backup lifecycle. Backup implementation invokes PostgreSQL dump/restore utilities and stores checksum/status metadata. |
| Files — [file routes](./careplus-backend/src/modules/files.routes.ts) | `GET /files/hospital-profile/*`, `/files/public-profile-pictures/*`, `/files/*` | First two path families public; catch-all requires authentication; file resolver restricts paths/extensions | Serve uploaded assets and private files. |
| Platform — [app mounts](./careplus-backend/src/app.ts) | `GET /health`; `GET /api-docs/*` | Public | Database health check and Swagger UI/API documentation; `/health` performs a read-only connectivity query. |

## 4. User Roles and Access Matrix

Backend roles are defined by the Prisma `Role` enum and match the frontend role categories: `ADMIN`, `BILLING_MANAGER`, `RECEPTIONIST`, `DOCTOR`, `LAB_TECHNICIAN`, `PATHOLOGIST`, `ULTRASOUND_TECH`, `ULTRASOUND_TECHNICIAN`, `RADIOLOGIST`, `PHARMACIST`, `NURSE`. Frontend landing routes are in [nav.ts](./careplus-frontend/src/dashboard/nav.ts); route guards are in [DashboardApp.tsx](./careplus-frontend/src/dashboard/DashboardApp.tsx); backend static permissions are in [permissions.ts](./careplus-backend/src/common/permissions.ts) and endpoint guards in each route file.

**Legend:** Full = broad role access within the module; Limited = only specific actions or owned/department records; No = no supporting role route/action found; Unverified = frontend/backend declarations conflict or service-level scope cannot be established from a route guard alone. These labels describe source guards, not runtime test results.

| Role (landing page) | Patients / OPD | Clinical / Lab | Ultrasound | Pharmacy | Billing / IPD | Administration |
|---|---|---|---|---|---|---|
| Admin (`/dashboard/admin`) | Full | Full | Full | Full | Full | Full |
| Billing Manager (`/dashboard/billing`) | Limited patient read | No general clinical actions; Lab reports/ledger as guarded | Limited billing/read | Limited department billing/history via shared workspace | Full all-department billing; limited IPD admission/finance routes; refund/void allowed | No settings, users, audit or backup mutation |
| Receptionist (`/dashboard/appointments`) | Limited create/edit/read | Limited appointment/order/selected report reads | Limited overview/queue/delivery | No Pharmacy inventory/POS role | Reception billing, IPD admission deposits, interim IPD payments, and IPD settlement; no refund/void/reversals | No |
| Doctor (`/dashboard/doctor`) | Limited to applicable patient records | Full consultation actions; can order Lab/Ultrasound | Limited ordering/review | Limited medicine read/prescribing | No invoice payment/refund/void; limited IPD service/admission actions | No |
| Lab Technician (`/dashboard/lab`) | Limited patient read | Full Lab operations permitted by route, including selected catalog/inventory/results | No | No | Limited to Lab department billing/payment; no refund/void | No |
| Pathologist (`/dashboard/lab`) | No patient view permission in the shared patient map | Limited Lab report/result amendment and verification | No | No | No shared billing route | No |
| Ultrasound Tech (`/dashboard/ultrasound`) | Limited patient read | No | Full technician workflow; billing limited to Ultrasound | No | Limited Ultrasound billing/payment; no refund/void | No |
| Ultrasound Technician (`/dashboard/ultrasound`) | Limited patient read | No | Full technician workflow | No | Limited Ultrasound billing/payment; no refund/void | No |
| Radiologist (`/dashboard/ultrasound`) | Limited patient read | No | Limited ordering/review/report actions | No | No shared billing route | No |
| Pharmacist (`/dashboard/pharmacy`) | Limited patient read | Limited prescription read/dispense | No | Full Pharmacy operations; Pharmacy sale return/void endpoints include Pharmacist | Limited Pharmacy department billing/payment; no shared refund/void | No |
| Nurse (`/dashboard/nurse`) | Limited patient read | Limited consultation/prescription reads | Limited selected overview/queue visibility | Limited medicine read | No payment/refund/void; may add allowed IPD service lines and order ward medicines | No |

### RBAC implementation notes

- `requireRole()` checks authenticated token role against configured permissions. For designated configurable module/action pairs (`ward:view`, `ward:create`, `ward:edit`, `billing:view`, `billing:create`, `billing:edit`, `reports:view`, `patients:view`, `patients:create`, `patients:edit`), `requireRole` reads persisted `RolePermission` database records via `checkPermission()` with an in-memory cache and automatic cache invalidation on Settings API updates (`settings.routes.ts`). An explicit hard-coded safeguard prevents Admin lockout under any stored configuration. If the table is empty or lookup fails, it safely falls back to hard-coded baseline defaults. Evidence: [requireRole middleware](./careplus-backend/src/common/middleware/requireRole.ts), [rolePermissions service](./careplus-backend/src/common/services/rolePermissions.service.ts), [permissions map](./careplus-backend/src/common/permissions.ts).
- `ULTRASOUND_TECH` vs `ULTRASOUND_TECHNICIAN` role duplication: both enum values exist in Prisma schema as legacy aliases and are handled identically in all backend route guards (`ultrasound.routes.ts`, `users.routes.ts`, `billing.routes.ts`), frontend navigation (`nav.ts`), route guards (`DashboardApp.tsx`), and login role mappings (`Login.tsx`). Seed defaults to `ULTRASOUND_TECH`.
- Doctor record ownership is separately checked through `recordAuthorization.ts`.
- The UI's `RoleGuard` reflects stored role permissions for client visibility, while backend middleware remains strictly authoritative for API enforcement.

## 5. Database and Shared Entities

The Prisma datasource declares PostgreSQL. The table names below are the schema's `@@map` names; a name shown without a special mapping follows the default mapping. “Relations” lists the important Prisma links, not every inverse/list field. Full schema: [schema.prisma](./careplus-backend/prisma/schema.prisma).

| Table(s) / Prisma model(s) | Purpose | Related modules and key relationships | Disconnected / usage note |
|---|---|---|---|
| `departments` / Department; `users` / User; `staff_profiles` / StaffProfile; `role_permissions` / RolePermission; `auth_attempts` / AuthAttempt | Department directory, staff identity/profile, configurable permission records and login-attempt audit | Users link to Department, Doctor, StaffProfile, notifications and audit; AuthAttempt optionally links User | RolePermission is persisted but not consumed by route guards. |
| `patients` / Patient; `mr_number_sequences` / MrNumberSequence; `doctors` / Doctor; `appointments` / Appointment; `appointment_token_sequences` / AppointmentTokenSequence | Patient master, MR numbering, staff profiles and appointment/slot/token records | Patient links to appointments, consultations, prescriptions, Lab, Ultrasound, invoices, admissions and surgeries; appointment links patient/doctor/department; doctor links User/Department | Appointment token sequence is allocated by raw SQL `INSERT … ON CONFLICT`, not a Prisma model call. |
| `consultations` / Consultation; `consultation_addenda` / ConsultationAddendum; `prescriptions` / Prescription; `prescription_shares` / PrescriptionShare; `prescription_templates` / PrescriptionTemplate; `prescription_pad_configs` / PrescriptionPadConfig; `prescription_items` / PrescriptionItem | Clinical encounter, immutable addenda, prescription, share link, templates/pad and line items | Consultation joins Appointment/Patient/Doctor and has prescriptions/Lab/Ultrasound; prescription joins Patient/Doctor and optionally Consultation; items may link Medicine | Prescription share PDF path is private-file data; actual server PDF rendering is not evidenced. |
| `lab_tests` / LabTest; `lab_test_parameters` / LabTestParameter; `lab_reference_ranges` / LabReferenceRange; `lab_packages` / LabPackage; `lab_package_tests` / LabPackageTest | Lab catalogue, parameter/result definition, reference ranges and packages | Tests link Lab orders, inventory mappings, parameters, ranges, packages and optional Supplier | Connected through Lab service and nested relations. |
| `lab_orders` / LabOrder; `lab_results` / LabResult; `lab_result_parameters` / LabResultParameter; `lab_order_events` / LabOrderEvent; `lab_sample_rejections` / LabSampleRejection; `lab_order_number_sequences` / LabOrderNumberSequence; `lab_report_attachments` / LabReportAttachment | Ordered tests, result/report record, result parameters, workflow audit, sample rejection/recollection, numbering and attachments | Orders link Patient, Doctor, Consultation, Invoice, Admission and verifier; result parameters link result/test parameter; events/rejections/attachments link order | LabResultParameter and other child records are created/read through parent relations rather than all having direct standalone calls. |
| `lab_inventory_items` / LabInventoryItem; `lab_inventory_batches` / LabInventoryBatch; `lab_test_inventory_mappings` / LabTestInventoryMapping; `lab_inventory_consumptions` / LabInventoryConsumption; `lab_inventory_movements` / LabInventoryMovement | Reagent inventory, batches, test-to-item mapping, consumption and movement history | Supplier, LabTest, LabOrder, LabResult, User and batch relations | Used by Lab inventory service. |
| `ultrasound_report_templates` / UltrasoundReportTemplate; `ultrasound_reports` / UltrasoundReport; `ultrasound_orders` / UltrasoundOrder; `ultrasound_report_amendments` / UltrasoundReportAmendment | Ultrasound order/report templates, patient snapshots, lifecycle, amendment/audit | Orders link Patient, Doctor, Technician/User, Consultation, Invoice and Admission; reports link Patient/Appointment/Doctor/template | Source-level integration present; no imaging/PACS runtime check. |
| `medicine_categories` / MedicineCategory; `medicines` / Medicine; `suppliers` / Supplier; `medicine_batches` / MedicineBatch; `stock_movements` / StockMovement | Pharmacy catalogue, supplier, expiry-aware batches and stock movement | Medicine links category, prescription items, ward orders and sales; batch links Supplier/Medicine; movement links batch | `StockMovement` also records ward issue/return references. |
| `invoice_number_sequences` / InvoiceNumberSequence; `invoice_department_sequences` / InvoiceDepartmentSequence; `invoices` / Invoice; `invoice_items` / InvoiceItem; `payments` / Payment | Numbering, invoice header/lines and payment/refund ledger rows | Invoice links Patient/Admission, items, payments, Pharmacy sale, Lab/Ultrasound orders and ledgers; InvoiceItem optionally links Admission/Bed and source module; Payment links Invoice | Shared financial source for current department billing; void/reversal history is retained rather than deleted. |
| `lab_ledger_accounts` / LabLedgerAccount; `lab_ledger_entries` / LabLedgerEntry | Lab receivable/payable and reference-lab ledger | Account links Patient/Supplier/User; entries link account, Invoice, LabOrder and creator | Separate Lab ledger flows coexist with shared invoices. |
| `pharmacy_ledger_accounts` / PharmacyLedgerAccount; `pharmacy_ledger_entries` / PharmacyLedgerEntry | Pharmacy customer khata and entries | Account links Patient/User; entry links account, Invoice and creator | Separate khata balance is not the shared invoice payment total. |
| `pharmacy_sales` / PharmacySale; `pharmacy_sale_items` / PharmacySaleItem; `pharmacy_security` / PharmacySecurity; `discount_audits` / DiscountAudit; `pharmacy_sale_adjustments` / PharmacySaleAdjustment; `pharmacy_sale_adjustment_items` / PharmacySaleAdjustmentItem | POS sale, sold batches, admin PIN hash, discount approval and return/void history | Sale links invoice/cashier/items/adjustments; adjustment links invoice/sale/actor and batch-level items | Sale adjustments remain a distinct Pharmacy workflow from shared invoice refunds. |
| `wards` / Ward; `rooms` / Room; `beds` / Bed; `admissions` / Admission; `patient_ledger_entries` / PatientLedgerEntry; `service_charges` / ServiceCharge; `bed_rate_history` / BedRateHistory; `ward_medicine_orders` / WardMedicineOrder; `ward_medicine_order_items` / WardMedicineOrderItem; `ward_rounds` / WardRound; `bed_transfers` / BedTransfer | Ward/bed configuration, admission, linked invoice entries, service catalogue, effective bed rates, ward drug order/issue, rounds and transfers | Admission links Patient/Bed/attending Doctor and invoice items; PatientLedgerEntry links Patient/Admission/Invoice/Payment; medicine orders link Admission and Medicine; transfer records from/to Bed | Deposit ledger rows link to the authoritative IPD invoice/payment; source indicates a linked mirror, not a second invoice balance. |
| `nurse_assignments` / NurseAssignment; `patient_vitals_history` / PatientVitals; `nursing_tasks` / NursingTask | Nursing shifts, vitals and task tracking | Assignment links User; vitals/tasks link Admission | Admission and actor ownership checks apply in service code. |
| `ot_rooms` / OtRoom; `surgeries` / Surgery; `surgery_status_events` / SurgeryStatusEvent | OT rooms, scheduled surgery and lifecycle history | Surgery links Patient, OT room and surgeon/assistant/anesthetist; events link Surgery | Surgery has no Admission or Invoice relation in the current model. |
| `notifications` / Notification; `notification_templates` / NotificationTemplate; `whatsapp_message_log` / WhatsappMessageLog | In-app message records, template configuration and a WhatsApp-shaped log table | Notification links User; templates are edited from Settings | `WhatsappMessageLog` has no backend source references or sender route/service found. Notification templates are CRUD-configured but not consumed by the shared `notifyUser/notifyRoles` helper. |
| `hospital_profiles` / HospitalProfile; `settings` / Setting; `backups` / Backup; `audit_logs` / AuditLog | Hospital identity/timezone, generic JSON settings, backup metadata and change audit | AuditLog optionally links User; settings are read by domain services; backup service manages metadata/files | Core platform models are used by settings, IPD, backup and shared audit paths. |

### Enums

The schema contains 45 enums: `Role`, `DepartmentStatus`, `Gender`, `BloodGroup`, `AppointmentStatus`, `AppointmentType`, `AppointmentSource`, `Priority`, `SurgeryPriority`, `PrescriptionStatus`, `DepositStatus`, `MedicineUnitType`, `PharmacySaleAdjustmentType`, `PatientLedgerEntryType`, `LabOrderStatus`, `LabInterpretation`, `LabParameterResultType`, `LabReferenceGender`, `LabParameterInterpretation`, `LabOrderEventType`, `LabSampleRejectionReason`, `StockMovementType`, `LabInventoryMovementType`, `LabLedgerAccountType`, `LabLedgerPartyType`, `LabLedgerEntryType`, `PharmacyLedgerAccountType`, `PharmacyLedgerEntryType`, `InvoiceStatus`, `InvoiceDepartment`, `PaymentType`, `PaymentPurpose`, `InvoiceItemType`, `PaymentMethod`, `WardType`, `BedStatus`, `AdmissionStatus`, `AdmissionType`, `ShiftType`, `NursingTaskStatus`, `OTStatus`, `NotificationType`, `AuditAction`, and two ultrasound status enums (`UltrasoundReportStatus`, `UltrasoundOrderStatus`).

### Migration/schema comparison

- There are **87 migration directories** in the worktree. The latest entries include `20261028190000_add_surgery_admission_id` and `20261030000000_add_prescription_indexes`.
- Seven migration directories are added in this workstream: `20261022230000_add_appointment_gender_and_slot_unique`, `20261023000000_make_prescription_consultation_optional`, `20261023120000_exclude_terminal_appointments_from_slot_constraint`, `20261023130000_require_appointment_gender`, `20261023210000_add_ultrasound_finalized_status`, `20261028190000_add_surgery_admission_id`, and `20261030000000_add_prescription_indexes`.
- **Prescription indexes:** Added migration `20261030000000_add_prescription_indexes` with `CREATE INDEX IF NOT EXISTS "prescriptions_doctor_id_created_at_idx"` on `prescriptions(doctor_id, created_at)` and `"prescriptions_consultation_id_idx"` on `prescriptions(consultation_id)`.
- **Database indexes mirrored in schema.prisma:** Added explicit `@@index` annotations matching existing raw SQL migration index names so future `prisma migrate dev` runs will not generate drop-index migrations:
  - `UltrasoundOrder`: `@@index([admissionId], map: "ultrasound_orders_admission_id_idx")`
  - `Invoice`: `@@index([admissionId], map: "invoices_admission_id_idx")`
  - `InvoiceItem`: `@@index([bedId], map: "invoice_items_bed_id_idx")`
  - `PatientLedgerEntry`: `@@index([invoiceId], map: "patient_ledger_entries_invoice_id_idx")` and `@@index([paymentId], map: "patient_ledger_entries_payment_id_idx")`
- **Fresh database verification:** Deployed all 87 migrations via `prisma migrate deploy` to a clean empty database (`careplus_fresh_diff_test`). Ran `prisma migrate diff --from-url <fresh db> --to-schema-datamodel prisma/schema.prisma`.
  - Result: Only 1 difference was detected across all 82 models:
    ```text
    [*] Changed the `departments` table
      [-] Removed column `is_active`
    ```
  - `departments.is_active` is a legacy column from migration `20260822060456_init` superseded by `DepartmentStatus status`. Documented in `schema.prisma`.
  - The partial unique index `appointments_active_doctor_slot_unique` (predicate `WHERE status NOT IN ('CANCELLED', 'REJECTED')`) is managed via raw DDL in migrations and cannot be represented natively in Prisma schema model constraints.
  - The test database was cleanly dropped after verification.

### Code Quality and Lint Status

- **careplus-backend:** Checked `.eslintrc.cjs`. Installed missing devDependencies (`eslint@^8.57.1`, `@typescript-eslint/parser@^8.72.1`, `@typescript-eslint/eslint-plugin@^8.72.1`).
  - Executed `npm run lint`: reported **45 problems (39 errors, 6 warnings)**. These consist of pre-existing `@typescript-eslint/no-explicit-any` (38) and `@typescript-eslint/no-unused-vars` (7).
- **Package lockfiles & dependencies:** Aligned `nodemailer` to `^8.0.11` to resolve version compatibility with `@types/nodemailer@^8.0.2`. Verified with `npm ls pdfkit qrcode nodemailer @types/nodemailer` and clean `npm ci --dry-run` executions on both backend and frontend.

### Billing Manager Frontend Access and RBAC

- **IPD Running Bill:** `IpdRunningBill.tsx` safely checks user role with case-insensitivity: `const role = (currentUser?.role ?? "").toLowerCase()`.
- **Financial Actions:** `BILLING_MANAGER` can access and execute line reversals and refund dialogs identically to `ADMIN`. `RECEPTIONIST` is blocked from reversal and refund buttons.
- **Permissions and Navigation:** Granted `patients.view` to `billing_manager` in `permissions.ts` and added `Patients` and `Ward Board` to `NAV_BY_ROLE.billing_manager` in `nav.ts`.
- **Automated Verification:** Added `billing-manager@careplus.local` (`BILLING_MANAGER` / `<redacted_seed_password>`) to `careplus-backend/prisma/seed.ts`. Added end-to-end test in `careplus-frontend/tests/e2e/ipd-billing-frontend.spec.ts` asserting that `BILLING_MANAGER` performs IPD refunds and that `RECEPTIONIST` does not see refund or reversal buttons. Passed with 100% success.
- Current DB/schema alignment is verified clean on `careplus_test` for all functional feature items. Live production schema drift remains unverified (production database not contacted per safety rules).

## 6. Cross-Module Workflow and Relationships

| Source module | Destination module | Data transferred and purpose | Evidence | Classification |
|---|---|---|---|---|
| Public website | Appointments | Public department/doctor/slot selection and appointment request | [Appointment page](./careplus-frontend/src/pages/Appointment.tsx), [appointment routes](./careplus-backend/src/modules/appointments/appointments.routes.ts), `Appointment` links `Patient`/`Doctor`/`Department` | Suggested by code; runtime not confirmed |
| Patient registry | Appointments, consultations, Lab, Ultrasound, Pharmacy, billing, IPD, OT | Shared `patientId`/MR number anchors clinical and administrative records | [Patient model](./careplus-backend/prisma/schema.prisma), [record authorization](./careplus-backend/src/common/utils/recordAuthorization.ts) | Suggested by code; schema and service links found |
| Appointment / OPD queue | Consultation | Queue actions transition appointments; consultation stores appointment/patient/doctor | [appointment service](./careplus-backend/src/modules/appointments/appointments.service.ts), [queue routes](./careplus-backend/src/modules/opd-queue/opd-queue.routes.ts), [consultation routes](./careplus-backend/src/modules/consultations/consultations.routes.ts) | Suggested by code; runtime not confirmed |
| Consultation | Prescription, Lab and Ultrasound | Encounter and clinician/patient IDs are used for prescriptions/orders | [Consultation model](./careplus-backend/prisma/schema.prisma), [prescription service](./careplus-backend/src/modules/prescriptions/prescriptions.service.ts), [Lab service](./careplus-backend/src/modules/lab/lab.service.ts), [Ultrasound service](./careplus-backend/src/modules/ultrasound/ultrasound.service.ts) | Suggested by code; runtime not confirmed |
| Prescription | Pharmacy | Signed prescription items are dispensed; stock movement and Pharmacy invoice/sale are created | [Pharmacy service](./careplus-backend/src/modules/pharmacy/pharmacy.service.ts), [pharmacy routes](./careplus-backend/src/modules/pharmacy/pharmacy.routes.ts) | Suggested by code; runtime not confirmed |
| Lab | Inventory and billing/IPD | Lab results may consume mapped inventory; orders carry invoice/admission links; admission orders can post IPD charges | [Lab inventory service](./careplus-backend/src/modules/lab/labInventory.service.ts), [IPD billing service](./careplus-backend/src/modules/ipd/ipdBilling.service.ts) | Suggested by code; runtime not confirmed |
| Ultrasound | Billing/IPD | Orders link invoice/admission; report lifecycle and charge data are connected | [Ultrasound service](./careplus-backend/src/modules/ultrasound/ultrasound.service.ts), [Ultrasound model](./careplus-backend/prisma/schema.prisma), [IPD billing service](./careplus-backend/src/modules/ipd/ipdBilling.service.ts) | Suggested by code; runtime not confirmed |
| Pharmacy | IPD | Doctor/Nurse medicine order → Pharmacist issues FEFO batches → stock movements and invoice items post to IPD invoice; returns create credit and stock restoration | [IPD billing service](./careplus-backend/src/modules/ipd/ipdBilling.service.ts), [Pharmacy service](./careplus-backend/src/modules/pharmacy/pharmacy.service.ts) | Suggested by code; runtime not confirmed |
| Admission/Bed | IPD billing | Admission gets one linked IPD invoice; bed-rate history, bed changes and daily accrual produce itemized charges; deposit/payment/refund rows link to invoice | [wards service](./careplus-backend/src/modules/wards/wards.service.ts), [IPD billing service](./careplus-backend/src/modules/ipd/ipdBilling.service.ts) | Suggested by code; runtime not confirmed |
| Nursing / ward rounds | Admission | Vitals, tasks, assignments, rounds and discharge readiness link to admission; doctor ownership is checked in applicable services | [nursing routes](./careplus-backend/src/modules/nursing/nursing.routes.ts), [ward-round service](./careplus-backend/src/modules/wards/wardRounds.service.ts) | Suggested by code; runtime not confirmed |
| OT | IPD billing, patient, doctors and notifications | Surgery links patient, OT room and assigned clinicians; optional admission link posts OT charges upon COMPLETED to IPD invoice; state transitions create status events and notify participants | [OT routes/service](./careplus-backend/src/modules/ot/ot.routes.ts), [Surgery model](./careplus-backend/prisma/schema.prisma), [IPD billing](./careplus-backend/src/modules/ipd/ipdBilling.service.ts) | Implemented and verified by integration tests |
| Billing | Reports | Invoice date supports invoiced totals; payment date supports collection trends; reports aggregate invoice/payment rows | [billing service](./careplus-backend/src/modules/billing/billing.service.ts), [reports routes/service](./careplus-backend/src/modules/reports/reports.routes.ts) | Implemented; net collections compute payments minus refunds |
| Domain services | Audit log | Transaction-aware audit rows capture actor, action, entity, old/new values and reason; selected fields are redacted | [audit helper](./careplus-backend/src/common/utils/auditLog.ts) | Suggested by code; runtime not confirmed |
| Domain services | Notifications | In-app rows are created for selected events; role notifications fan out to active users; errors are logged and are best effort | [notification helper](./careplus-backend/src/common/utils/notify.ts), [server jobs](./careplus-backend/src/server.ts) | Suggested by code; delivery not runtime-confirmed |
| Domain records | Reports | Reports aggregate appointment, invoice/payment, surgery, bed, stock, Lab and consultation data | [report service/routes](./careplus-backend/src/modules/reports/reports.routes.ts) | Suggested by code; results not runtime-confirmed |

### Notable workflow logic

- Appointment tokens use a database upsert/`ON CONFLICT` sequence; appointment slot conflict checks and terminal-status handling are in the appointment service/migrations.
- Shared invoice payments use a PostgreSQL row lock (`SELECT … FOR UPDATE`), recalculate balance/status in a transaction, reject overpayment, and support an idempotency key.
- Department invoice number prefixes in source are `OPD`, `LAB`, `PHARM`, `USG`, `IPD` with year and six digits; these differ from the example names in the prior design brief. The implementation uses a department/year sequence in [sequenceGenerators.ts](./careplus-backend/src/common/utils/sequenceGenerators.ts).
- Ultrasound lifecycle uses an explicit transition table; editing a verified report requires an amendment reason. Lab stores order events, rejections and result versions.
- Pharmacy dispensing selects FEFO stock; ward issue runs in a transaction with invoice-line creation. IPD job uses a Redis `NX` lock and lock-token-safe release; server starts it at boot and every 24 hours.
- Bed rent uses the configured cut-off (default 12:00), hospital profile timezone (fallback `Asia/Karachi`) and bed-rate history. Bed rent accrual is locked/idempotent per admission and may be invoked by the scheduled job, running bill and discharge flows. See [bed-rent date utility](./careplus-backend/src/modules/ipd/ipdBilling.utils.ts).
- Rule A formula: *Every admission receives 1 base day for admission plus 1 additional day for each daily cut-off instant (default 12:00 PKT) that occurs strictly after the admission timestamp and at or before the discharge/calculation end timestamp.* Worked examples: (1) Admitted 10:00, discharged same day 11:00 (before cut-off) = 1 day (0 cut-offs crossed). (2) Admitted 10:00, discharged next day 11:00 = 2 days (crosses Day 1 12:00 cut-off). (3) Admitted 10:00, discharged next day 13:00 = 3 days (crosses Day 1 12:00 and Day 2 12:00 cut-offs). (4) Admitted afternoon 14:00, discharged next day 11:00 = 1 day (0 cut-offs crossed). (5) Admitted afternoon 14:00, discharged next day 13:00 = 2 days (crosses Day 2 12:00 cut-off). This 9-case specification is verified in [ipd-bed-rent-days.test.ts](./careplus-backend/tests/unit/ipd-bed-rent-days.test.ts) across both UTC and Asia/Karachi timezones.
- IPD financial authorizations: `ADMIN` and `BILLING_MANAGER` are exclusively authorized for IPD refunds and service-line reversals in both `wards.routes.ts` and `ipdBilling.service.ts` (`recordIpdRefund`, `reverseLine`). `RECEPTIONIST` is authorized to collect deposits, interim payments, and settlements, but is rejected with HTTP 403 Forbidden on refunds and reversals.
- Workflow edges `Consultation->Admission`, `Consultation->Surgery`, and `Registration->Queue`: Code inspection confirmed each of these transitions is NOT AUTOMATED and NO direct foreign key or trigger exists in backend code (marked 'NOT FOUND'). Patients are admitted independently via `POST /wards/admissions`, surgeries are scheduled via `POST /ot/surgeries`, and OPD queue is derived from appointment scheduling/check-in, not patient registration.
- Backups are represented by `Backup` rows and service-managed database dump/restore files; actual host utilities and restore behavior were not exercised.
- Private uploads are size/type/signature checked and stored with restrictive filesystem permissions; actual deployment storage and access behavior were not exercised.

## 7. Features Verification State

### A. Fixed and Verified Features (Evidence-Backed)

1. **Refund bug in financial reports:** **FIXED.** In `reports.routes.ts`, `revenueSummary` (lines 56–91) and `revenueTrend` (lines 114–135) calculate net collected revenue as `SUM(PAYMENT) - SUM(REFUND)` using `aggregatePaymentTotals()`, excluding soft-deleted payments and voided invoices. Response shape remains backward-compatible with `totalCollected`, `grossCollected`, and `refundsTotal`. Verified by test: [revenue-reports-refunds.database.test.ts](./careplus-backend/tests/integration/revenue-reports-refunds.database.test.ts) (6/6 tests passed).
2. **OT-to-IPD billing link:** **FIXED.** Added nullable `admissionId` foreign key to `Surgery` model and migration `20261028190000_add_surgery_admission_id`. Scheduling validates that the admission belongs to the same patient and is active. Completing surgery posts an OT charge exactly once to the IPD invoice (idempotent), respects completion `chargeAmount` or configured service charges, reverses the charge upon surgery cancellation/postponement, and rejects posting if the invoice is finalized/closed. Verified by test: [surgery-ipd-billing.database.test.ts](./careplus-backend/tests/integration/surgery-ipd-billing.database.test.ts) (5/5 tests passed).
3. **Role permissions backend enforcement:** **FIXED.** `requireRole()` middleware consults stored `RolePermission` database records for configurable module/action pairs (`CONFIGURABLE_PERMISSION_PAIRS`), backed by an in-memory cache and automatic cache invalidation upon Settings API updates (`settings.routes.ts`). An explicit hard-coded safeguard prevents Admin lockout under any stored configuration, and failures gracefully fall back to baseline static defaults. Verified by test: [role-permissions-authorization.database.test.ts](./careplus-backend/tests/integration/role-permissions-authorization.database.test.ts) (7/7 tests passed).
4. **Notification templates wiring:** **FIXED.** `notifyUser` and `notifyRoles` now render active `NotificationTemplate` records using placeholder replacement `{{key}}`, falling back gracefully to hard-coded strings when unconfigured or on template errors, with unknown placeholders preserved safely without crashing. Notification failures never disrupt parent transactions. Verified by test: [notification-template-renderer.database.test.ts](./careplus-backend/tests/integration/notification-template-renderer.database.test.ts) (12/12 tests passed).
5. **Server-side Prescription PDF generation:** **FIXED.** Server-side PDF generation implemented using lightweight `PDFKit` in `prescriptionPdf.service.ts`, matching the frontend prescription print layout (header/pad, patient demographics, medications table, vitals, QR code, and signature). Stored in private files directory; authenticated `GET /api/v1/prescriptions/:id/pdf` and token-authenticated public share endpoints verify expiration and revocation. Verified by test: [prescription-pdf-generation.database.test.ts](./careplus-backend/tests/integration/prescription-pdf-generation.database.test.ts) (11/11 tests passed).

### B. Remaining Open or Unverified Items

1. **WhatsApp integration:** **UNVERIFIED / NOT IMPLEMENTED.** `WhatsappMessageLog` exists in the schema, but no producer, sender service, or route reference exists in backend source. The notification helper creates in-app notifications only.
2. **Static website content:** **PARTIAL / BY DESIGN.** Public website pages (blog, testimonials, static about/service blocks) consume static constants rather than CMS endpoints. Public doctors and appointments do call live APIs.
3. **Production database drift:** **UNVERIFIED.** Migrations apply cleanly and schema diff is empty on fresh test database (`careplus_test`). However, the production database was intentionally not contacted per global safety rules; live production schema alignment remains to be verified during deployment.
4. **External operations and delivery:** SMTP email delivery, real printer hardware, and Redis cluster failover were not exercised in unit/integration environments.

## 8. Final Summary for My Supervisor

CarePlus is a web-based HMS with a public hospital/appointment site and a role-based staff application. Its main integrated areas are patient registration, appointments and OPD queue, doctor consultations and prescriptions, Laboratory, Ultrasound, Pharmacy, department billing, inpatient ward/admission billing, nursing, operation theatre, reports, settings, audit, notifications and backups. Prisma provides a broad relational model linking patients and clinical orders to invoice, admission, stock, audit and workflow records. The source also defines 11 staff roles and both frontend and backend authorization layers. Several core workflows are integrated in code, especially billing/IPD and Pharmacy stock. Configurable role permissions and net refund calculations are wired and verified with regression suites. Static content remains on public pages, while live production schema alignment, external services, and live production environment behavior remain open/unverified.

## 9. Diagram Preparation Reference

The following names are source-backed hierarchy labels only; use this block to prepare a module diagram.

```text
Public Website
  Hospital Information
  Department and Doctor Directory
  Public Appointment Booking
  Lab Report Verification

Authentication and Staff Identity
  Login and Session
  Password Recovery
  Staff Profile

Administration
  Dashboard
  User Management
  Settings
  Reports
  Audit Logs
  Backup and Restore

Patient Registry
  Patient Search and Registration
  Patient Profile and Clinical Summary
  Duplicate Merge
  Print Summary

Appointments and OPD Queue
  Appointment Scheduling
  Doctor Availability
  Queue Management
  Appointment Lifecycle

Clinical Care
  Consultation
  Vitals and Diagnosis
  Consultation Addenda
  ICD-10 Lookup

Prescriptions
  Prescription Items
  Templates
  Signing and Voiding
  Print and Sharing

Laboratory
  Test and Package Catalogue
  Orders and Samples
  Results and Verification
  Reports and Attachments
  Inventory
  Billing and Ledger
  Analytics and Settings

Ultrasound
  Orders and Queue
  Templates and Reports
  Imaging
  Review and Verification
  Amendments and Audit
  Analytics and Billing

Pharmacy
  Medicine Catalogue and Batches
  Stock and FEFO Dispensing
  Prescription Dispensing
  Point of Sale
  Returns and Voids
  Khata and Discount Audit
  Ward Medicine Issue

Billing
  Department Invoices
  Payments
  Refunds and Voids
  Billing History and Summary

Wards and IPD
  Ward, Room and Bed
  Admission and Transfer
  Bed Rent
  Service Charges
  Running and Final Bill
  Deposit and Settlement
  Ward Medicine
  Ward Rounds

Nursing
  Assignments
  Vitals
  Nursing Tasks

Operation Theatre
  OT Rooms
  Availability and Scheduling
  Checklists
  Surgery Lifecycle
  Surgery History

Shared Platform Services
  Notifications
  Audit Logging
  Private Files
  Health Check and API Documentation
```
