-- CreateIndex
CREATE INDEX IF NOT EXISTS "prescriptions_doctor_id_created_at_idx" ON "prescriptions"("doctor_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prescriptions_consultation_id_idx" ON "prescriptions"("consultation_id");
