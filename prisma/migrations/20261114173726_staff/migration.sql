-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "staffId" TEXT;

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "photoUrl" TEXT,
    "serviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_studioId_idx" ON "staff"("studioId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
