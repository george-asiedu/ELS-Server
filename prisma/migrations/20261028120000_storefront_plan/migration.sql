-- AlterEnum
ALTER TYPE "StudioPlan" ADD VALUE 'STOREFRONT';

-- AlterTable
ALTER TABLE "platform_config" ADD COLUMN     "commissionStorefrontPercent" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "priceStorefrontMonthly" DOUBLE PRECISION,
ADD COLUMN     "priceStorefrontYearly" DOUBLE PRECISION,
ADD COLUMN     "setupFeeStorefront" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "subscriptionSetupFeeStorefront" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "studio_settings" ADD COLUMN     "booking" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "studio_signups" ADD COLUMN     "shopCategory" TEXT;

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "shopCategory" TEXT;

