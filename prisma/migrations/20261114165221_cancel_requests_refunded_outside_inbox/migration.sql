-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "cancelRequestReason" VARCHAR(500),
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "refundedOutsideAmount" DOUBLE PRECISION,
ADD COLUMN     "refundedOutsideAt" TIMESTAMP(3),
ADD COLUMN     "refundedOutsideNote" VARCHAR(300);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelRequestReason" VARCHAR(500),
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "refundedOutsideAmount" DOUBLE PRECISION,
ADD COLUMN     "refundedOutsideAt" TIMESTAMP(3),
ADD COLUMN     "refundedOutsideNote" VARCHAR(300);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(400) NOT NULL,
    "url" VARCHAR(300) NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
