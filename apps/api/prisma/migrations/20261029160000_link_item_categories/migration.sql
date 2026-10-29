-- Preserve existing free-text classifications and link them to managed categories.
ALTER TABLE "Item" ADD COLUMN "categoryId" UUID;
INSERT INTO "Category" ("id", "name", "enabled", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), names.name, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT btrim("category") AS name FROM "Item"
      WHERE "category" IS NOT NULL AND btrim("category") <> '') AS names
ON CONFLICT ("name") DO NOTHING;
UPDATE "Item" AS item SET "categoryId" = category."id", "category" = category."name"
FROM "Category" AS category WHERE btrim(item."category") = category."name";
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Repair only known seeded region names; custom regions must be explicitly configured.
UPDATE "ShippingRegion" SET "warehouse" = 'china' WHERE "warehouse" IS NULL AND "name" IN ('中国', '中国仓');
UPDATE "ShippingRegion" SET "warehouse" = 'canada' WHERE "warehouse" IS NULL AND "name" IN ('加拿大', '加拿大仓');
