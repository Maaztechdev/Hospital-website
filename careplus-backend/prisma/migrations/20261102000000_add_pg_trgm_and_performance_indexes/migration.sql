-- Extension: pg_trgm for fast infix/substring pattern matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Patient infix search GIN trigram indexes
CREATE INDEX IF NOT EXISTS "idx_patients_first_name_trgm" ON "patients" USING gin ("first_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_patients_last_name_trgm" ON "patients" USING gin ("last_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_patients_phone_trgm" ON "patients" USING gin ("phone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_patients_mr_number_trgm" ON "patients" USING gin ("mr_number" gin_trgm_ops);

-- Appointments keyset pagination index (cursor on created_at, id)
CREATE INDEX IF NOT EXISTS "idx_appointments_keyset" ON "appointments" ("created_at" DESC, "id" DESC);

-- Prescriptions status and active ordering index
CREATE INDEX IF NOT EXISTS "idx_prescriptions_status_active_created" ON "prescriptions" ("status", "created_at" DESC) WHERE "deleted_at" IS NULL;

