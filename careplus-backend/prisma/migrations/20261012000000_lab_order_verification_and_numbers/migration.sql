ALTER TABLE "lab_orders"
ADD COLUMN "order_number" TEXT,
ADD COLUMN "verified_by" TEXT;

WITH numbered_orders AS (
    SELECT
        "id",
        EXTRACT(YEAR FROM "ordered_at")::INTEGER AS order_year,
        ROW_NUMBER() OVER (
            PARTITION BY EXTRACT(YEAR FROM "ordered_at")
            ORDER BY "ordered_at", "id"
        ) AS order_sequence
    FROM "lab_orders"
)
UPDATE "lab_orders" AS orders
SET "order_number" =
    'LAB-' || numbered_orders.order_year::TEXT || '-' ||
    LPAD(numbered_orders.order_sequence::TEXT, 6, '0')
FROM numbered_orders
WHERE orders."id" = numbered_orders."id";

UPDATE "lab_orders" AS orders
SET
    "verified_by" = latest_results."verified_by",
    "verified_at" = COALESCE(orders."verified_at", latest_results."verified_at")
FROM (
    SELECT DISTINCT ON ("lab_order_id")
        "lab_order_id",
        "verified_by",
        "verified_at"
    FROM "lab_results"
    WHERE "verified_by" IS NOT NULL
    ORDER BY "lab_order_id", "created_at" DESC, "id" DESC
) AS latest_results
WHERE orders."id" = latest_results."lab_order_id";

ALTER TABLE "lab_orders"
ALTER COLUMN "order_number" SET NOT NULL;

CREATE UNIQUE INDEX "lab_orders_order_number_key"
ON "lab_orders"("order_number");

ALTER TABLE "lab_orders"
ADD CONSTRAINT "lab_orders_verified_by_fkey"
FOREIGN KEY ("verified_by") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lab_order_number_sequences" (
    "year" INTEGER NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "lab_order_number_sequences_pkey" PRIMARY KEY ("year")
);

INSERT INTO "lab_order_number_sequences" ("year", "counter")
SELECT
    SUBSTRING("order_number" FROM 5 FOR 4)::INTEGER,
    MAX(SUBSTRING("order_number" FROM 10)::INTEGER)
FROM "lab_orders"
WHERE "order_number" ~ '^LAB-[0-9]{4}-[0-9]+$'
GROUP BY SUBSTRING("order_number" FROM 5 FOR 4);
