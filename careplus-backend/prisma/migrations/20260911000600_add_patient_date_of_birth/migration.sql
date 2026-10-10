ALTER TABLE "patients" ADD COLUMN "date_of_birth" DATE;

ALTER TABLE "patients" ALTER COLUMN "age" DROP NOT NULL;