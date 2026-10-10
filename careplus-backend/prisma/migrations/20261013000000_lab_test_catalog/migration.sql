CREATE TYPE "LabParameterResultType" AS ENUM ('NUMERIC', 'TEXT', 'CHOICE');
CREATE TYPE "LabReferenceGender" AS ENUM ('MALE', 'FEMALE', 'ANY');

CREATE TABLE "lab_test_parameters" (
    "id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "result_type" "LabParameterResultType" NOT NULL DEFAULT 'NUMERIC',
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lab_test_parameters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_reference_ranges" (
    "id" TEXT NOT NULL,
    "parameter_id" TEXT NOT NULL,
    "gender" "LabReferenceGender" NOT NULL DEFAULT 'ANY',
    "age_min_days" INTEGER,
    "age_max_days" INTEGER,
    "low" DECIMAL(12,4),
    "high" DECIMAL(12,4),
    "critical_low" DECIMAL(12,4),
    "critical_high" DECIMAL(12,4),
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lab_reference_ranges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lab_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_package_tests" (
    "package_id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lab_package_tests_pkey" PRIMARY KEY ("package_id","test_id")
);

-- Existing lab_test rows, values, and lab_order.test_id foreign keys remain unchanged.

CREATE UNIQUE INDEX "lab_test_parameters_test_id_name_key"
ON "lab_test_parameters"("test_id", "name");
CREATE INDEX "lab_test_parameters_test_id_is_active_display_order_idx"
ON "lab_test_parameters"("test_id", "is_active", "display_order");
CREATE INDEX "lab_reference_ranges_parameter_id_gender_is_active_idx"
ON "lab_reference_ranges"("parameter_id", "gender", "is_active");
CREATE UNIQUE INDEX "lab_packages_name_key" ON "lab_packages"("name");
CREATE INDEX "lab_package_tests_test_id_idx" ON "lab_package_tests"("test_id");

ALTER TABLE "lab_test_parameters"
ADD CONSTRAINT "lab_test_parameters_test_id_fkey"
FOREIGN KEY ("test_id") REFERENCES "lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_reference_ranges"
ADD CONSTRAINT "lab_reference_ranges_parameter_id_fkey"
FOREIGN KEY ("parameter_id") REFERENCES "lab_test_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_package_tests"
ADD CONSTRAINT "lab_package_tests_package_id_fkey"
FOREIGN KEY ("package_id") REFERENCES "lab_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_package_tests"
ADD CONSTRAINT "lab_package_tests_test_id_fkey"
FOREIGN KEY ("test_id") REFERENCES "lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
