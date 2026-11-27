-- The free live training session now has a date and time, and studios can
-- reserve a spot for it.
ALTER TABLE "platform_config" ADD COLUMN "trainingLiveAt" TIMESTAMP(3);
ALTER TABLE "platform_config" ADD COLUMN "trainingLiveMinutes" INTEGER NOT NULL DEFAULT 60;

CREATE TABLE "training_reservations" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "reservedByUserId" TEXT,
    "reservedByEmail" TEXT,
    "sessionAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "training_reservations_studioId_sessionAt_key" ON "training_reservations"("studioId", "sessionAt");
CREATE INDEX "training_reservations_sessionAt_idx" ON "training_reservations"("sessionAt");
