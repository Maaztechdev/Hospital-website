ALTER TABLE "lab_orders" ADD COLUMN "consultation_id" TEXT;
ALTER TABLE "ultrasound_orders" ADD COLUMN "consultation_id" TEXT;

CREATE INDEX "lab_orders_consultation_id_idx" ON "lab_orders"("consultation_id");
CREATE INDEX "ultrasound_orders_consultation_id_idx" ON "ultrasound_orders"("consultation_id");

ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ultrasound_orders" ADD CONSTRAINT "ultrasound_orders_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
