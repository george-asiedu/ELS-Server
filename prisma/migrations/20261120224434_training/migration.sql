-- CreateEnum
CREATE TYPE "TrainingStatus" AS ENUM ('NEW', 'SCHEDULED', 'DONE', 'DECLINED');

-- AlterTable
ALTER TABLE "platform_config" ADD COLUMN     "trainingLiveNote" TEXT,
ADD COLUMN     "trainingLiveUrl" TEXT;

-- CreateTable
CREATE TABLE "training_requests" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "preferredDate" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "status" "TrainingStatus" NOT NULL DEFAULT 'NEW',
    "feeAmount" DOUBLE PRECISION,
    "scheduledFor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_requests_studioId_idx" ON "training_requests"("studioId");

