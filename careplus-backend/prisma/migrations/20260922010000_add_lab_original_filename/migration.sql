ALTER TABLE "lab_report_attachments"
ADD COLUMN "original_filename" TEXT;

UPDATE "lab_results"
SET "unit" = NULL
WHERE "unit" ~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$';
