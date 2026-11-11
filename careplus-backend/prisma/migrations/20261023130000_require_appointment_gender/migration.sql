UPDATE "appointments" a
SET "gender" = p."gender"
FROM "patients" p
WHERE a."patient_id" = p."id"
  AND a."gender" IS NULL;

ALTER TABLE "appointments" ALTER COLUMN "gender" SET NOT NULL;
