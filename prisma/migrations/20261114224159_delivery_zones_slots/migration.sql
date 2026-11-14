-- AlterTable
ALTER TABLE "commerce_settings" ADD COLUMN     "deliverySlots" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "deliveryZones" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliverySlot" TEXT,
ADD COLUMN     "deliveryZone" TEXT;

