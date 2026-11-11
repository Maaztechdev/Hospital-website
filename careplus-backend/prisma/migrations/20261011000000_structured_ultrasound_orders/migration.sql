ALTER TABLE "ultrasound_orders"
  ADD COLUMN "structured_data" JSONB,
  ADD COLUMN "image_captions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
