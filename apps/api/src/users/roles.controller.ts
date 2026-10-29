import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { areValidPermissions, type PermissionKey } from '@om/shared';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** The locked built-in administrator role cannot be edited or deleted. */
const LOCKED_ROLE_KEY = 'admin';

export class CreateRoleDto {
  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional machine key; auto-generated when omitted.',
    pattern: '^[a-z0-9][a-z0-9-]{1,48}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,48}$/, {
    message: 'key must be lowercase letters, digits and dashes.',
  })
  key?: string;

  @ApiProperty({ type: [String], description: '`scope:action` permission keys.' })
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

/**
 * Custom role management (M7 R7): roles are named permission sets; users
 * may hold several. The built-in administrator role is locked and keeps
 * the wildcard so future permissions apply automatically.
 */
@ApiTags('users')
@Controller('users/roles')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List roles with per-role user counts.' })
  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.permissions,
      userCount: role._count.users,
      locked: role.key === LOCKED_ROLE_KEY,
    }));
  }

  @Post()
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Create a custom role.' })
  async create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthUser) {
    const name = dto.name.trim();
    if (!name) throw new ConflictException('Role name is required.');
    await assertNameFree(this.prisma, name);

    const permissions = normalizePermissions(dto.permissions);
    const key = await this.uniqueKey(dto.key?.trim());

    const role = await this.prisma.role.create({
      data: { key, name, permissions },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'role.created',
      objectType: 'Role',
      objectId: role.id,
      after: { key: role.key, name: role.name, permissions: role.permissions },
    });
    return { ...role, userCount: 0, locked: false };
  }

  @Patch(':id')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Rename a role and/or replace its permissions.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    const before = await this.prisma.role.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Role not found.');
    if (before.key === LOCKED_ROLE_KEY) {
      throw new ForbiddenException('The administrator role is locked.');
    }

    const name = dto.name !== undefined ? dto.name.trim() : undefined;
    if (name === '') throw new ConflictException('Role name is required.');
    if (name && name !== before.name) {
      await assertNameFree(this.prisma, name, id);
    }
    const permissions =
      dto.permissions !== undefined ? normalizePermissions(dto.permissions) : undefined;

    const role = await this.prisma.role.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(permissions ? { permissions } : {}),
      },
      include: { _count: { select: { users: true } } },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'role.updated',
      objectType: 'Role',
      objectId: id,
      before: { name: before.name, permissions: before.permissions },
      after: { name: role.name, permissions: role.permissions },
    });
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.permissions,
      userCount: role._count.users,
      locked: role.key === LOCKED_ROLE_KEY,
    };
  }

  @Delete(':id')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Delete a role; roles still assigned to users are refused.' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.role.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Role not found.');
    if (before.key === LOCKED_ROLE_KEY) {
      throw new ForbiddenException('The administrator role is locked.');
    }
    const userCount = await this.prisma.userRole.count({ where: { roleId: id } });
    if (userCount > 0) {
      throw new ConflictException(
        `This role is still assigned to ${userCount} user(s); unassign it first.`,
      );
    }
    await this.prisma.role.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'role.deleted',
      objectType: 'Role',
      objectId: id,
      before: { key: before.key, name: before.name },
    });
    return { ok: true };
  }

  /** Uses the provided key or generates a free `role-<6>` key. */
  private async uniqueKey(key?: string): Promise<string> {
    const wanted = key ?? '';
    if (wanted) {
      const existing = await this.prisma.role.findUnique({ where: { key: wanted } });
      if (existing) {
        throw new ConflictException(`Role key "${wanted}" is already in use.`);
      }
      return wanted;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `role-${Math.random().toString(36).slice(2, 8)}`;
      const existing = await this.prisma.role.findUnique({ where: { key: candidate } });
      if (!existing) return candidate;
    }
    throw new ConflictException('Could not generate a unique role key.');
  }
}

/** Rejects duplicates and any wildcard use (administrator-only). */
function normalizePermissions(keys: string[]): PermissionKey[] {
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (!areValidPermissions(unique)) {
    throw new ConflictException('Unknown permission key(s) in list.');
  }
  if (unique.includes('*')) {
    throw new ConflictException('The wildcard permission is reserved for the administrator role.');
  }
  return unique;
}

async function assertNameFree(
  prisma: PrismaService,
  name: string,
  exceptRoleId?: string,
): Promise<void> {
  const existing = await prisma.role.findFirst({
    where: { name, ...(exceptRoleId ? { id: { not: exceptRoleId } } : {}) },
  });
  if (existing) {
    throw new ConflictException(`A role named "${name}" already exists.`);
  }
}