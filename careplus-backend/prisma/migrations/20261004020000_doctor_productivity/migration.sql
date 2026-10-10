ALTER TABLE "consultations" ADD COLUMN "diagnosis_code" TEXT;

CREATE TABLE "prescription_templates" (
    "id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prescription_templates_doctor_id_name_key"
ON "prescription_templates"("doctor_id", "name");

CREATE INDEX "prescription_templates_doctor_id_updated_at_idx"
ON "prescription_templates"("doctor_id", "updated_at");

ALTER TABLE "prescription_templates"
ADD CONSTRAINT "prescription_templates_doctor_id_fkey"
FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
