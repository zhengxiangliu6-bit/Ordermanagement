-- Operational templates can view inventory; supervisors can manage it.
UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['inventory:read']::text[])
)
WHERE "key" IN ('packer', 'placer', 'inspector', 'supervisor');

UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['inventory:manage']::text[])
)
WHERE "key" = 'supervisor';
