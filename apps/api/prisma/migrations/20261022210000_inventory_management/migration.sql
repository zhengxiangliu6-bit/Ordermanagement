-- AlterTable
ALTER TABLE "ItemVariant" ADD COLUMN     "inventoryItemVariantId" UUID;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "stockDeductedAt" TIMESTAMP(3),
ADD COLUMN     "stockWarehouse" TEXT;

-- AlterTable
ALTER TABLE "ShippingRegion" ADD COLUMN     "warehouse" TEXT;

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "code" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItemVariant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventoryItemId" UUID NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItemVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStock" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventoryItemVariantId" UUID NOT NULL,
    "warehouse" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "lowThreshold" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventoryItemVariantId" UUID NOT NULL,
    "warehouse" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "resultQuantity" INTEGER NOT NULL,
    "orderId" UUID,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_nameZh_key" ON "InventoryItem"("nameZh");

-- CreateIndex
CREATE INDEX "InventoryItem_nameZh_idx" ON "InventoryItem"("nameZh");

-- CreateIndex
CREATE INDEX "InventoryItemVariant_inventoryItemId_idx" ON "InventoryItemVariant"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryStock_inventoryItemVariantId_warehouse_key" ON "InventoryStock"("inventoryItemVariantId", "warehouse");

-- CreateIndex
CREATE INDEX "InventoryMovement_inventoryItemVariantId_createdAt_idx" ON "InventoryMovement"("inventoryItemVariantId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_orderId_idx" ON "InventoryMovement"("orderId");

-- AddForeignKey
ALTER TABLE "ItemVariant" ADD CONSTRAINT "ItemVariant_inventoryItemVariantId_fkey" FOREIGN KEY ("inventoryItemVariantId") REFERENCES "InventoryItemVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemVariant" ADD CONSTRAINT "InventoryItemVariant_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_inventoryItemVariantId_fkey" FOREIGN KEY ("inventoryItemVariantId") REFERENCES "InventoryItemVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryItemVariantId_fkey" FOREIGN KEY ("inventoryItemVariantId") REFERENCES "InventoryItemVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

