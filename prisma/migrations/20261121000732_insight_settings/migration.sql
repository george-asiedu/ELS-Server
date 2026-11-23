-- AlterTable
ALTER TABLE "studio_settings" ADD COLUMN     "insightAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "revenueGoal" DOUBLE PRECISION,
ADD COLUMN     "weeklyDigest" BOOLEAN NOT NULL DEFAULT true;

