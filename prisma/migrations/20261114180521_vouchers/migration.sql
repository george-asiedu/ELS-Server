-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "voucherAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "voucherId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "voucherAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "voucherId" TEXT;

-- CreateTable
CREATE TABLE "package_offers" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "price" DOUBLE PRECISION NOT NULL,
    "processingFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reference" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "packageOfferId" TEXT,
    "serviceId" TEXT,
    "sessionsTotal" INTEGER NOT NULL DEFAULT 0,
    "sessionsLeft" INTEGER NOT NULL DEFAULT 0,
    "buyerUserId" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "message" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_offers_studioId_idx" ON "package_offers"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_reference_key" ON "vouchers"("reference");

-- CreateIndex
CREATE INDEX "vouchers_studioId_idx" ON "vouchers"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_studioId_code_key" ON "vouchers"("studioId", "code");
