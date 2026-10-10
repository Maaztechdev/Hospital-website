CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'PAID');

ALTER TABLE "admissions"
  ADD COLUMN "admission_notes" TEXT,
  ADD COLUMN "deposit_status" "DepositStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "admissions" AS admission
SET "deposit_status" = 'PAID'
WHERE admission."deposit_amount" > 0
   OR EXISTS (
     SELECT 1
     FROM "patient_ledger_entries" AS ledger
     WHERE ledger."admission_id" = admission."id"
       AND ledger."type" = 'ADVANCE_DEPOSIT'
   );
