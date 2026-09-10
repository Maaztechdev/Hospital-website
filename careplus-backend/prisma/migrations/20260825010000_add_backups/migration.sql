ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RESTORE';

CREATE TABLE "backups" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "backups_filename_key" ON "backups"("filename");
CREATE INDEX "backups_created_at_idx" ON "backups"("created_at");