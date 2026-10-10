CREATE TABLE "consultation_addenda" (
    "id" TEXT NOT NULL,
    "consultation_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_addenda_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consultation_addenda_consultation_id_created_at_idx"
    ON "consultation_addenda"("consultation_id", "created_at");

ALTER TABLE "consultation_addenda"
    ADD CONSTRAINT "consultation_addenda_consultation_id_fkey"
    FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consultation_addenda"
    ADD CONSTRAINT "consultation_addenda_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
