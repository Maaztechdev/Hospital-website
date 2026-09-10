-- Department management fields are additive and preserve existing rows.
CREATE TYPE "DepartmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "departments"
  ADD COLUMN "hod_id" TEXT,
  ADD COLUMN "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "icon" TEXT;

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_hod_id_fkey"
  FOREIGN KEY ("hod_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "departments_status_idx" ON "departments"("status");
CREATE INDEX "departments_hod_id_idx" ON "departments"("hod_id");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
