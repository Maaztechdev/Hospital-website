ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT';

CREATE TYPE "PharmacyLedgerAccountType" AS ENUM ('RECEIVABLE', 'PAYABLE');
CREATE TYPE "PharmacyLedgerEntryType" AS ENUM ('SALE_ON_CREDIT', 'PAYMENT_RECEIVED', 'PAYMENT_MADE', 'ADJUSTMENT');

CREATE TABLE "pharmacy_ledger_accounts" (
  "id" TEXT NOT NULL,
  "type" "PharmacyLedgerAccountType" NOT NULL DEFAULT 'RECEIVABLE',
  "patient_id" TEXT,
  "customer_name" TEXT NOT NULL,
  "customer_phone" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pharmacy_ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_ledger_entries" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "invoice_id" TEXT,
  "type" "PharmacyLedgerEntryType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "balance_after" DECIMAL(12,2) NOT NULL,
  "payment_method" "PaymentMethod",
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pharmacy_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pharmacy_ledger_accounts_patient_id_key" ON "pharmacy_ledger_accounts"("patient_id");
CREATE INDEX "pharmacy_ledger_accounts_type_customer_name_idx" ON "pharmacy_ledger_accounts"("type", "customer_name");
CREATE INDEX "pharmacy_ledger_accounts_customer_phone_idx" ON "pharmacy_ledger_accounts"("customer_phone");
CREATE INDEX "pharmacy_ledger_entries_account_id_created_at_idx" ON "pharmacy_ledger_entries"("account_id", "created_at");
CREATE INDEX "pharmacy_ledger_entries_invoice_id_idx" ON "pharmacy_ledger_entries"("invoice_id");

ALTER TABLE "pharmacy_ledger_accounts"
  ADD CONSTRAINT "pharmacy_ledger_accounts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pharmacy_ledger_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pharmacy_ledger_entries"
  ADD CONSTRAINT "pharmacy_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pharmacy_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pharmacy_ledger_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pharmacy_ledger_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
