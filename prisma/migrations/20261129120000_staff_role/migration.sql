-- A STAFF role for a studio's team members, and the link from a staff member
-- to their sign-in account.
ALTER TYPE "Role" ADD VALUE 'STAFF';

-- False until the person sets their own password on their first visit.
ALTER TABLE "users" ADD COLUMN "passwordSet" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "staff" ADD COLUMN "phone" TEXT;
ALTER TABLE "staff" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "staff_userId_key" ON "staff"("userId");
