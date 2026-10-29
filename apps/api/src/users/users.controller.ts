import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { BETTER_AUTH } from '../auth/better-auth.provider';
import type { BetterAuthInstance } from '../auth/better-auth';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { toFetchHeaders } from '../auth/node-headers';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { toAuthUser, UsersService } from './users.service';
import {
  ChangePasswordDto,
  CreateUserDto,
  ListUsersQueryDto,
  SetActiveDto,
  SetRolesDto,
} from './dto/user-admin.dto';
import { UsersAdminService } from './users.admin.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly admin: UsersAdminService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List users with status/role filters.' })
  list(@Query() query: ListUsersQueryDto) {
    return this.admin.list({ status: query.status, roleKey: query.roleKey });
  }

  @Post()
  @RequirePermissions('users:create')
  @ApiOperation({
    summary:
      'Create an account with a one-time temporary password (shown once, forces change).',
  })
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.admin.createUser(dto, user.id);
  }

  @Post(':id/set-active')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Disable or re-enable an account (disabling revokes sessions).' })
  setActive(
    @Param('id') id: string,
    @Body() body: SetActiveDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.admin.setActive(id, body.isActive === true, actor.id);
  }

  @Post(':id/reset-password')
  @RequirePermissions('users:manage')
  @ApiOperation({
    summary: 'Issue a new one-time password; revokes sessions and forces a change.',
  })
  resetPassword(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.admin.resetPassword(id, actor.id);
  }

  @Post(':id/roles')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Replace the role assignments of a user.' })
  setRoles(
    @Param('id') id: string,
    @Body() dto: SetRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.admin.setRoles(id, dto.roleKeys, actor.id);
  }

  @Delete(':id')
  @RequirePermissions('users:delete')
  @ApiOperation({
    summary:
      'Permanently delete an account (sessions and role assignments cascade; notes keep history).',
  })
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.admin.deleteUser(id, actor.id);
  }
}

@ApiTags('users')
@Controller('users/me')
export class MeActionsController {
  constructor(
    @Inject(BETTER_AUTH) private readonly auth: BetterAuthInstance,
    private readonly users: UsersService,
    private readonly admin: UsersAdminService,
  ) {}

  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Change the own password (also completes a forced change after a temporary password).',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const session = await this.auth.api.getSession({
      headers: toFetchHeaders(req),
    });
    if (!session) throw new UnauthorizedException('Authentication required.');

    try {
      await this.auth.api.changePassword({
        body: {
          currentPassword: dto.currentPassword,
          newPassword: dto.newPassword,
        },
        headers: toFetchHeaders(req),
      });
    } catch {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const user = await this.users.findAuthUserById(session.user.id);
    if (user?.mustChangePassword) {
      await this.admin.completePasswordChange(user.id, user.id);
    }
    return { ok: true };
  }

  @Get()
  @ApiOperation({ summary: 'Return the own principal (convenience alias).' })
  async me(@Req() req: Request) {
    const session = await this.auth.api.getSession({
      headers: toFetchHeaders(req),
    });
    if (!session) throw new UnauthorizedException('Authentication required.');
    const user = await this.users.findAuthUserById(session.user.id);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is disabled.');
    }
    return toAuthUser(user);
  }
}
