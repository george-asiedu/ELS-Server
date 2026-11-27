-- The subscription setup fee is now a one-time fee ADDED to the first period's
-- price (GHS 100 on every plan), instead of replacing the first months.
-- setupFeeMonthsMonthly / setupFeeMonthsYearly are no longer read; they stay
-- for now and can be dropped in a later release.

-- How much of a signup's charge was the setup fee (the rest is the first period).
ALTER TABLE "studio_signups" ADD COLUMN "setupFeeCharged" DOUBLE PRECISION;

ALTER TABLE "platform_config" ALTER COLUMN "subscriptionSetupFeeStandard" SET DEFAULT 100;
ALTER TABLE "platform_config" ALTER COLUMN "subscriptionSetupFeePremium" SET DEFAULT 100;
ALTER TABLE "platform_config" ALTER COLUMN "subscriptionSetupFeeStorefront" SET DEFAULT 100;

UPDATE "platform_config" SET
  "subscriptionSetupFeeStandard" = 100,
  "subscriptionSetupFeePremium" = 100,
  "subscriptionSetupFeeStorefront" = 100;
