-- AlterTable
ALTER TABLE "consultations" ADD COLUMN "follow_up_instructions" TEXT;

-- AlterTable
ALTER TABLE "prescriptions" ALTER COLUMN "consultation_id" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "prescriptions" DROP CONSTRAINT IF EXISTS "prescriptions_consultation_id_fkey";

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
