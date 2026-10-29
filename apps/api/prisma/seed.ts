// Seeds the initial roles and the first administrator.
//
// The administrator account is created through Better Auth itself so the
// stored credential uses Better Auth's own hashing and account layout.
// ADMIN_EMAIL / ADMIN_PASSWORD come from apps/api/.env (never committed).
// Re-running the seed updates roles but keeps an existing account's
// password; delete the user row first to rotate the initial credential.

import { PrismaClient } from '@prisma/client';
import {
  READ_ONLY_PERMISSIONS,
  WILDCARD_PERMISSION,
  type PermissionKey,
} from '@om/shared';

const prisma = new PrismaClient();

/**
 * M7 R7 preset role templates (supervisor / packer / placer / inspector).
 * Templates are ordinary editable roles: administrators adjust or delete
 * them after seeding. M7b/c/d extend them with pipeline permissions
 * (weigh / tracking backfill / spot-check / problem items / inventory).
 */
const ROLE_TEMPLATES: { key: string; name: string; permissions: PermissionKey[] }[] = [
  {
    key: 'supervisor',
    name: '主管',
    permissions: [
      ...READ_ONLY_PERMISSIONS,
      'orders:create-manual',
      'orders:revise',
      'orders:review',
      'orders:archive',
      'orders:restore',
      'orders:cancel',
      'shipping:return',
      'notes:create',
      'notes:edit-own',
      'notes:edit-all',
      'notes:delete',
      'categories:read',
      'categories:manage',
      'shipping:issue-review',
      'inventory:read',
      'inventory:manage',
    ],
  },
  {
    key: 'packer',
    name: '打包',
    permissions: [
      'orders:read',
      'items:read',
      'mapping:read',
      'notes:read',
      'notes:create',
      'shipping:read',
      'shipping:weigh',
      'shipping:return',
    ],
  },
  {
    key: 'placer',
    name: '下单',
    permissions: [
      'orders:read',
      'items:read',
      'shipping:read',
      'shipping:backfill',
      'shipping:issue-report',
      'inventory:read',
      'carrier-providers:read',
      'notes:read',
      'notes:create',
    ],
  },
  {
    key: 'inspector',
    name: '质检',
    permissions: [
      'orders:read',
      'items:read',
      'shipping:read',
      'shipping:inspect',
      'shipping:tail',
      'inventory:read',
      'shipping:issue-report',
      'notes:read',
      'notes:create',
    ],
  },
];

async function main(): Promise<void> {
  // The administrator role is locked (no edit/delete) and carries the
  // wildcard so permissions added in future releases apply automatically.
  const adminRole = await prisma.role.upsert({
    where: { key: 'admin' },
    update: { permissions: [WILDCARD_PERMISSION] },
    create: {
      key: 'admin',
      name: 'Administrator',
      permissions: [WILDCARD_PERMISSION],
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

  for (const template of ROLE_TEMPLATES) {
    await prisma.role.upsert({
      where: { key: template.key },
      update: { name: template.name },
      create: template,
    });
  }

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

  const categories = [
    { name: 'Beartech', sortOrder: 1 },
    { name: 'Attaky', sortOrder: 2 },
    { name: '其他', sortOrder: 3 },
    { name: '检测', sortOrder: 4 },
  ];
  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: { sortOrder: category.sortOrder },
      create: category,
    });
  }
  console.log('Seeded default categories.');

  const shippingMethods = [
    { name: '云途发货', sortOrder: 1 },
    { name: '4px发货', sortOrder: 2 },
    { name: '加拿大发货', sortOrder: 3 },
    { name: '顺丰发货', sortOrder: 4 },
  ];
  for (const method of shippingMethods) {
    await prisma.shippingMethod.upsert({
      where: { name: method.name },
      update: { sortOrder: method.sortOrder },
      create: method,
    });
  }
  console.log('Seeded default shipping methods.');

  const shippingRegions = [
    { name: '中国', sortOrder: 1, warehouse: 'china' },
    { name: '加拿大', sortOrder: 2, warehouse: 'canada' },
  ];
  for (const region of shippingRegions) {
    await prisma.shippingRegion.upsert({
      where: { name: region.name },
      update: { sortOrder: region.sortOrder, warehouse: region.warehouse },
      create: region,
    });
  }
  console.log('Seeded default shipping regions.');
  console.log('Seeded roles (admin, staff, 4 templates) and role assignment.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
