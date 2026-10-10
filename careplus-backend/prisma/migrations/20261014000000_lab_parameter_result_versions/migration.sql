CREATE TYPE "LabParameterInterpretation" AS ENUM (
    'LOW',
    'NORMAL',
    'HIGH',
    'CRITICAL_LOW',
    'CRITICAL_HIGH'
);

ALTER TABLE "lab_orders"
ADD COLUMN "critical_result" BOOLEAN NOT NULL DEFAULT false;

UPDATE "lab_orders" AS orders
SET "critical_result" = true
WHERE EXISTS (
    SELECT 1
    FROM "lab_results" AS results
    WHERE results."lab_order_id" = orders."id"
      AND results."interpretation" = 'CRITICAL'
);

ALTER TABLE "lab_results"
ADD COLUMN "report_remarks" TEXT;

CREATE TABLE "lab_result_parameters" (
    "id" TEXT NOT NULL,
    "lab_result_id" TEXT NOT NULL,
    "parameter_id" TEXT,
    "parameter_name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "reference_range" TEXT,
    "computed_interpretation" "LabParameterInterpretation",
    "overridden_interpretation" "LabParameterInterpretation",
    "override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lab_result_parameters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lab_result_parameters_lab_result_id_idx"
ON "lab_result_parameters"("lab_result_id");
CREATE INDEX "lab_result_parameters_parameter_id_idx"
ON "lab_result_parameters"("parameter_id");

ALTER TABLE "lab_result_parameters"
ADD CONSTRAINT "lab_result_parameters_lab_result_id_fkey"
FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lab_result_parameters"
ADD CONSTRAINT "lab_result_parameters_parameter_id_fkey"
FOREIGN KEY ("parameter_id") REFERENCES "lab_test_parameters"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
