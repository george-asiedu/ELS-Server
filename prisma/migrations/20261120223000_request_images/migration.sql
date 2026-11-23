-- AlterTable
ALTER TABLE "feature_requests" ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[];

