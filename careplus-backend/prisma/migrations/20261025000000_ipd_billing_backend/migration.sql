DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "invoices"
        WHERE "admission_id" IS NOT NULL
        GROUP BY "admission_id"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce one IPD invoice per admission: duplicate admission invoice links exist';
    END IF;
END $$;

CREATE TYPE "PaymentPurpose" AS ENUM ('PAYMENT', 'DEPOSIT');

ALTER TABLE "payments"
    ADD COLUMN "purpose" "PaymentPurpose" NOT NULL DEFAULT 'PAYMENT';

ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_admission_id_key" UNIQUE ("admission_id"),
    ADD CONSTRAINT "invoices_admission_id_fkey"
        FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_items"
    ADD COLUMN "admission_id" TEXT,
    ADD COLUMN "bed_id" TEXT,
    ADD COLUMN "day_index" INTEGER,
    ADD COLUMN "service_category" TEXT,
    ADD COLUMN "service_date" DATE,
    ADD COLUMN "reversed_at" TIMESTAMP(3),
    ADD COLUMN "reversal_reason" TEXT,
    ADD COLUMN "reversed_by" TEXT,
    ADD COLUMN "reverses_item_id" TEXT;

CREATE UNIQUE INDEX "invoice_items_reverses_item_id_key" ON "invoice_items"("reverses_item_id");
CREATE UNIQUE INDEX "invoice_items_admission_id_day_index_key" ON "invoice_items"("admission_id", "day_index");
CREATE INDEX "invoice_items_admission_id_service_category_idx" ON "invoice_items"("admission_id", "service_category");
CREATE INDEX "invoice_items_bed_id_idx" ON "invoice_items"("bed_id");

ALTER TABLE "invoice_items"
    ADD CONSTRAINT "invoice_items_admission_id_fkey"
        FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoice_items_bed_id_fkey"
        FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admissions"
    ADD COLUMN "bed_rent_cutoff_time" TEXT;

ALTER TABLE "lab_orders"
    ADD COLUMN "admission_id" TEXT;
CREATE INDEX "lab_orders_admission_id_idx" ON "lab_orders"("admission_id");
ALTER TABLE "lab_orders"
    ADD CONSTRAINT "lab_orders_admission_id_fkey"
        FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ultrasound_orders"
    ADD COLUMN "admission_id" TEXT;
CREATE INDEX "ultrasound_orders_admission_id_idx" ON "ultrasound_orders"("admission_id");
ALTER TABLE "ultrasound_orders"
    ADD CONSTRAINT "ultrasound_orders_admission_id_fkey"
        FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_ledger_entries"
    ADD COLUMN "invoice_id" TEXT,
    ADD COLUMN "payment_id" TEXT;
CREATE INDEX "patient_ledger_entries_invoice_id_idx" ON "patient_ledger_entries"("invoice_id");
CREATE INDEX "patient_ledger_entries_payment_id_idx" ON "patient_ledger_entries"("payment_id");
ALTER TABLE "patient_ledger_entries"
    ADD CONSTRAINT "patient_ledger_entries_invoice_id_fkey"
        FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "patient_ledger_entries_payment_id_fkey"
        FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_charges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "default_price" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_charges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "service_charges_name_category_key" ON "service_charges"("name", "category");
CREATE INDEX "service_charges_category_is_active_idx" ON "service_charges"("category", "is_active");

CREATE TABLE "bed_rate_history" (
    "id" TEXT NOT NULL,
    "bed_id" TEXT NOT NULL,
    "daily_rate" DECIMAL(10,2) NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    CONSTRAINT "bed_rate_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bed_rate_history_bed_id_effective_at_idx" ON "bed_rate_history"("bed_id", "effective_at");
ALTER TABLE "bed_rate_history"
    ADD CONSTRAINT "bed_rate_history_bed_id_fkey"
        FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ward_medicine_orders" (
    "id" TEXT NOT NULL,
    "admission_id" TEXT NOT NULL,
    "ordered_by" TEXT NOT NULL,
    "order_note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    CONSTRAINT "ward_medicine_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ward_medicine_orders_admission_id_created_at_idx" ON "ward_medicine_orders"("admission_id", "created_at");
ALTER TABLE "ward_medicine_orders"
    ADD CONSTRAINT "ward_medicine_orders_admission_id_fkey"
        FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ward_medicine_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "medicine_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "issued_quantity" INTEGER NOT NULL DEFAULT 0,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(12,2),
    "invoice_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ward_medicine_order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ward_medicine_order_items_order_id_idx" ON "ward_medicine_order_items"("order_id");
ALTER TABLE "ward_medicine_order_items"
    ADD CONSTRAINT "ward_medicine_order_items_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "ward_medicine_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ward_medicine_order_items_medicine_id_fkey"
        FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "settings" ("key", "value", "updated_at")
VALUES ('ipd.bedRentCutoffTime', '"12:00"'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
