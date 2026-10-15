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
  orders: ["read", "create-manual", "revise", "review", "archive", "restore", "delete"],
  items: ["read", "create", "update", "archive", "delete"],
  listings: ["read", "review", "annotate"],
  mapping: ["read", "manage"],
  stores: ["read", "configure", "connect", "pause", "resume", "synchronize", "delete"],
  shipping: [
    "read",
    "enter",
    "revise",
    "review",
    "send-now",
    "retry",
    "manage-settings",
  ],
  "carrier-source": ["read"],
  "carrier-providers": ["read", "manage"],
  customers: ["read-basic", "read-contact", "read-address", "link"],
  notes: ["read", "create", "edit-own", "edit-all", "delete"],
  attachments: ["view-metadata", "open", "upload", "delete"],
  "status-config": ["read", "manage"],
  "review-settings": ["read", "manage"],
  audit: ["read"],
  users: ["read", "manage"],
  notifications: ["read", "manage-own"],
  financial: ["read", "review"],
};

/** A single permission key, formatted as `<scope>:<action>`. */
export type PermissionKey = string;

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
