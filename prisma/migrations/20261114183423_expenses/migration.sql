-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" VARCHAR(200),
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_studioId_date_idx" ON "expenses"("studioId", "date");
