-- AlterTable
ALTER TABLE "platform_config" ADD COLUMN     "setupFeeMonthsMonthly" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "setupFeeMonthsYearly" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "subscriptionSetupFeePremium" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "subscriptionSetupFeeStandard" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "studio_signups" ADD COLUMN     "amountCharged" DOUBLE PRECISION,
ADD COLUMN     "coverageMonths" INTEGER;
