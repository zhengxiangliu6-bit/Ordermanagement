import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const TEMP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';

/** One-time temporary password issued by an administrator (architecture §2.10). */
export function generateTemporaryPassword(): string {
  let out = '';
  for (let i = 0; i < 14; i += 1) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}

const userWithRoles = Prisma.validator<Prisma.UserInclude>()({
  roles: { include: { role: true } },
});

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRoles }>;

export function toUserAdminView(user: UserWithRoles) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.name,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    roleKeys: user.roles.map((userRole) => userRole.role.key),
    roleNames: user.roles.map((userRole) => userRole.role.name),
  };
}

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(filters: { status?: string; roleKey?: string } = {}) {
    const where: Prisma.UserWhereInput = {
      ...(filters.status === 'active'
        ? { isActive: true, mustChangePassword: false }
        : {}),
      ...(filters.status === 'disabled' ? { isActive: false } : {}),
      ...(filters.status === 'must-change'
        ? { isActive: true, mustChangePassword: true }
        : {}),
      ...(filters.roleKey
        ? { roles: { some: { role: { key: filters.roleKey } } } }
        : {}),
    };
    return this.prisma.user
      .findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: userWithRoles,
      })
      .then((users) => users.map(toUserAdminView));
  }

  listRoles() {
    return this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      select: { key: true, name: true, permissions: true },
    });
  }

  /**
   * Creates an internal account with a one-time temporary password. Public
   * self-registration stays disabled; the returned password is shown once
   * and forces a password change at next login.
   */
  async createUser(
    dto: { email: string; name: string; roleKeys?: string[] },
    actorId: string,
  ) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists.');
    }
    const roles = await this.resolveRoles(dto.roleKeys ?? ['staff']);

    const temporaryPassword = generateTemporaryPassword();
    const { hashPassword } = await import("better-auth/crypto");
    const passwordHash = await hashPassword(temporaryPassword);
    const userId = randomBytes(16).toString('hex');

    const user = await this.prisma.user.create({
      data: {
        id: userId,
        email: dto.email,
        name: dto.name,
        isActive: true,
        mustChangePassword: true,
        accounts: {
          create: {
            id: randomBytes(16).toString('hex'),
            providerId: 'credential',
            accountId: userId,
            password: passwordHash,
          },
        },
        roles: { create: roles.map((role) => ({ roleId: role.id })) },
      },
      include: userWithRoles,
    });

    await this.audit.record({
      actorId,
      action: 'user.created',
      objectType: 'User',
      objectId: user.id,
      after: { email: user.email, roleKeys: roles.map((role) => role.key) },
    });
    return { user: toUserAdminView(user), temporaryPassword };
  }

  /** Disable or re-enable an account; disabling revokes every live session. */
  async setActive(userId: string, isActive: boolean, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (userId === actorId && !isActive) {
      throw new ConflictException('You cannot disable your own account.');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      include: userWithRoles,
    });
    if (!isActive) {
      await this.prisma.session.deleteMany({ where: { userId } });
    }
    await this.audit.record({
      actorId,
      action: isActive ? 'user.enabled' : 'user.disabled',
      objectType: 'User',
      objectId: userId,
      after: { isActive },
    });
    return toUserAdminView(updated);
  }

  /** Issues a new one-time password; revokes sessions and forces a change. */
  async resetPassword(userId: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const temporaryPassword = generateTemporaryPassword();
    const { hashPassword } = await import("better-auth/crypto");
    const passwordHash = await hashPassword(temporaryPassword);

    await this.prisma.$transaction([
      this.prisma.account.updateMany({
        where: { userId, providerId: 'credential' },
        data: { password: passwordHash },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mustChangePassword: true },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);

    await this.audit.record({
      actorId,
      action: 'user.password_reset',
      objectType: 'User',
      objectId: userId,
      // Neither the temporary nor the old password is ever recorded.
      metadata: { sessionsRevoked: true, mustChangePassword: true },
    });
    return { temporaryPassword };
  }

  async setRoles(userId: string, roleKeys: string[], actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    const roles = await this.resolveRoles(roleKeys);

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({ userId, roleId: role.id })),
      }),
    ]);
    await this.audit.record({
      actorId,
      action: 'user.roles_changed',
      objectType: 'User',
      objectId: userId,
      after: { roleKeys: roles.map((role) => role.key) },
    });
    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: userWithRoles,
    });
    return toUserAdminView(updated);
  }

  /** Clears the forced-change flag after a successful password change. */
  async completePasswordChange(userId: string, actorId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { mustChangePassword: false },
    });
    await this.audit.record({
      actorId,
      action: 'user.password_changed',
      objectType: 'User',
      objectId: userId,
    });
  }

  private async resolveRoles(roleKeys: string[]) {
    const roles = await this.prisma.role.findMany({
      where: { key: { in: roleKeys } },
    });
    const found = new Set(roles.map((role) => role.key));
    const missing = roleKeys.filter((key) => !found.has(key));
    if (missing.length > 0) {
      throw new NotFoundException(`Unknown roles: ${missing.join(', ')}`);
    }
    return roles;
  }
}
