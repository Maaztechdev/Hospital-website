-- CreateEnum
CREATE TYPE "UltrasoundOrderStatus" AS ENUM ('ORDERED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ULTRASOUND_TECHNICIAN';
ALTER TYPE "Role" ADD VALUE 'RADIOLOGIST';

-- CreateTable
CREATE TABLE "ultrasound_orders" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "technician_id" TEXT,
    "exam_type" TEXT NOT NULL,
    "status" "UltrasoundOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "scheduled_at" TIMESTAMP(3),
    "performed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "findings" TEXT,
    "impression" TEXT,
    "image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "priority" "Priority" NOT NULL DEFAULT 'ROUTINE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ultrasound_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ultrasound_orders_patient_id_idx" ON "ultrasound_orders"("patient_id");
CREATE INDEX "ultrasound_orders_doctor_id_idx" ON "ultrasound_orders"("doctor_id");
CREATE INDEX "ultrasound_orders_technician_id_idx" ON "ultrasound_orders"("technician_id");
CREATE INDEX "ultrasound_orders_status_scheduled_at_idx" ON "ultrasound_orders"("status", "scheduled_at");

ALTER TABLE "ultrasound_orders" ADD CONSTRAINT "ultrasound_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ultrasound_orders" ADD CONSTRAINT "ultrasound_orders_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ultrasound_orders" ADD CONSTRAINT "ultrasound_orders_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
