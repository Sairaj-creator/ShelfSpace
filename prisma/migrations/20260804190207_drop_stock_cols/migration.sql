/*
  Warnings:

  - You are about to drop the column `low_stock_threshold` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `stock_qty` on the `products` table. All the data in the column will be lost.
  - Made the column `location_id` on table `order_items` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "location_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "low_stock_threshold",
DROP COLUMN "stock_qty";
