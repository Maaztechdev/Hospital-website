ALTER TABLE "invoices" ALTER COLUMN "patient_id" DROP NOT NULL;

CREATE TABLE "pharmacy_sales" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "cashier_id" TEXT NOT NULL,
  "customer_name" TEXT,
  "customer_phone" TEXT,
  "payment_method" "PaymentMethod" NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(12,2) NOT NULL,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pharmacy_sales_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pharmacy_sales_invoice_id_key" ON "pharmacy_sales"("invoice_id");
CREATE UNIQUE INDEX "pharmacy_sales_idempotency_key_key" ON "pharmacy_sales"("idempotency_key");
CREATE INDEX "pharmacy_sales_created_at_idx" ON "pharmacy_sales"("created_at");

CREATE TABLE "pharmacy_sale_items" (
  "id" TEXT NOT NULL,
  "sale_id" TEXT NOT NULL,
  "medicine_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "pharmacy_sale_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pharmacy_sale_items_sale_id_idx" ON "pharmacy_sale_items"("sale_id");
CREATE INDEX "pharmacy_sale_items_medicine_id_idx" ON "pharmacy_sale_items"("medicine_id");

ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sale_items" ADD CONSTRAINT "pharmacy_sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pharmacy_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sale_items" ADD CONSTRAINT "pharmacy_sale_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sale_items" ADD CONSTRAINT "pharmacy_sale_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "medicine_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
