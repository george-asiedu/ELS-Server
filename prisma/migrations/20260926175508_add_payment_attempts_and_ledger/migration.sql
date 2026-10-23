-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('BOOKING_PAYMENT', 'ORDER_PAYMENT', 'SUBSCRIPTION_PAYMENT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REVERSED');

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "reference" TEXT NOT NULL,
    "paymentId" TEXT,
    "orderId" TEXT,
    "appointmentId" TEXT,
    "expectedAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "status" "LedgerStatus" NOT NULL DEFAULT 'PENDING',
    "paidAmount" DOUBLE PRECISION,
    "transactionId" TEXT,
    "channel" TEXT,
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "status" "LedgerStatus" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "dedupeKey" TEXT NOT NULL,
    "reference" TEXT,
    "transactionId" TEXT,
    "channel" TEXT,
    "description" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "paymentAttemptId" TEXT,
    "paymentId" TEXT,
    "orderId" TEXT,
    "appointmentId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_reference_key" ON "payment_attempts"("reference");

-- CreateIndex
CREATE INDEX "payment_attempts_studioId_createdAt_idx" ON "payment_attempts"("studioId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_attempts_paymentId_idx" ON "payment_attempts"("paymentId");

-- CreateIndex
CREATE INDEX "payment_attempts_orderId_idx" ON "payment_attempts"("orderId");

-- CreateIndex
CREATE INDEX "payment_attempts_status_createdAt_idx" ON "payment_attempts"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_dedupeKey_key" ON "ledger_entries"("dedupeKey");

-- CreateIndex
CREATE INDEX "ledger_entries_studioId_occurredAt_idx" ON "ledger_entries"("studioId", "occurredAt");

-- CreateIndex
CREATE INDEX "ledger_entries_studioId_type_occurredAt_idx" ON "ledger_entries"("studioId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "ledger_entries_studioId_status_idx" ON "ledger_entries"("studioId", "status");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_idx" ON "ledger_entries"("reference");

