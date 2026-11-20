-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('UNPAID', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "payment_attempts" ADD COLUMN     "billId" TEXT;

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "number" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "userId" TEXT,
    "items" JSONB NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" "BillStatus" NOT NULL DEFAULT 'UNPAID',
    "token" TEXT NOT NULL,
    "reference" TEXT,
    "processingFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidVia" TEXT,
    "paidNote" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bills_token_key" ON "bills"("token");

-- CreateIndex
CREATE UNIQUE INDEX "bills_reference_key" ON "bills"("reference");

-- CreateIndex
CREATE INDEX "bills_studioId_status_idx" ON "bills"("studioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bills_studioId_number_key" ON "bills"("studioId", "number");

