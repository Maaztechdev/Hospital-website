ALTER TABLE "consultations"
  ADD COLUMN "is_critical" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "critical_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vitals_estimated" BOOLEAN NOT NULL DEFAULT false;
