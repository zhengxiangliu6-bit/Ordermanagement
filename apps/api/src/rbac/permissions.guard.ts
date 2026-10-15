import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasAnyPermission, hasPermissions } from '@om/shared';
import { PERMISSIONS_ANY_KEY, PERMISSIONS_KEY } from './require-permissions.decorator';
import { getRequestUser } from '../auth/request-user';

/**
 * Global RBAC guard, runs after SessionGuard. Routes declare their required
 * permission keys with @RequirePermissions(...) (all-of) and/or
 * @RequireAnyPermissions(...) (any-of); requests satisfying them (or the
 * `*` wildcard) pass.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const requiredAny =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_ANY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0 && requiredAny.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = getRequestUser(request);
    if (!user) throw new ForbiddenException('Insufficient permissions.');

    if (required.length > 0 && !hasPermissions(user.permissions, required)) {
      throw new ForbiddenException('Insufficient permissions.');
    }
    if (requiredAny.length > 0 && !hasAnyPermission(user.permissions, requiredAny)) {
      throw new ForbiddenException('Insufficient permissions.');
    }
    return true;
  }
}
