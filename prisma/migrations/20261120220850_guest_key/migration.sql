-- AlterTable
ALTER TABLE "platform_config" ADD COLUMN     "guestKeyCurrent" TEXT,
ADD COLUMN     "guestKeyPrevious" TEXT,
ADD COLUMN     "guestKeyPreviousUntil" TIMESTAMP(3),
ADD COLUMN     "guestKeyRotatedAt" TIMESTAMP(3);

