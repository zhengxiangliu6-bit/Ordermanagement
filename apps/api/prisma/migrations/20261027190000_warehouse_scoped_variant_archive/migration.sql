-- Warehouse-scoped variant archive: a product can be archived in one
-- warehouse while staying active in the other.
ALTER TABLE "InventoryStock" ADD COLUMN "archivedAt" TIMESTAMP(3);
