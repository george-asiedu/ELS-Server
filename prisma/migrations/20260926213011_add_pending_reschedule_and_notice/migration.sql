-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'PENDING_RESCHEDULE';

-- AlterTable
ALTER TABLE "studio_settings" ADD COLUMN     "rescheduleNoticeHours" INTEGER NOT NULL DEFAULT 2;

