-- Reviewers can cancel an order from the unfulfilled review queue.
UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['orders:cancel']::text[])
)
WHERE "key" = 'supervisor';
