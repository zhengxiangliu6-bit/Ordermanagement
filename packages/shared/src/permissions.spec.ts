import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  areValidPermissions,
  expandPermissions,
  hasAnyPermission,
  hasPermissions,
  permissionKey,
  READ_ONLY_PERMISSIONS,
} from "./permissions.js";

describe("permissions", () => {
  it("formats scope:action keys", () => {
    expect(permissionKey("orders", "read")).toBe("orders:read");
  });

  it("requires every required key", () => {
    const granted = ["orders:read", "items:read"];
    expect(hasPermissions(granted, ["orders:read"])).toBe(true);
    expect(hasPermissions(granted, ["orders:read", "items:read"])).toBe(true);
    expect(hasPermissions(granted, ["orders:read", "orders:delete"])).toBe(
      false,
    );
  });

  it("accepts a granted Set", () => {
    expect(hasPermissions(new Set(["audit:read"]), ["audit:read"])).toBe(true);
  });

  it("wildcard grants everything", () => {
    expect(hasPermissions(["*"], ["orders:delete"])).toBe(true);
    expect(hasAnyPermission(["*"], ["orders:delete"])).toBe(true);
  });

  it("hasAnyPermission needs at least one match", () => {
    expect(hasAnyPermission(["notes:create"], ["notes:create", "notes:delete"])).toBe(true);
    expect(hasAnyPermission(["notes:delete"], ["notes:create"])).toBe(false);
  });

  it("defines read actions for every scope", () => {
    for (const key of READ_ONLY_PERMISSIONS) {
      expect(ALL_PERMISSIONS).toContain(key);
    }
  });

    it("staff baseline excludes privileged scopes", () => {
      const baseline = new Set(READ_ONLY_PERMISSIONS);
      // Financial isolation (§20.3), sensitive carrier identity (§12.14),
      // audit history (§23) and administration scopes are never default.
      for (const privileged of [
        "financial:read",
        "users:read",
        "audit:read",
        "carrier-source:read",
        "carrier-providers:read",
        "status-config:read",
        "review-settings:read",
      ]) {
        expect(baseline.has(privileged)).toBe(false);
      }
    });

  it("expands the wildcard for UI permission sets", () => {
    const expanded = expandPermissions(["*"]);
    expect(expanded).toContain("*");
    for (const key of ALL_PERMISSIONS) {
      expect(expanded).toContain(key);
    }
    // Plain sets pass through untouched (duplicates removed).
    expect(expandPermissions(["orders:read", "orders:read"])).toEqual([
      "orders:read",
    ]);
  });

  it("validates permission key lists", () => {
    expect(areValidPermissions(["orders:read", "*"])).toBe(true);
    expect(areValidPermissions(["orders:read", "nope:read"])).toBe(false);
    expect(areValidPermissions([])).toBe(true);
  });
});
