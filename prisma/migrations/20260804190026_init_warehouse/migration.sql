-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "location_id" TEXT;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "low_stock_threshold" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locations_org_id_idx" ON "locations"("org_id");

-- CreateIndex
CREATE INDEX "inventory_levels_product_id_idx" ON "inventory_levels"("product_id");

-- CreateIndex
CREATE INDEX "inventory_levels_location_id_idx" ON "inventory_levels"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_levels_product_id_location_id_key" ON "inventory_levels"("product_id", "location_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BACKFILL SCRIPT

-- 1. Create a default Main Warehouse for each organization
INSERT INTO "locations" ("id", "org_id", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", 'Main Warehouse', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations";

-- 2. Migrate stock_qty from products to inventory_levels mapping to the Main Warehouse
INSERT INTO "inventory_levels" ("id", "product_id", "location_id", "stock_qty", "low_stock_threshold", "updated_at")
SELECT gen_random_uuid(), p."id", l."id", p."stock_qty", p."low_stock_threshold", CURRENT_TIMESTAMP
FROM "products" p
JOIN "locations" l ON p."org_id" = l."org_id"
WHERE l."name" = 'Main Warehouse';
