ALTER TABLE "medicines" ADD COLUMN "barcode" TEXT;

CREATE UNIQUE INDEX "medicines_barcode_key" ON "medicines"("barcode");
