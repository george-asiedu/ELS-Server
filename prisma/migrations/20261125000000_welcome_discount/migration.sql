-- AlterTable
ALTER TABLE "platform_config" ADD COLUMN     "newStudioDiscountMonths" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "reactivationFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "newStudioDiscountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
