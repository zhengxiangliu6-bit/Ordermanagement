-- Backfill the local fulfillment mirror from the preserved raw platform
-- status for orders imported before the mirror column existed.
UPDATE "Order"
SET "fulfillmentStatus" = UPPER("statusRaw"->>'fulfillmentStatus')
WHERE "statusRaw" IS NOT NULL
  AND "statusRaw"->>'fulfillmentStatus' IS NOT NULL
  AND "statusRaw"->>'fulfillmentStatus' <> '';
