-- CreateEnum
CREATE TYPE "UltrasoundReportStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateTable
CREATE TABLE "ultrasound_report_templates" (
    "id" TEXT NOT NULL,
    "examination_type" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ultrasound_report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ultrasound_reports" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "ordered_by_doctor_id" TEXT NOT NULL,
    "performed_by_user_id" TEXT,
    "template_id" TEXT,
    "examination_type" TEXT NOT NULL,
    "patient_snapshot" JSONB NOT NULL,
    "section_values" JSONB NOT NULL DEFAULT '{}',
    "conclusion" TEXT,
    "status" "UltrasoundReportStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ultrasound_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ultrasound_report_templates_examination_type_key" ON "ultrasound_report_templates"("examination_type");
CREATE INDEX "ultrasound_reports_patient_id_idx" ON "ultrasound_reports"("patient_id");
CREATE INDEX "ultrasound_reports_ordered_by_doctor_id_idx" ON "ultrasound_reports"("ordered_by_doctor_id");
CREATE INDEX "ultrasound_reports_performed_by_user_id_idx" ON "ultrasound_reports"("performed_by_user_id");
CREATE INDEX "ultrasound_reports_status_created_at_idx" ON "ultrasound_reports"("status", "created_at");

-- AddForeignKey
ALTER TABLE "ultrasound_reports"
    ADD CONSTRAINT "ultrasound_reports_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ultrasound_reports"
    ADD CONSTRAINT "ultrasound_reports_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ultrasound_reports"
    ADD CONSTRAINT "ultrasound_reports_ordered_by_doctor_id_fkey"
    FOREIGN KEY ("ordered_by_doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ultrasound_reports"
    ADD CONSTRAINT "ultrasound_reports_performed_by_user_id_fkey"
    FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ultrasound_reports"
    ADD CONSTRAINT "ultrasound_reports_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "ultrasound_report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default template
INSERT INTO "ultrasound_report_templates" (
    "id",
    "examination_type",
    "sections",
    "is_active",
    "created_at",
    "updated_at"
) VALUES (
    gen_random_uuid(),
    'USG KUB (Kidneys, Ureters, Urinary Bladder)',
    '[
      {"label":"Right Kidney","defaultText":"Measures {{size}} cm in size. Normal in size and shape. Cortical thickness is normal. Corticomedullary differentiation is maintained. No calculus or hydronephrosis seen. No renal mass.","fields":[{"key":"size","label":"Size","unit":"cm","type":"number"}]},
      {"label":"Left Kidney","defaultText":"Measures {{size}} cm in size. Normal in size and shape. Cortical thickness is normal. Corticomedullary differentiation is maintained. No calculus or hydronephrosis seen. No renal mass.","fields":[{"key":"size","label":"Size","unit":"cm","type":"number"}]},
      {"label":"Ureters","defaultText":"Not dilated. No calculus seen along the visualized course of both ureters.","fields":[]},
      {"label":"Urinary Bladder","defaultText":"Well distended. Wall thickness is normal. No intraluminal mass or calculus seen.","fields":[]},
      {"label":"Prostate","defaultText":"Enlarged in size measuring {{weight}} gm. Contour is smooth. Echodtexture is homogenous. No focal lesion seen.","fields":[{"key":"weight","label":"Weight","unit":"gm","type":"number"}],"conditional":{"field":"sex","equals":"Male"}},
      {"label":"Pre-void & Post-void","defaultText":"Pre-void urine volume: {{preVoidVolume}} ml • Post-void residual urine: {{postVoidResidual}} ml","fields":[{"key":"preVoidVolume","label":"Pre-void urine volume","unit":"ml","type":"number"},{"key":"postVoidResidual","label":"Post-void residual urine","unit":"ml","type":"number"}]},
      {"label":"Free Text","defaultText":"No ascites or loculated fluid seen. No enlarged lymph nodes or any other abdominal/pelvic pathology detected.","fields":[{"key":"notes","label":"Findings","unit":"","type":"textarea"}]},
      {"label":"Conclusion","defaultText":"Normal USG KUB study.","fields":[{"key":"conclusion","label":"Conclusion","unit":"","type":"textarea"}]}
    ]',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("examination_type") DO NOTHING;
