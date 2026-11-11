-- AlterTable
ALTER TABLE "surgeries" ADD COLUMN "admission_id" TEXT;

-- CreateIndex
CREATE INDEX "surgeries_admission_id_idx" ON "surgeries"("admission_id");

-- AddForeignKey
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
