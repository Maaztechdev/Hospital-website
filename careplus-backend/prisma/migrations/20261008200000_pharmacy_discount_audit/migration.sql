ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'VIEW';

CREATE TABLE "discount_audits" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "cashier_id" TEXT NOT NULL,
  "approving_admin_id" TEXT,
  "discount_percent" DECIMAL(7,4) NOT NULL,
  "discount_amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discount_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discount_audits_invoice_id_key" ON "discount_audits"("invoice_id");
CREATE INDEX "discount_audits_created_at_idx" ON "discount_audits"("created_at");
CREATE INDEX "discount_audits_cashier_id_created_at_idx" ON "discount_audits"("cashier_id", "created_at");

ALTER TABLE "discount_audits"
  ADD CONSTRAINT "discount_audits_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "discount_audits_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "discount_audits_approving_admin_id_fkey" FOREIGN KEY ("approving_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "settings" ("key", "value", "updated_at")
VALUES ('cashierMaxDiscountPercent', '10'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
