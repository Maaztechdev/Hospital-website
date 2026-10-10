ALTER TABLE "admissions"
ADD COLUMN "discharge_details" JSONB;

UPDATE "doctors" AS d
SET "specialization" = sp."specialization"
FROM "staff_profiles" AS sp
WHERE sp."user_id" = d."user_id"
  AND sp."specialization" IS NOT NULL;
