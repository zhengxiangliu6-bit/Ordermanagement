-- Packing may not mark problem items; ordering/inspection keep the ability.
UPDATE "Role"
SET "permissions" = array_remove("permissions", 'shipping:issue-report')
WHERE "key" = 'packer';
