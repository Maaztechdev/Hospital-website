CREATE TABLE "prescription_shares" (
    "id" TEXT NOT NULL,
    "prescription_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "file_path" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prescription_shares_token_hash_key" ON "prescription_shares"("token_hash");
CREATE INDEX "prescription_shares_prescription_id_expires_at_idx" ON "prescription_shares"("prescription_id", "expires_at");

ALTER TABLE "prescription_shares"
ADD CONSTRAINT "prescription_shares_prescription_id_fkey"
FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
