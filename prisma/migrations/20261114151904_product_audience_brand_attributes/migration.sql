-- AlterTable
ALTER TABLE "products" ADD COLUMN     "attributes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'UNISEX',
ADD COLUMN     "brand" TEXT;
