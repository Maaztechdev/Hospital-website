CREATE TYPE "MedicineUnitType" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'STRIP');

ALTER TABLE "medicines"
ADD COLUMN "unit_type" "MedicineUnitType" NOT NULL DEFAULT 'TABLET',
ADD COLUMN "manufacturer" TEXT;

ALTER TABLE "stock_movements"
ADD COLUMN "invoice_reference" TEXT;

-- Inventory has been batch-backed since the initial schema. Existing batch rows
-- and their quantities are retained unchanged; no single-stock field needs migration.
