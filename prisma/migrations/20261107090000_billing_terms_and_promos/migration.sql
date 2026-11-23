-- AlterTable
ALTER TABLE "studio_billing_charges" ADD COLUMN     "promoCode" TEXT;

-- AlterTable
ALTER TABLE "studio_signups" ADD COLUMN     "promoCode" TEXT;

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "billingDiscountEndsAt" TIMESTAMP(3),
ADD COLUMN     "billingDiscountPercent" DOUBLE PRECISION,
ADD COLUMN     "billingNote" TEXT,
ADD COLUMN     "customPriceMonthly" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "billing_promos" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" DOUBLE PRECISION NOT NULL,
    "plans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_promos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_promos_code_key" ON "billing_promos"("code");

