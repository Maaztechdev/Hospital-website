ALTER TABLE "prescription_items"
  ADD COLUMN "is_catalog_item" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requires_pharmacist_review" BOOLEAN NOT NULL DEFAULT false;

UPDATE "prescription_items"
SET "is_catalog_item" = false,
    "requires_pharmacist_review" = true
WHERE "medicine_id" IS NULL;
