-- CreateEnum
CREATE TYPE "StudioBillingChargeKind" AS ENUM ('RENEWAL', 'PLAN_CHANGE');

-- CreateEnum
CREATE TYPE "StudioBillingChargeStatus" AS ENUM ('PENDING', 'APPLIED');

-- AlterTable
ALTER TABLE "platform_config" ADD COLUMN     "demoStudioSlug" TEXT,
ADD COLUMN     "pricePremiumMonthly" DOUBLE PRECISION,
ADD COLUMN     "pricePremiumYearly" DOUBLE PRECISION,
ADD COLUMN     "priceStandardMonthly" DOUBLE PRECISION,
ADD COLUMN     "priceStandardYearly" DOUBLE PRECISION,
ADD COLUMN     "siteHeroBadge" TEXT,
ADD COLUMN     "siteName" TEXT,
ADD COLUMN     "supportEmail" TEXT,
ADD COLUMN     "supportWhatsapp" TEXT;

-- CreateTable
CREATE TABLE "studio_billing_charges" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "kind" "StudioBillingChargeKind" NOT NULL,
    "plan" "StudioPlan" NOT NULL,
    "cadence" "BillingCadence" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "StudioBillingChargeStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_billing_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studio_billing_charges_reference_key" ON "studio_billing_charges"("reference");

-- CreateIndex
CREATE INDEX "studio_billing_charges_studioId_idx" ON "studio_billing_charges"("studioId");

