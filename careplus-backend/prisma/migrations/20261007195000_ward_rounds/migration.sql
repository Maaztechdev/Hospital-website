CREATE TABLE "ward_rounds" (
    "id" TEXT NOT NULL,
    "admission_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "round_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjective" TEXT,
    "findings" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "vitals_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_at" TIMESTAMP(3),

    CONSTRAINT "ward_rounds_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "admissions"
    ADD COLUMN "ready_for_discharge" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ready_for_discharge_at" TIMESTAMP(3);

CREATE INDEX "ward_rounds_admission_id_round_at_idx" ON "ward_rounds"("admission_id", "round_at");
CREATE INDEX "ward_rounds_doctor_id_round_at_idx" ON "ward_rounds"("doctor_id", "round_at");

ALTER TABLE "ward_rounds" ADD CONSTRAINT "ward_rounds_admission_id_fkey"
    FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ward_rounds" ADD CONSTRAINT "ward_rounds_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
