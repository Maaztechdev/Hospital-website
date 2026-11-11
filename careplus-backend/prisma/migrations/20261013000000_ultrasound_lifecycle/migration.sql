ALTER TYPE "UltrasoundOrderStatus" RENAME VALUE 'COMPLETED' TO 'REPORTED';
ALTER TYPE "UltrasoundOrderStatus" ADD VALUE 'VERIFIED' AFTER 'REPORTED';
ALTER TYPE "UltrasoundOrderStatus" ADD VALUE 'DELIVERED' AFTER 'VERIFIED';
ALTER TYPE "Priority" ADD VALUE 'STAT';

ALTER TYPE "NotificationType" ADD VALUE 'ULTRASOUND_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'ULTRASOUND_REPORT_READY';

ALTER TABLE "ultrasound_orders"
  ADD COLUMN "verified_by_id" TEXT,
  ADD COLUMN "verified_by_name" TEXT,
  ADD COLUMN "verified_at" TIMESTAMP(3);

ALTER TABLE "ultrasound_orders"
  ADD CONSTRAINT "ultrasound_orders_verified_by_id_fkey"
  FOREIGN KEY ("verified_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ultrasound_report_amendments" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "old_values" JSONB NOT NULL,
  "new_values" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ultrasound_report_amendments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ultrasound_orders_verified_by_id_idx" ON "ultrasound_orders"("verified_by_id");
CREATE INDEX "ultrasound_report_amendments_order_id_created_at_idx" ON "ultrasound_report_amendments"("order_id", "created_at");

ALTER TABLE "ultrasound_report_amendments"
  ADD CONSTRAINT "ultrasound_report_amendments_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "ultrasound_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ultrasound_report_amendments"
  ADD CONSTRAINT "ultrasound_report_amendments_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
