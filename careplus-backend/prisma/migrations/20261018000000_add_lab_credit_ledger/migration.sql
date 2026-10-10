CREATE TYPE "LabLedgerAccountType" AS ENUM ('RECEIVABLE', 'PAYABLE');
CREATE TYPE "LabLedgerPartyType" AS ENUM ('PATIENT', 'CLINIC', 'REFERENCE_LAB');
CREATE TYPE "LabLedgerEntryType" AS ENUM ('INVOICE_CHARGE', 'PAYMENT_RECEIVED', 'SEND_OUT_CHARGE', 'PAYMENT_MADE', 'ADJUSTMENT');

ALTER TABLE "lab_tests"
  ADD COLUMN "is_send_out" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reference_lab_supplier_id" TEXT,
  ADD COLUMN "send_out_cost" DECIMAL(10,2);

ALTER TABLE "lab_orders"
  ADD COLUMN "referring_clinic_account_id" TEXT;

CREATE TABLE "lab_ledger_accounts" (
  "id" TEXT NOT NULL,
  "type" "LabLedgerAccountType" NOT NULL,
  "party_type" "LabLedgerPartyType" NOT NULL,
  "patient_id" TEXT,
  "supplier_id" TEXT,
  "party_name" TEXT NOT NULL,
  "party_phone" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lab_ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_ledger_entries" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "type" "LabLedgerEntryType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "balance_after" DECIMAL(12,2) NOT NULL,
  "invoice_id" TEXT,
  "lab_order_id" TEXT,
  "payment_method" "PaymentMethod",
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lab_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lab_ledger_accounts_patient_id_key" ON "lab_ledger_accounts"("patient_id");
CREATE UNIQUE INDEX "lab_ledger_accounts_supplier_id_key" ON "lab_ledger_accounts"("supplier_id");
CREATE INDEX "lab_ledger_accounts_type_party_name_idx" ON "lab_ledger_accounts"("type", "party_name");
CREATE INDEX "lab_ledger_accounts_party_type_party_name_idx" ON "lab_ledger_accounts"("party_type", "party_name");
CREATE INDEX "lab_ledger_entries_invoice_id_idx" ON "lab_ledger_entries"("invoice_id");
CREATE UNIQUE INDEX "lab_ledger_entries_lab_order_id_key" ON "lab_ledger_entries"("lab_order_id");
CREATE INDEX "lab_ledger_entries_account_id_created_at_idx" ON "lab_ledger_entries"("account_id", "created_at");
CREATE INDEX "lab_ledger_entries_created_at_idx" ON "lab_ledger_entries"("created_at");
CREATE INDEX "lab_tests_reference_lab_supplier_id_idx" ON "lab_tests"("reference_lab_supplier_id");
CREATE INDEX "lab_orders_referring_clinic_account_id_idx" ON "lab_orders"("referring_clinic_account_id");

ALTER TABLE "lab_tests"
  ADD CONSTRAINT "lab_tests_reference_lab_supplier_id_fkey"
  FOREIGN KEY ("reference_lab_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lab_orders"
  ADD CONSTRAINT "lab_orders_referring_clinic_account_id_fkey"
  FOREIGN KEY ("referring_clinic_account_id") REFERENCES "lab_ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lab_ledger_accounts"
  ADD CONSTRAINT "lab_ledger_accounts_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lab_ledger_accounts_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lab_ledger_accounts_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_ledger_entries"
  ADD CONSTRAINT "lab_ledger_entries_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "lab_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lab_ledger_entries_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lab_ledger_entries_lab_order_id_fkey"
  FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lab_ledger_entries_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

WITH open_lab_invoices AS (
  SELECT i.*
  FROM "invoices" i
  WHERE i."patient_id" IS NOT NULL
    AND i."status" <> 'VOID'
    AND i."balance_amount" > 0
    AND (
      i."lab_package_id" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "lab_orders" lo WHERE lo."invoice_id" = i."id")
      OR EXISTS (SELECT 1 FROM "invoice_items" ii WHERE ii."invoice_id" = i."id" AND ii."item_type" = 'LAB')
    )
),
patient_accounts AS (
  SELECT DISTINCT ON (p."id")
    p."id" AS "patient_id",
    CONCAT(p."first_name", ' ', p."last_name") AS "party_name",
    p."phone" AS "party_phone",
    i."created_by" AS "created_by"
  FROM open_lab_invoices i
  JOIN "patients" p ON p."id" = i."patient_id"
  ORDER BY p."id", i."created_at", i."id"
)
INSERT INTO "lab_ledger_accounts" (
  "id", "type", "party_type", "patient_id", "party_name", "party_phone", "created_by", "created_at", "updated_at"
)
SELECT gen_random_uuid()::text, 'RECEIVABLE', 'PATIENT', "patient_id", "party_name", "party_phone", "created_by", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM patient_accounts
ON CONFLICT ("patient_id") DO NOTHING;

WITH open_lab_invoices AS (
  SELECT i.*
  FROM "invoices" i
  WHERE i."patient_id" IS NOT NULL
    AND i."status" <> 'VOID'
    AND i."balance_amount" > 0
    AND (
      i."lab_package_id" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "lab_orders" lo WHERE lo."invoice_id" = i."id")
      OR EXISTS (SELECT 1 FROM "invoice_items" ii WHERE ii."invoice_id" = i."id" AND ii."item_type" = 'LAB')
    )
),
open_invoice_balances AS (
  SELECT
    a."id" AS "account_id",
    i."id" AS "invoice_id",
    i."balance_amount" AS "amount",
    i."created_by" AS "created_by",
    i."created_at" AS "created_at",
    i."invoice_number" AS "invoice_number",
    SUM(i."balance_amount") OVER (PARTITION BY a."id" ORDER BY i."created_at", i."id") AS "balance_after"
  FROM open_lab_invoices i
  JOIN "lab_ledger_accounts" a ON a."patient_id" = i."patient_id"
)
INSERT INTO "lab_ledger_entries" (
  "id", "account_id", "type", "amount", "balance_after", "invoice_id", "notes", "created_by", "created_at"
)
SELECT
  gen_random_uuid()::text,
  "account_id",
  'INVOICE_CHARGE',
  "amount",
  "balance_after",
  "invoice_id",
  CONCAT('Opening balance imported from existing Lab invoice ', "invoice_number"),
  "created_by",
  "created_at"
FROM open_invoice_balances
WHERE NOT EXISTS (
  SELECT 1 FROM "lab_ledger_entries" existing WHERE existing."invoice_id" = open_invoice_balances."invoice_id" AND existing."type" = 'INVOICE_CHARGE'
);
