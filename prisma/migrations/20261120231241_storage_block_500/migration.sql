-- An extra storage block is now 500 MB for GHS 5 a month (it was 50 MB).
ALTER TABLE "platform_config" ALTER COLUMN "storageBlockMb" SET DEFAULT 500;
UPDATE "platform_config" SET "storageBlockMb" = 500 WHERE "storageBlockMb" = 50;
-- Blocks already taken keep their price per block; they are now 500 MB each.
