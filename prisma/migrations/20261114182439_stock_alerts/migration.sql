-- AlterTable
ALTER TABLE "commerce_settings" ADD COLUMN     "lowStockThreshold" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "lowStockAlertedAt" TIMESTAMP(3);
