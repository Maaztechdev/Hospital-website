ALTER TABLE "prescription_pad_configs"
    RENAME COLUMN "clinic_address" TO "clinicAddress";

ALTER TABLE "prescription_pad_configs"
    RENAME COLUMN "clinic_phone" TO "clinicPhone";

ALTER TABLE "prescription_pad_configs"
    RENAME COLUMN "clinic_email" TO "clinicEmail";

ALTER TABLE "prescription_pad_configs"
    RENAME COLUMN "doctor_name" TO "doctorName";

ALTER TABLE "prescription_pad_configs"
    RENAME COLUMN "doctor_qualification" TO "doctorQualification";

ALTER TABLE "prescription_pad_configs"
    RENAME COLUMN "doctor_specialization" TO "doctorSpecialization";
