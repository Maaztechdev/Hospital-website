ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "sign_idempotency_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "prescriptions_sign_idempotency_key_key" ON "prescriptions"("sign_idempotency_key");

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_key" ON "payments"("idempotency_key");
