-- Append the workflow permissions to the seeded template roles. Existing
-- custom role edits are preserved (the array union keeps everything else).
UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['shipping:issue-review']::text[])
)
WHERE "key" = 'supervisor';

UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['shipping:read','shipping:weigh','shipping:issue-report']::text[])
)
WHERE "key" = 'packer';

UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['shipping:backfill','shipping:issue-report']::text[])
)
WHERE "key" = 'placer';

UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['shipping:inspect','shipping:tail','shipping:issue-report']::text[])
)
WHERE "key" = 'inspector';
