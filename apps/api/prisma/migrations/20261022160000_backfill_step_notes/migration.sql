-- Move existing workflow step notes into the order notes section.
INSERT INTO "Note" ("ownerType", "ownerId", "orderOwnerId", "body", "createdBy", "createdAt", "updatedAt")
SELECT
  'order',
  e."orderId"::text,
  e."orderId",
  CASE e."action"
    WHEN 'packed' THEN '[Packing] '
    WHEN 'tracked' THEN '[Ordering] '
    WHEN 'inspected' THEN '[Inspection] '
    WHEN 'tail_saved' THEN '[Tail] '
  END || e."note",
  e."actorId",
  e."createdAt",
  now()
FROM "OrderStageEvent" e
WHERE e."note" IS NOT NULL
  AND e."note" <> ''
  AND e."action" IN ('packed', 'tracked', 'inspected', 'tail_saved')
  AND e."actorId" <> 'system'
  AND NOT EXISTS (
    SELECT 1 FROM "Note" n
    WHERE n."orderOwnerId" = e."orderId"
      AND n."createdBy" = e."actorId"
      AND n."createdAt" = e."createdAt"
  );
