-- Merge inventory items into the product catalog (2026-10-27 ruling):
-- Item/ItemVariant is the single product entity with zh/en names; stock
-- and movements rekey from InventoryItemVariant to ItemVariant; the
-- product<->inventory mapping column and the two inventory-item tables
-- disappear.

-- 1. Bilingual names on the catalog.
ALTER TABLE "Item" ADD COLUMN "nameEn" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ItemVariant" ADD COLUMN "nameEn" TEXT NOT NULL DEFAULT '';

-- Backfill English names from the mapped inventory records where present.
UPDATE "Item" i
SET "nameEn" = ii."nameEn"
FROM "ItemVariant" v
JOIN "InventoryItemVariant" iv ON iv.id = v."inventoryItemVariantId"
JOIN "InventoryItem" ii ON ii.id = iv."inventoryItemId"
WHERE v."itemId" = i.id AND ii."nameEn" <> '';

UPDATE "ItemVariant" v
SET "nameEn" = COALESCE(NULLIF(iv."nameEn", ''), '')
FROM "InventoryItemVariant" iv
WHERE iv.id = v."inventoryItemVariantId";

-- 2. Rekey stock onto ItemVariant (N:1 mappings collapse onto one variant;
--    stock rows without a mapped product variant are orphaned and dropped).
ALTER TABLE "InventoryStock" ADD COLUMN "itemVariantId" UUID;
UPDATE "InventoryStock" s
SET "itemVariantId" = v.id
FROM "ItemVariant" v
WHERE v."inventoryItemVariantId" = s."inventoryItemVariantId";
DELETE FROM "InventoryStock" WHERE "itemVariantId" IS NULL;
ALTER TABLE "InventoryStock" ALTER COLUMN "itemVariantId" SET NOT NULL;
ALTER TABLE "InventoryStock" DROP CONSTRAINT "InventoryStock_inventoryItemVariantId_fkey";
ALTER TABLE "InventoryStock" DROP COLUMN "inventoryItemVariantId";
CREATE UNIQUE INDEX "InventoryStock_itemVariantId_warehouse_key" ON "InventoryStock"("itemVariantId", "warehouse");
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_itemVariantId_fkey"
  FOREIGN KEY ("itemVariantId") REFERENCES "ItemVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Rekey the movement ledger the same way.
ALTER TABLE "InventoryMovement" ADD COLUMN "itemVariantId" UUID;
UPDATE "InventoryMovement" m
SET "itemVariantId" = v.id
FROM "ItemVariant" v
WHERE v."inventoryItemVariantId" = m."inventoryItemVariantId";
DELETE FROM "InventoryMovement" WHERE "itemVariantId" IS NULL;
ALTER TABLE "InventoryMovement" ALTER COLUMN "itemVariantId" SET NOT NULL;
ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_inventoryItemVariantId_fkey";
ALTER TABLE "InventoryMovement" DROP COLUMN "inventoryItemVariantId";
CREATE INDEX "InventoryMovement_itemVariantId_createdAt_idx" ON "InventoryMovement"("itemVariantId", "createdAt");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemVariantId_fkey"
  FOREIGN KEY ("itemVariantId") REFERENCES "ItemVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Drop the mapping column and the inventory-item tables.
ALTER TABLE "ItemVariant" DROP COLUMN "inventoryItemVariantId";
DROP TABLE "InventoryItemVariant";
DROP TABLE "InventoryItem";
