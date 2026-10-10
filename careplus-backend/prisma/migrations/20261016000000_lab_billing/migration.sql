ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ONLINE';

ALTER TABLE "lab_orders"
ADD COLUMN "invoice_id" TEXT;

ALTER TABLE "invoices"
ADD COLUMN "voided_by" TEXT,
ADD COLUMN "discount_applied_by" TEXT,
ADD COLUMN "discount_approved_by" TEXT,
ADD COLUMN "lab_package_id" TEXT;

CREATE INDEX "lab_orders_invoice_id_idx" ON "lab_orders"("invoice_id");
CREATE INDEX "invoices_lab_package_id_idx" ON "invoices"("lab_package_id");

ALTER TABLE "lab_orders"
ADD CONSTRAINT "lab_orders_invoice_id_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_lab_package_id_fkey"
FOREIGN KEY ("lab_package_id") REFERENCES "lab_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "settings" ("key", "value", "updated_at")
VALUES ('lab.require_payment_before_collection', 'false'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
