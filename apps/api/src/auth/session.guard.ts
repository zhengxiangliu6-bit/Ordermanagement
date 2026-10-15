import {
  Inject,
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { BETTER_AUTH } from './better-auth.provider';
import type { BetterAuthInstance } from './better-auth';
import { toFetchHeaders } from './node-headers';
import { IS_PUBLIC_KEY } from './public.decorator';
import { toAuthUser, UsersService } from '../users/users.service';
import { setRequestUser } from './request-user';

/** Paths a forced-password-change user may still access. */
const MUST_CHANGE_ALLOWED_PATHS = [
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/users/me',
  '/api/v1/users/me/change-password',
];

/**
 * Global authentication guard over Better Auth sessions.
 * Routes opt out with @Public().
 *
 * Better Auth authenticates the request (session cookie validation,
 * expiry, revocation); this guard then loads the Order Management user
 * and composes the RBAC principal attached to the request.
 *
 * A user flagged mustChangePassword (administrator-issued one-time
 * password) is restricted to the allowlisted paths until the password is
 * changed (architecture §2.10).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    // Token injection: BetterAuthInstance is a type-only import, so the
    // emitted design:paramtypes metadata does not carry it.
    @Inject(BETTER_AUTH) private readonly auth: BetterAuthInstance,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const session = await this.auth.api.getSession({
      headers: toFetchHeaders(request),
    });
    if (!session) {
      throw new UnauthorizedException('Authentication required.');
    }

    const user = await this.users.findAuthUserById(session.user.id);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is disabled.');
    }

    const path = (request.originalUrl ?? request.path).split('?')[0];
    const blocked =
      user.mustChangePassword &&
      !MUST_CHANGE_ALLOWED_PATHS.some(
        (allowedPath) => path === allowedPath || path.endsWith(allowedPath),
      );
    if (blocked) {
      throw new ForbiddenException({
        code: 'MUST_CHANGE_PASSWORD',
        message: 'Password change required before accessing this resource.',
      });
    }

    setRequestUser(request, toAuthUser(user));
    return true;
  }
}
