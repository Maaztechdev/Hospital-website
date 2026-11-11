-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "gender" "Gender";

-- Backfill existing appointments from patients table
UPDATE "appointments" a
SET "gender" = p."gender"
FROM "patients" p
WHERE a."patient_id" = p."id"
  AND a."gender" IS NULL;

ALTER TABLE "appointments" ALTER COLUMN "gender" SET NOT NULL;

-- CreateIndex
CREATE INDEX "appointments_doctor_id_appointment_date_time_slot_idx" ON "appointments"("doctor_id", "appointment_date", "time_slot");

-- Create partial unique index to strictly prevent double-booking of active/booked slots
CREATE UNIQUE INDEX "appointments_active_doctor_slot_unique"
ON "appointments" ("doctor_id", "appointment_date", "time_slot")
WHERE "status" NOT IN ('CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED');
