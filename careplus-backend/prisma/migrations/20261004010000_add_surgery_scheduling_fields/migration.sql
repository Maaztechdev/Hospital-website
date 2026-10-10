CREATE TYPE "SurgeryPriority" AS ENUM ('ELECTIVE', 'URGENT', 'EMERGENCY');

ALTER TABLE "surgeries"
ADD COLUMN "priority" "SurgeryPriority" NOT NULL DEFAULT 'ELECTIVE',
ADD COLUMN "anesthesia_type" TEXT,
ADD COLUMN "notes" TEXT,
ADD COLUMN "assistant_surgeon_id" TEXT;

ALTER TABLE "surgeries"
ADD CONSTRAINT "surgeries_assistant_surgeon_id_fkey"
FOREIGN KEY ("assistant_surgeon_id") REFERENCES "doctors"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "surgeries_assistant_surgeon_id_idx" ON "surgeries"("assistant_surgeon_id");
