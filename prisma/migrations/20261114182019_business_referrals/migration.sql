-- AlterTable
ALTER TABLE "studio_signups" ADD COLUMN     "referralSlug" TEXT;

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "referredByStudioId" TEXT;
