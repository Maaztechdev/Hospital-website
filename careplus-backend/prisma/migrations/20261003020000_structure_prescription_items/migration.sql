ALTER TABLE "prescription_items"
  ADD COLUMN "dose_amount" DOUBLE PRECISION,
  ADD COLUMN "dose_unit" TEXT,
  ADD COLUMN "frequency_code" TEXT,
  ADD COLUMN "duration_value" INTEGER,
  ADD COLUMN "duration_unit" TEXT;

ALTER TABLE "staff_profiles"
  ADD COLUMN "pmdc_registration_no" TEXT,
  ADD COLUMN "phc_registration_no" TEXT;

UPDATE "staff_profiles"
SET "pmdc_registration_no" = "registration_number"
WHERE "pmdc_registration_no" IS NULL
  AND "registration_number" IS NOT NULL;
