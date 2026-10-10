ALTER TABLE "consultations"
  ADD COLUMN "bp_systolic" INTEGER,
  ADD COLUMN "bp_diastolic" INTEGER,
  ADD COLUMN "temperature" DOUBLE PRECISION,
  ADD COLUMN "temperature_unit" TEXT,
  ADD COLUMN "pulse" INTEGER,
  ADD COLUMN "weight" DOUBLE PRECISION,
  ADD COLUMN "oxygen_saturation" INTEGER,
  ADD COLUMN "respiratory_rate" INTEGER,
  ADD COLUMN "height_cm" DOUBLE PRECISION;

UPDATE "consultations"
SET
  "bp_systolic" = CASE
    WHEN jsonb_typeof("vitals_json"->'bp_systolic') = 'number'
      THEN ("vitals_json"->>'bp_systolic')::INTEGER
    WHEN jsonb_typeof("vitals_json"->'bp') = 'string'
      AND "vitals_json"->>'bp' ~ '^\s*[0-9]{1,3}\s*/\s*[0-9]{1,3}\s*$'
      THEN (regexp_match("vitals_json"->>'bp', '^\s*([0-9]{1,3})\s*/\s*([0-9]{1,3})\s*$'))[1]::INTEGER
    ELSE NULL
  END,
  "bp_diastolic" = CASE
    WHEN jsonb_typeof("vitals_json"->'bp_diastolic') = 'number'
      THEN ("vitals_json"->>'bp_diastolic')::INTEGER
    WHEN jsonb_typeof("vitals_json"->'bp') = 'string'
      AND "vitals_json"->>'bp' ~ '^\s*[0-9]{1,3}\s*/\s*[0-9]{1,3}\s*$'
      THEN (regexp_match("vitals_json"->>'bp', '^\s*([0-9]{1,3})\s*/\s*([0-9]{1,3})\s*$'))[2]::INTEGER
    ELSE NULL
  END,
  "temperature" = CASE
    WHEN jsonb_typeof("vitals_json"->'temperature') = 'number' THEN ("vitals_json"->>'temperature')::DOUBLE PRECISION
    WHEN jsonb_typeof("vitals_json"->'temperature') = 'string' AND "vitals_json"->>'temperature' ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN ("vitals_json"->>'temperature')::DOUBLE PRECISION
    ELSE NULL
  END,
  "temperature_unit" = CASE
    WHEN jsonb_typeof("vitals_json"->'temperature') IN ('number', 'string') THEN 'F'
    ELSE NULL
  END,
  "pulse" = CASE
    WHEN jsonb_typeof("vitals_json"->'pulse') = 'number' THEN ("vitals_json"->>'pulse')::INTEGER
    WHEN jsonb_typeof("vitals_json"->'pulse') = 'string' AND "vitals_json"->>'pulse' ~ '^[0-9]+$'
      THEN ("vitals_json"->>'pulse')::INTEGER
    ELSE NULL
  END,
  "weight" = CASE
    WHEN jsonb_typeof("vitals_json"->'weight') = 'number' THEN ("vitals_json"->>'weight')::DOUBLE PRECISION
    WHEN jsonb_typeof("vitals_json"->'weight') = 'string' AND "vitals_json"->>'weight' ~ '^[0-9]+(\.[0-9]+)?$'
      THEN ("vitals_json"->>'weight')::DOUBLE PRECISION
    ELSE NULL
  END,
  "oxygen_saturation" = CASE
    WHEN jsonb_typeof("vitals_json"->'oxygen_saturation') = 'number' THEN ("vitals_json"->>'oxygen_saturation')::INTEGER
    WHEN jsonb_typeof("vitals_json"->'spo2') = 'number' THEN ("vitals_json"->>'spo2')::INTEGER
    ELSE NULL
  END,
  "respiratory_rate" = CASE
    WHEN jsonb_typeof("vitals_json"->'respiratory_rate') = 'number' THEN ("vitals_json"->>'respiratory_rate')::INTEGER
    WHEN jsonb_typeof("vitals_json"->'respiratoryRate') = 'number' THEN ("vitals_json"->>'respiratoryRate')::INTEGER
    ELSE NULL
  END,
  "height_cm" = CASE
    WHEN jsonb_typeof("vitals_json"->'height_cm') = 'number'
      THEN ("vitals_json"->>'height_cm')::DOUBLE PRECISION
    ELSE NULL
  END
WHERE "vitals_json" IS NOT NULL;
