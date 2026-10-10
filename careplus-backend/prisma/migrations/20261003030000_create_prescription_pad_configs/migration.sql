CREATE TABLE "prescription_pad_configs" (
    "id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "clinic_name" TEXT NOT NULL,
    "clinic_address" TEXT,
    "clinic_phone" TEXT,
    "clinic_email" TEXT,
    "doctor_name" TEXT,
    "doctor_qualification" TEXT,
    "doctor_specialization" TEXT,
    "pmdc_registration_no" TEXT,
    "phc_registration_no" TEXT,
    "other_registration_no" TEXT,
    "clinic_days_timings" TEXT,
    "refill_text" TEXT,
    "dispensing_stamp_text" TEXT,
    "logo_url" TEXT,
    "qr_code_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_pad_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prescription_pad_configs_doctor_id_key"
    ON "prescription_pad_configs"("doctor_id");

ALTER TABLE "prescription_pad_configs"
    ADD CONSTRAINT "prescription_pad_configs_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
