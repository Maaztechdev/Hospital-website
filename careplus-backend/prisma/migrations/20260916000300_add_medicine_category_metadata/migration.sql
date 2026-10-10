ALTER TABLE "medicine_categories" ADD COLUMN "description" TEXT;
ALTER TABLE "medicine_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;