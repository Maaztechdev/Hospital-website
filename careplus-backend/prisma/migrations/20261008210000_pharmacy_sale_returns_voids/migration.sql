ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'VOID';

CREATE TYPE "PharmacySaleAdjustmentType" AS ENUM ('VOID', 'RETURN');

CREATE TABLE "pharmacy_sale_adjustments" (
  "id" TEXT NOT NULL,
  "sale_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "type" "PharmacySaleAdjustmentType" NOT NULL,
  "reason" TEXT NOT NULL,
  "refund_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "void_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pharmacy_sale_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_sale_adjustment_items" (
  "id" TEXT NOT NULL,
  "adjustment_id" TEXT NOT NULL,
  "sale_item_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "returned_to_stock" BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT "pharmacy_sale_adjustment_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pharmacy_sale_adjustments_void_key_key" ON "pharmacy_sale_adjustments"("void_key");
CREATE INDEX "pharmacy_sale_adjustments_created_at_idx" ON "pharmacy_sale_adjustments"("created_at");
CREATE INDEX "pharmacy_sale_adjustments_type_created_at_idx" ON "pharmacy_sale_adjustments"("type", "created_at");
CREATE INDEX "pharmacy_sale_adjustments_invoice_id_idx" ON "pharmacy_sale_adjustments"("invoice_id");
CREATE INDEX "pharmacy_sale_adjustment_items_sale_item_id_idx" ON "pharmacy_sale_adjustment_items"("sale_item_id");
CREATE INDEX "pharmacy_sale_adjustment_items_adjustment_id_idx" ON "pharmacy_sale_adjustment_items"("adjustment_id");

ALTER TABLE "pharmacy_sale_adjustments"
  ADD CONSTRAINT "pharmacy_sale_adjustments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pharmacy_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pharmacy_sale_adjustments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pharmacy_sale_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pharmacy_sale_adjustment_items"
  ADD CONSTRAINT "pharmacy_sale_adjustment_items_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "pharmacy_sale_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pharmacy_sale_adjustment_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "pharmacy_sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pharmacy_sale_adjustment_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "medicine_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
