-- ─────────────────────────────────────────────────────────────
-- Migration: Add normalized CNIC, safe duplicate reporting,
-- partial unique index, and PARTIALLY_DISPENSED prescription status
-- ─────────────────────────────────────────────────────────────

-- 1. Enum update: add PARTIALLY_DISPENSED to PrescriptionStatus
ALTER TYPE "PrescriptionStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_DISPENSED';

-- 2. Safe duplicate reporting: inspect and report existing duplicate CNICs without deleting anything
DO $$
DECLARE
  r RECORD;
  dup_count INTEGER := 0;
BEGIN
  FOR r IN (
    SELECT regexp_replace(cnic, '\D', '', 'g') AS norm_cnic, count(*) AS cnt, string_agg("mr_number", ', ') AS mrs
    FROM "patients"
    WHERE cnic IS NOT NULL AND "deleted_at" IS NULL AND length(regexp_replace(cnic, '\D', '', 'g')) > 0
    GROUP BY regexp_replace(cnic, '\D', '', 'g')
    HAVING count(*) > 1
  ) LOOP
    dup_count := dup_count + 1;
    RAISE NOTICE '[CNIC Migration Report] Found existing duplicate CNIC % across MRs: % (count: %)', r.norm_cnic, r.mrs, r.cnt;
  END LOOP;
  IF dup_count > 0 THEN
    RAISE NOTICE '[CNIC Migration Report] Total duplicate CNIC groups reported: %. Existing records preserved without deletion.', dup_count;
  ELSE
    RAISE NOTICE '[CNIC Migration Report] No duplicate CNICs detected in existing patient records.';
  END IF;
END $$;

-- 3. Add column normalized_cnic
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "normalized_cnic" TEXT;

-- 4. Backfill existing normalized_cnic values from cnic
UPDATE "patients"
SET "normalized_cnic" = NULLIF(regexp_replace(cnic, '\D', '', 'g'), '')
WHERE cnic IS NOT NULL
  AND "normalized_cnic" IS DISTINCT FROM NULLIF(regexp_replace(cnic, '\D', '', 'g'), '');

-- 5. Create index and partial unique index on normalized_cnic (ignoring NULLs and soft-deleted records)
CREATE INDEX IF NOT EXISTS "patients_normalized_cnic_idx"
ON "patients" ("normalized_cnic");

CREATE UNIQUE INDEX IF NOT EXISTS "patients_normalized_cnic_unique"
ON "patients" ("normalized_cnic")
WHERE "normalized_cnic" IS NOT NULL AND "deleted_at" IS NULL;
