ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PATHOLOGIST';

CREATE TYPE "LabOrderEventType" AS ENUM (
    'ORDERED',
    'SAMPLE_COLLECTED',
    'PROCESSING',
    'RESULT_SAVED',
    'VERIFIED',
    'AMENDED',
    'PRINTED',
    'CANCELLED',
    'SAMPLE_REJECTED',
    'SAMPLE_RECOLLECTED'
);

CREATE TYPE "LabSampleRejectionReason" AS ENUM (
    'HAEMOLYSED',
    'INSUFFICIENT_QUANTITY',
    'WRONG_TUBE',
    'OTHER'
);

ALTER TABLE "lab_results"
    ADD COLUMN "amended_at" TIMESTAMP(3),
    ADD COLUMN "created_by" TEXT;

UPDATE "lab_results" AS results
SET "created_by" = audit."user_id"
FROM (
    SELECT DISTINCT ON ("entity_id") "entity_id", "user_id"
    FROM "audit_logs"
    WHERE "module" = 'lab'
      AND "entity_type" = 'LabResult'
      AND "user_id" IS NOT NULL
    ORDER BY "entity_id", "created_at" ASC
) AS audit
WHERE results."id" = audit."entity_id"
  AND results."created_by" IS NULL;

ALTER TABLE "lab_results"
    ADD CONSTRAINT "lab_results_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lab_order_events" (
    "id" TEXT NOT NULL,
    "lab_order_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "event_type" "LabOrderEventType" NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lab_order_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lab_order_events_lab_order_id_created_at_idx"
    ON "lab_order_events"("lab_order_id", "created_at");

ALTER TABLE "lab_order_events"
    ADD CONSTRAINT "lab_order_events_lab_order_id_fkey"
    FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "lab_order_events_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lab_sample_rejections" (
    "id" TEXT NOT NULL,
    "lab_order_id" TEXT NOT NULL,
    "reason" "LabSampleRejectionReason" NOT NULL,
    "other_reason" TEXT,
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recollected_by" TEXT,
    "recollected_at" TIMESTAMP(3),
    CONSTRAINT "lab_sample_rejections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lab_sample_rejections_lab_order_id_rejected_at_idx"
    ON "lab_sample_rejections"("lab_order_id", "rejected_at");

ALTER TABLE "lab_sample_rejections"
    ADD CONSTRAINT "lab_sample_rejections_lab_order_id_fkey"
    FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "lab_sample_rejections_rejected_by_fkey"
    FOREIGN KEY ("rejected_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "lab_sample_rejections_recollected_by_fkey"
    FOREIGN KEY ("recollected_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "lab_order_events" (
    "id", "lab_order_id", "actor_id", "event_type", "old_values", "new_values", "created_at"
)
SELECT
    audit."id",
    CASE
        WHEN audit."entity_type" = 'LabOrder' THEN audit."entity_id"
        ELSE results."lab_order_id"
    END,
    audit."user_id",
    CASE
        WHEN audit."entity_type" = 'LabOrder' AND audit."action" = 'CREATE' THEN 'ORDERED'::"LabOrderEventType"
        WHEN audit."entity_type" = 'LabOrder' AND audit."action" = 'VERIFY' THEN 'VERIFIED'::"LabOrderEventType"
        WHEN audit."entity_type" = 'LabOrder' AND audit."action" = 'STATUS_CHANGE'
            AND audit."new_values_json"->>'status' = 'SAMPLE_COLLECTED' THEN 'SAMPLE_COLLECTED'::"LabOrderEventType"
        WHEN audit."entity_type" = 'LabOrder' AND audit."action" = 'STATUS_CHANGE'
            AND audit."new_values_json"->>'status' = 'PROCESSING' THEN 'PROCESSING'::"LabOrderEventType"
        WHEN audit."entity_type" = 'LabOrder' AND audit."action" = 'STATUS_CHANGE'
            AND audit."new_values_json"->>'status' = 'CANCELLED' THEN 'CANCELLED'::"LabOrderEventType"
        WHEN audit."entity_type" = 'LabResult' AND results."amendment_reason" IS NOT NULL THEN 'AMENDED'::"LabOrderEventType"
        ELSE 'RESULT_SAVED'::"LabOrderEventType"
    END,
    CASE WHEN results."amendment_reason" IS NOT NULL THEN prior_audit."new_values_json" ELSE audit."old_values_json" END,
    audit."new_values_json",
    audit."created_at"
FROM "audit_logs" AS audit
LEFT JOIN "lab_results" AS results
    ON audit."entity_type" = 'LabResult'
   AND results."id" = audit."entity_id"
LEFT JOIN "lab_results" AS previous
    ON previous."superseded_by_id" = results."id"
LEFT JOIN LATERAL (
    SELECT prior."new_values_json"
    FROM "audit_logs" AS prior
    WHERE prior."module" = 'lab'
      AND prior."entity_type" = 'LabResult'
      AND prior."entity_id" = previous."id"
    ORDER BY prior."created_at" DESC
    LIMIT 1
) AS prior_audit ON true
WHERE audit."module" = 'lab'
  AND (
      (audit."entity_type" = 'LabOrder' AND audit."action" IN ('CREATE', 'VERIFY', 'STATUS_CHANGE'))
      OR (audit."entity_type" = 'LabResult' AND audit."action" = 'CREATE')
  )
  AND CASE WHEN audit."entity_type" = 'LabOrder' THEN audit."entity_id" ELSE results."lab_order_id" END IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_lab_order_event_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Lab order events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "lab_order_events_immutable"
    BEFORE UPDATE OR DELETE OR TRUNCATE ON "lab_order_events"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_lab_order_event_mutation();

INSERT INTO "settings" ("key", "value", "updated_at")
VALUES ('lab.allow_same_user_enter_verify', 'false'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
