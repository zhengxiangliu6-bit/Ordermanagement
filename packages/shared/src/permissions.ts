/**
 * Permission model shared by the API (enforcement) and the web app (display).
 *
 * Scopes and actions follow the approved functional design, section
 * "Roles and permissions": access is composed from roles, each role holds a
 * set of `scope:action` permission keys, and sensitive field groups
 * (`carrier-source`, `financial`) are their own scopes.
 */

export const PERMISSION_SCOPES = [
  "orders",
  "items",
  "listings",
  "mapping",
  "stores",
  "shipping",
  "carrier-source",
  "carrier-providers",
  "customers",
  "notes",
  "attachments",
  "status-config",
  "review-settings",
  "inventory",
  "categories",
  "audit",
  "users",
  "notifications",
  "financial",
] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/**
 * Actions allowed per scope. Read-like scopes such as `carrier-source` and
 * `financial` intentionally expose read-only actions in this release.
 */
export const SCOPE_ACTIONS: Record<PermissionScope, readonly string[]> = {
  orders: ["read", "create-manual", "revise", "review", "archive", "restore", "delete", "cancel"],
  items: ["read", "create", "update", "archive", "delete"],
  listings: ["read", "review", "annotate"],
  mapping: ["read", "manage"],
  stores: ["read", "configure", "connect", "pause", "resume", "synchronize", "delete"],
  shipping: [
    "read",
    "manage-settings",
    "weigh",
    "backfill",
    "inspect",
    "tail",
    "issue-report",
    "issue-review",
    "return",
  ],
  "carrier-source": ["read"],
  "carrier-providers": ["read", "manage"],
  customers: ["read-basic", "read-contact", "read-address", "link"],
  notes: ["read", "create", "edit-own", "edit-all", "delete"],
  attachments: ["view-metadata", "open", "upload", "delete"],
  "status-config": ["read", "manage"],
  "review-settings": ["read", "manage"],
  categories: ["read", "manage"],
  audit: ["read"],
  users: ["read", "create", "manage", "delete"],
  notifications: ["read", "manage-own"],
  inventory: [
    "read",
    "manage",
    // Warehouse-scoped keys (inventory:china:read, …) back the per-warehouse
    // interfaces: route guards, nav entries and stock/adjust authorization
    // all match on them; the plain read/manage keys stay the global grants.
    "china:read",
    "china:manage",
    "canada:read",
    "canada:manage",
  ],
  financial: ["read", "review"],
};

/** A single permission key, formatted as `<scope>:<action>`. */
export type PermissionKey = string;

/**
 * Grants every permission, including permissions added in future releases
 * without re-seeding. Reserved for the locked built-in administrator role;
 * the API guards honor it via hasPermissions/hasAnyPermission.
 */
export const WILDCARD_PERMISSION = "*";

export function permissionKey(
  scope: PermissionScope,
  action: string,
): PermissionKey {
  return `${scope}:${action}`;
}

/** Every permission key defined in this release. */
export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.entries(
  SCOPE_ACTIONS,
).flatMap(([scope, actions]) =>
  (actions as readonly string[]).map((action) => `${scope}:${action}`),
);

/**
 * Initial `Staff` baseline: read-only across operational scopes.
 *
 * Deliberately EXCLUDED from the baseline (they are privileged per the
 * functional design): Users & Roles (`users`), Audit History (`audit`),
 * Financial data (`financial`), the sensitive original-carrier identity
 * (`carrier-source`), carrier/provider configuration, status and review
 * settings configuration.
 */
const STAFF_BASELINE_SCOPES = [
  "orders",
  "items",
  "listings",
  "mapping",
  "stores",
  "shipping",
  "customers",
  "notes",
  "attachments",
  "notifications",
] as const satisfies readonly PermissionScope[];

export const READ_ONLY_PERMISSIONS: readonly PermissionKey[] =
  STAFF_BASELINE_SCOPES.flatMap((scope) =>
    (SCOPE_ACTIONS[scope] as readonly string[])
      .filter(
        (action) =>
          action === "read" ||
          (scope === "customers" && action === "read-basic") ||
          (scope === "attachments" && action === "view-metadata"),
      )
      .map((action) => `${scope}:${action}`),
  );

/**
 * True when the granted permission set satisfies every required key.
 * The `*` wildcard grants everything (reserved for the administrator role).
 */
export function hasPermissions(
  granted: readonly PermissionKey[] | Set<PermissionKey>,
  required: readonly PermissionKey[],
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has("*")) return true;
  return required.every((key) => set.has(key));
}

/** True when the granted permission set satisfies at least one required key. */
export function hasAnyPermission(
  granted: readonly PermissionKey[] | Set<PermissionKey>,
  required: readonly PermissionKey[],
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has("*")) return true;
  return required.some((key) => set.has(key));
}

/**
 * Expands the wildcard into the concrete permission list (plus the wildcard
 * itself). The web app consumes a plain permission array (Set.has lookups
 * for navigation), so the wildcard must be expanded client-side.
 */
export function expandPermissions(
  granted: readonly PermissionKey[],
): PermissionKey[] {
  if (!granted.includes(WILDCARD_PERMISSION)) {
    return [...new Set(granted)];
  }
  return [...new Set([WILDCARD_PERMISSION, ...ALL_PERMISSIONS])];
}

/** True when every key is a defined permission (or the wildcard). */
export function areValidPermissions(
  keys: readonly PermissionKey[],
): boolean {
  const valid = new Set(ALL_PERMISSIONS);
  return keys.every((key) => key === WILDCARD_PERMISSION || valid.has(key));
}
