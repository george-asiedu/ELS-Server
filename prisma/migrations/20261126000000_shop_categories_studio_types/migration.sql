-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "shopCategories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "studio_signups" ADD COLUMN     "shopCategories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing shops sell their one category.
UPDATE "studios" SET "shopCategories" = ARRAY["shopCategory"] WHERE "shopCategory" IS NOT NULL;

-- AlterTable
ALTER TABLE "studio_content" ADD COLUMN     "studioTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "studio_signups" ADD COLUMN     "studioTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing studios offer their one kind.
UPDATE "studio_content" SET "studioTypes" = ARRAY["studioType"] WHERE "studioType" IS NOT NULL;
