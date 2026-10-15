// Seeds the initial roles and the first administrator.
//
// The administrator account is created through Better Auth itself so the
// stored credential uses Better Auth's own hashing and account layout.
// ADMIN_EMAIL / ADMIN_PASSWORD come from apps/api/.env (never committed).
// Re-running the seed updates roles but keeps an existing account's
// password; delete the user row first to rotate the initial credential.

import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, READ_ONLY_PERMISSIONS } from '@om/shared';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const adminRole = await prisma.role.upsert({
    where: { key: 'admin' },
    update: { permissions: [...ALL_PERMISSIONS] },
    create: {
      key: 'admin',
      name: 'Administrator',
      permissions: [...ALL_PERMISSIONS],
    },
  });

  await prisma.role.upsert({
    where: { key: 'staff' },
    update: { permissions: [...READ_ONLY_PERMISSIONS] },
    create: {
      key: 'staff',
      name: 'Staff',
      permissions: [...READ_ONLY_PERMISSIONS],
    },
  });

  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      'ADMIN_PASSWORD must be set (see .env.example) to seed the administrator.',
    );
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Seed-only Better Auth instance: the application itself disables signup.
    const { createAuth } = await import('../src/auth/better-auth.js');
    const auth = await createAuth(prisma, { allowSignUp: true });
    await auth.api.signUpEmail({
      body: { email, password, name: 'Administrator' },
    });
    user = await prisma.user.findUniqueOrThrow({ where: { email } });
    console.log(`Created administrator account: ${email}`);
  } else {
    console.log(
      `Administrator ${email} already exists; password left unchanged.`,
    );
  }

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });

  console.log('Seeded roles (admin, staff) and role assignment.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
