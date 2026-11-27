-- Pre-orders (a ready-from date), a minimum order and bulk prices on products,
-- and the ready-from date an order carries.
ALTER TABLE "products" ADD COLUMN "availableFrom" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN "minQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "products" ADD COLUMN "bulkTiers" JSONB;
ALTER TABLE "orders" ADD COLUMN "readyFrom" TIMESTAMP(3);
