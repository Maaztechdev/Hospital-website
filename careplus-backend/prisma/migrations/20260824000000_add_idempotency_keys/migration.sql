ALTER TABLE "prescriptions" ADD COLUMN "sign_idempotency_key" TEXT;
CREATE UNIQUE INDEX "prescriptions_sign_idempotency_key_key" ON "prescriptions"("sign_idempotency_key");

ALTER TABLE "payments" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");