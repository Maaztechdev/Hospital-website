ALTER TABLE "hospital_profiles" ADD COLUMN "pmdc_registration_no" TEXT;
ALTER TABLE "hospital_profiles" ADD COLUMN "phc_registration_no" TEXT;
ALTER TABLE "hospital_profiles" ADD COLUMN "phc_rl_no" TEXT;
ALTER TABLE "hospital_profiles" ADD COLUMN "clinic_days_timings" TEXT;
ALTER TABLE "hospital_profiles" ADD COLUMN "refill_text" TEXT;
ALTER TABLE "hospital_profiles" ADD COLUMN "dispensing_stamp_text" TEXT;
ALTER TABLE "consultations" ADD COLUMN "findings" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN "refill_number" INTEGER NOT NULL DEFAULT 0;