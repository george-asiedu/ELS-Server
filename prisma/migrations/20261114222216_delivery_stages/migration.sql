-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PREPARING';
ALTER TYPE "OrderStatus" ADD VALUE 'READY_FOR_PICKUP';
ALTER TYPE "OrderStatus" ADD VALUE 'OUT_FOR_DELIVERY';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryEta" VARCHAR(60),
ADD COLUMN     "deliveryFailReason" VARCHAR(200),
ADD COLUMN     "deliveryFailedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryNote" VARCHAR(300),
ADD COLUMN     "handoverCode" TEXT,
ADD COLUMN     "riderToken" TEXT,
ADD COLUMN     "riderTokenExpires" TIMESTAMP(3),
ADD COLUMN     "statusUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "orders_riderToken_key" ON "orders"("riderToken");

