ALTER TYPE "OTStatus" ADD VALUE 'POSTPONED';
ALTER TYPE "NotificationType" ADD VALUE 'OT_STATUS_CHANGED';

ALTER TABLE "surgeries"
  ADD COLUMN "pre_op_started_at" TIMESTAMP(3),
  ADD COLUMN "pre_op_started_by" TEXT,
  ADD COLUMN "actual_start_at" TIMESTAMP(3),
  ADD COLUMN "started_by" TEXT,
  ADD COLUMN "actual_end_at" TIMESTAMP(3),
  ADD COLUMN "ended_by" TEXT,
  ADD COLUMN "emergency_override_reason" TEXT,
  ADD COLUMN "intraoperative_notes" TEXT,
  ADD COLUMN "outcome_notes" TEXT,
  ADD COLUMN "postpone_reason" TEXT;

CREATE TABLE "surgery_status_events" (
  "id" TEXT NOT NULL,
  "surgery_id" TEXT NOT NULL,
  "from_status" "OTStatus",
  "to_status" "OTStatus" NOT NULL,
  "changed_by" TEXT NOT NULL,
  "actor_name" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "surgery_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surgery_status_events_surgery_id_created_at_idx"
  ON "surgery_status_events"("surgery_id", "created_at");

ALTER TABLE "surgery_status_events"
  ADD CONSTRAINT "surgery_status_events_surgery_id_fkey"
  FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
