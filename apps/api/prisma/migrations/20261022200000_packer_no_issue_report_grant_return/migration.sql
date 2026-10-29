-- Packing cannot mark problem items; packing/supervisors can return orders
-- from packing back to the unfulfilled review.
UPDATE "Role"
SET "permissions" = array_remove("permissions", 'shipping:issue-report')
WHERE "key" = 'packer';

UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['shipping:return']::text[])
)
WHERE "key" IN ('packer', 'supervisor');
