import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@om/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permission keys a route requires. All listed keys must be
 * granted (all-of semantics). With no @RequirePermissions on the route,
 * authentication alone is sufficient.
 */
export const RequirePermissions =
  (...permissions: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const PERMISSIONS_ANY_KEY = 'requiredAnyPermissions';

/**
 * Any-of semantics: at least one listed key must be granted. Use for routes
 * that serve several queue/object types whose per-type authorization is
 * asserted inside the service (e.g. the review endpoints, which serve both
 * orders:* and shipping:* reviewers).
 */
export const RequireAnyPermissions =
  (...permissions: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);
