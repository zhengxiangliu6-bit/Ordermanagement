import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth.types';
import { getRequestUser } from './request-user';

/** Injects the session principal resolved by SessionGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return getRequestUser(request) as AuthUser;
  },
);
