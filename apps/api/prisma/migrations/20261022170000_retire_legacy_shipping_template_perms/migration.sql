-- The stage workflow enters tracking via shipping:backfill and has no
-- in-workflow shipment revision, so the legacy template permissions are no
-- longer granted to the operator templates.
UPDATE "Role"
SET "permissions" = array_remove("permissions", 'shipping:enter')
WHERE "key" = 'placer';

UPDATE "Role"
SET "permissions" = array_remove("permissions", 'shipping:revise')
WHERE "key" = 'inspector';
