UPDATE "appointments" a
SET "gender" = p."gender"
FROM "patients" p
WHERE a."patient_id" = p."id"
  AND a."gender" IS NULL;

ALTER TABLE "appointments" ALTER COLUMN "gender" SET NOT NULL;

DROP INDEX IF EXISTS "appointments_active_doctor_slot_unique";

CREATE UNIQUE INDEX "appointments_active_doctor_slot_unique"
ON "appointments" ("doctor_id", "appointment_date", "time_slot")
WHERE "status" NOT IN ('CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED');
