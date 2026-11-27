-- A studio's own cancellation, refund and delivery policies, shown to
-- customers before they book or pay.
ALTER TABLE "studio_content" ADD COLUMN "cancellationPolicy" VARCHAR(1500);
ALTER TABLE "studio_content" ADD COLUMN "refundPolicy" VARCHAR(1500);
ALTER TABLE "studio_content" ADD COLUMN "deliveryPolicy" VARCHAR(1500);
