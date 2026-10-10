ALTER TABLE "patients"
  ADD COLUMN "allergies_reviewed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "chronic_conditions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "chronic_conditions_reviewed" BOOLEAN NOT NULL DEFAULT false;
