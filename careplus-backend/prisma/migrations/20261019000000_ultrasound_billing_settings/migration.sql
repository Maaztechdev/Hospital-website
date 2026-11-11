ALTER TYPE "InvoiceItemType" ADD VALUE IF NOT EXISTS 'ULTRASOUND';

ALTER TABLE "ultrasound_orders"
  ADD COLUMN "invoice_id" TEXT;

CREATE UNIQUE INDEX "ultrasound_orders_invoice_id_key" ON "ultrasound_orders"("invoice_id");

ALTER TABLE "ultrasound_orders"
  ADD CONSTRAINT "ultrasound_orders_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hospital_profiles"
  ADD COLUMN "report_footer" TEXT;

INSERT INTO "settings" ("key", "value", "updated_at")
VALUES (
  'ultrasound.scanCatalog',
  '[{"name":"Obstetric","fee":0,"enabled":true},{"name":"Abdomen","fee":0,"enabled":true},{"name":"KUB","fee":0,"enabled":true},{"name":"Renal","fee":0,"enabled":true},{"name":"Pelvis","fee":0,"enabled":true},{"name":"Thyroid","fee":0,"enabled":true},{"name":"Breast","fee":0,"enabled":true},{"name":"Doppler","fee":0,"enabled":true},{"name":"Other","fee":0,"enabled":true}]'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
