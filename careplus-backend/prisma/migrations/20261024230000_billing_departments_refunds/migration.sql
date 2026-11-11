CREATE TYPE "InvoiceDepartment" AS ENUM ('RECEPTION', 'LAB', 'PHARMACY', 'ULTRASOUND', 'IPD');
CREATE TYPE "PaymentType" AS ENUM ('PAYMENT', 'REFUND');

ALTER TYPE "InvoiceStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIALLY_REFUNDED';

CREATE TABLE "invoice_department_sequences" (
    "department" "InvoiceDepartment" NOT NULL,
    "year" INTEGER NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "invoice_department_sequences_pkey" PRIMARY KEY ("department", "year")
);

ALTER TABLE "invoices"
    ADD COLUMN "department" "InvoiceDepartment",
    ADD COLUMN "appointment_id" TEXT,
    ADD COLUMN "admission_id" TEXT;

CREATE INDEX "invoices_department_created_at_idx" ON "invoices"("department", "created_at");
CREATE INDEX "invoices_appointment_id_idx" ON "invoices"("appointment_id");
CREATE INDEX "invoices_admission_id_idx" ON "invoices"("admission_id");

ALTER TABLE "invoice_items"
    ADD COLUMN "source_type" TEXT,
    ADD COLUMN "source_id" TEXT,
    ADD COLUMN "source_department" "InvoiceDepartment";

CREATE INDEX "invoice_items_source_department_idx" ON "invoice_items"("source_department");
CREATE INDEX "invoice_items_source_type_source_id_idx" ON "invoice_items"("source_type", "source_id");

ALTER TABLE "payments"
    ADD COLUMN "type" "PaymentType" NOT NULL DEFAULT 'PAYMENT',
    ADD COLUMN "reason" TEXT;
