-- CreateEnum
CREATE TYPE "ExtraChargeKind" AS ENUM ('FEATURE_REQUEST', 'STORAGE_OVERAGE', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtraChargeStatus" AS ENUM ('PENDING', 'BILLED', 'WAIVED');

-- AlterTable
ALTER TABLE "feature_requests" ADD COLUMN     "feeAmount" DOUBLE PRECISION,
ADD COLUMN     "feeSetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "studio_extra_charges" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "kind" "ExtraChargeKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "ExtraChargeStatus" NOT NULL DEFAULT 'PENDING',
    "refId" TEXT NOT NULL,
    "billedReference" TEXT,
    "billedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_extra_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "studio_extra_charges_studioId_status_idx" ON "studio_extra_charges"("studioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "studio_extra_charges_studioId_kind_refId_key" ON "studio_extra_charges"("studioId", "kind", "refId");

