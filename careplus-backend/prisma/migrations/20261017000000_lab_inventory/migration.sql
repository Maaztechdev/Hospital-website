CREATE TYPE "LabInventoryMovementType" AS ENUM ('IN', 'OUT', 'ADJUSTMENT');

CREATE TABLE "lab_inventory_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "reorder_level" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "supplier_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lab_inventory_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_inventory_batches" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "expiry_date" DATE NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "purchase_price" DECIMAL(12,2) NOT NULL,
    "supplier_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lab_inventory_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_test_inventory_mappings" (
    "id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity_per_test_run" DECIMAL(12,3) NOT NULL,
    CONSTRAINT "lab_test_inventory_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_inventory_consumptions" (
    "id" TEXT NOT NULL,
    "lab_order_id" TEXT NOT NULL,
    "result_id" TEXT NOT NULL,
    "override_reason" TEXT,
    "details" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lab_inventory_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_inventory_movements" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "movement_type" "LabInventoryMovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lab_inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lab_inventory_items_name_idx" ON "lab_inventory_items"("name");
CREATE INDEX "lab_inventory_items_is_active_idx" ON "lab_inventory_items"("is_active");
CREATE UNIQUE INDEX "lab_inventory_batches_item_id_batch_number_key" ON "lab_inventory_batches"("item_id", "batch_number");
CREATE INDEX "lab_inventory_batches_item_id_expiry_date_idx" ON "lab_inventory_batches"("item_id", "expiry_date");
CREATE UNIQUE INDEX "lab_test_inventory_mappings_test_id_item_id_key" ON "lab_test_inventory_mappings"("test_id", "item_id");
CREATE INDEX "lab_test_inventory_mappings_test_id_idx" ON "lab_test_inventory_mappings"("test_id");
CREATE UNIQUE INDEX "lab_inventory_consumptions_lab_order_id_key" ON "lab_inventory_consumptions"("lab_order_id");
CREATE UNIQUE INDEX "lab_inventory_consumptions_result_id_key" ON "lab_inventory_consumptions"("result_id");
CREATE INDEX "lab_inventory_consumptions_created_at_idx" ON "lab_inventory_consumptions"("created_at");
CREATE INDEX "lab_inventory_movements_batch_id_created_at_idx" ON "lab_inventory_movements"("batch_id", "created_at");
CREATE INDEX "lab_inventory_movements_created_at_idx" ON "lab_inventory_movements"("created_at");

ALTER TABLE "lab_inventory_items" ADD CONSTRAINT "lab_inventory_items_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lab_inventory_batches" ADD CONSTRAINT "lab_inventory_batches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "lab_inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_inventory_batches" ADD CONSTRAINT "lab_inventory_batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lab_test_inventory_mappings" ADD CONSTRAINT "lab_test_inventory_mappings_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_test_inventory_mappings" ADD CONSTRAINT "lab_test_inventory_mappings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "lab_inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_inventory_consumptions" ADD CONSTRAINT "lab_inventory_consumptions_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_inventory_consumptions" ADD CONSTRAINT "lab_inventory_consumptions_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "lab_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_inventory_consumptions" ADD CONSTRAINT "lab_inventory_consumptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_inventory_movements" ADD CONSTRAINT "lab_inventory_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lab_inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_inventory_movements" ADD CONSTRAINT "lab_inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
