-- CreateTable
CREATE TABLE "customer_notes" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "userId" TEXT NOT NULL,
    "notes" VARCHAR(2000) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_notes_studioId_userId_key" ON "customer_notes"("studioId", "userId");
