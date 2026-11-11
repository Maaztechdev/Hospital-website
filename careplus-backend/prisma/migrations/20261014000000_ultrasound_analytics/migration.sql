ALTER TABLE "ultrasound_orders"
  ADD COLUMN "fee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE INDEX "ultrasound_orders_created_at_idx" ON "ultrasound_orders"("created_at");
CREATE INDEX "ultrasound_orders_priority_created_at_idx" ON "ultrasound_orders"("priority", "created_at");
CREATE INDEX "ultrasound_orders_status_created_at_idx" ON "ultrasound_orders"("status", "created_at");
