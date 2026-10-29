-- Warehouse-scoped inventory permissions: roles holding the global
-- inventory read/manage keys get both warehouse keys so existing access
-- (e.g. the supervisor template) keeps working after the split. The
-- wildcard administrator needs nothing.

UPDATE "Role"
SET permissions = permissions || '{inventory:china:read}'
WHERE 'inventory:read' = ANY (permissions)
  AND NOT ('inventory:china:read' = ANY (permissions));

UPDATE "Role"
SET permissions = permissions || '{inventory:canada:read}'
WHERE 'inventory:read' = ANY (permissions)
  AND NOT ('inventory:canada:read' = ANY (permissions));

UPDATE "Role"
SET permissions = permissions || '{inventory:china:manage}'
WHERE 'inventory:manage' = ANY (permissions)
  AND NOT ('inventory:china:manage' = ANY (permissions));

UPDATE "Role"
SET permissions = permissions || '{inventory:canada:manage}'
WHERE 'inventory:manage' = ANY (permissions)
  AND NOT ('inventory:canada:manage' = ANY (permissions));
