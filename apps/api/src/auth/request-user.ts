import type { Request } from 'express';
import type { AuthUser } from './auth.types';

type RequestWithUser = Request & { user?: AuthUser };

/** Reads the session principal attached by SessionGuard. */
export function getRequestUser(request: Request): AuthUser | undefined {
  return (request as RequestWithUser).user;
}

/** Attaches the session principal (SessionGuard only). */
export function setRequestUser(request: Request, user: AuthUser): void {
  (request as RequestWithUser).user = user;
}
