-- Backfill the order relation column for notes written before the review
-- note fix (ownerType/ownerId were set, but orderOwnerId was not). Orphan
-- notes whose order was permanently deleted are left untouched.
UPDATE "Note" n
SET "orderOwnerId" = n."ownerId"::uuid
WHERE n."ownerType" = 'order'
  AND n."orderOwnerId" IS NULL
  AND n."ownerId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (SELECT 1 FROM "Order" o WHERE o.id = n."ownerId"::uuid);
