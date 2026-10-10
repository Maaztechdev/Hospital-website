CREATE TYPE "PatientLedgerEntryType" AS ENUM ('ADVANCE_DEPOSIT');

CREATE TABLE "patient_ledger_entries" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "admission_id" TEXT NOT NULL,
    "type" "PatientLedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "patient_ledger_entries_patient_id_created_at_idx"
    ON "patient_ledger_entries"("patient_id", "created_at");
CREATE INDEX "patient_ledger_entries_admission_id_idx"
    ON "patient_ledger_entries"("admission_id");

CREATE UNIQUE INDEX "admissions_one_active_per_patient_idx"
    ON "admissions"("patient_id")
    WHERE "status" = 'ACTIVE';

ALTER TABLE "patient_ledger_entries"
    ADD CONSTRAINT "patient_ledger_entries_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_ledger_entries"
    ADD CONSTRAINT "patient_ledger_entries_admission_id_fkey"
    FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_ledger_entries"
    ADD CONSTRAINT "patient_ledger_entries_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
