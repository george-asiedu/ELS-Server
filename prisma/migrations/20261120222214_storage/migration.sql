-- AlterTable
ALTER TABLE "gallery" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "purgeAfter" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "platform_config" ADD COLUMN     "storageBlockMb" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "storageBlockPrice" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "storagePremiumMb" INTEGER NOT NULL DEFAULT 1024,
ADD COLUMN     "storageStandardMb" INTEGER NOT NULL DEFAULT 500;

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "storageExtraBlocks" INTEGER NOT NULL DEFAULT 0;

