-- Where to alert a staff member when a booking with them is about to start.
ALTER TABLE "staff" ADD COLUMN "email" TEXT;

-- Marks that the "starting soon" reminder for a live training spot was sent.
ALTER TABLE "training_reservations" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
