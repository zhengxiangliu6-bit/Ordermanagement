import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

export const userWithRolesInclude = Prisma.validator<Prisma.UserInclude>()({
  roles: { include: { role: true } },
});

export type UserWithRoles = Prisma.UserGetPayload<{
  include: typeof userWithRolesInclude;
}>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads a user with its roles for principal construction. */
  findAuthUserById(id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: userWithRolesInclude,
    });
  }
}

/** Merges the Better Auth identity with Order Management RBAC data. */
export function toAuthUser(user: UserWithRoles): AuthUser {
  const permissions = [
    ...new Set(user.roles.flatMap((userRole) => userRole.role.permissions)),
  ];
  return {
    id: user.id,
    email: user.email,
    displayName: user.name,
    permissions,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}
