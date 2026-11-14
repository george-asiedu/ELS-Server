-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "processingFee" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payment_attempts" ADD COLUMN     "processingFee" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "processingFee" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "studio_settings" ADD COLUMN     "paystackFeePayer" TEXT NOT NULL DEFAULT 'CUSTOMER';
