-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED');

-- DropIndex
DROP INDEX "cart_items_cartId_productId_key";

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "size" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "color" TEXT,
ADD COLUMN     "size" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "couponDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "colors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sizes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "productId" TEXT;

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "minSubtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WishlistItem_studioId_idx" ON "WishlistItem"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_userId_productId_key" ON "WishlistItem"("userId", "productId");

-- CreateIndex
CREATE INDEX "Coupon_studioId_idx" ON "Coupon"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_studioId_code_key" ON "Coupon"("studioId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_size_color_key" ON "cart_items"("cartId", "productId", "size", "color");

-- CreateIndex
CREATE INDEX "reviews_productId_idx" ON "reviews"("productId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

