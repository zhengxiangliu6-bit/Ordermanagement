import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { BETTER_AUTH } from './better-auth.provider';
import type { BetterAuthInstance } from './better-auth';
import { AuthUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { toFetchHeaders } from './node-headers';
import { Public } from './public.decorator';
import { toAuthUser, UsersService } from '../users/users.service';

/**
 * Thin Nest wrappers around Better Auth's server-side API.
 *
 * The Better Auth HTTP handler is not mounted, so every auth endpoint is
 * ours: fully covered by the OpenAPI contract and free of route overlap.
 * Set-Cookie headers produced by Better Auth are forwarded untouched, so
 * session cookies stay HttpOnly and owned by Better Auth.
 */
@ApiTags('auth')
@ApiCookieAuth('better-auth.session_token')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(BETTER_AUTH) private readonly auth: BetterAuthInstance,
    private readonly users: UsersService,
  ) {}

  private forwardSetCookie(res: Response, headers: Headers): void {
    const getCookies =
      'getSetCookie' in headers && typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : ([] as string[]);
    for (const cookie of getCookies) res.append('Set-Cookie', cookie);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password (Better Auth).' })
  @ApiOkResponse({ type: AuthUser })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUser> {
    const result = await this.auth.api.signInEmail({
      body: { email: dto.email, password: dto.password },
      headers: toFetchHeaders(req),
      returnHeaders: true,
    });
    this.forwardSetCookie(res, result.headers);

    const user = await this.users.findAuthUserById(result.response.user.id);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is disabled.');
    }
    return toAuthUser(user);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session (Better Auth).' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const { headers } = await this.auth.api.signOut({
      headers: toFetchHeaders(req),
      returnHeaders: true,
    });
    this.forwardSetCookie(res, headers);
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the authenticated principal.' })
  @ApiOkResponse({ type: AuthUser })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
