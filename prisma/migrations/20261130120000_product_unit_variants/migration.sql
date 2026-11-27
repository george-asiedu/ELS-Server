-- What a product is sold as (kg, crate, bag...) and a price for each option.
ALTER TABLE "products" ADD COLUMN "unit" VARCHAR(20);
ALTER TABLE "products" ADD COLUMN "variants" JSONB;
