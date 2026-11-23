-- AlterTable
ALTER TABLE "products" ADD COLUMN     "salePromoId" TEXT;

-- CreateTable
CREATE TABLE "sale_promos" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "name" TEXT NOT NULL,
    "percentOff" DOUBLE PRECISION NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[5]::INTEGER[],
    "banner" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_promos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_promos_studioId_idx" ON "sale_promos"("studioId");

