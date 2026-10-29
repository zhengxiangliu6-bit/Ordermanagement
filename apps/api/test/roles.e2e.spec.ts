// Custom role management e2e (M7 R7): role CRUD, the locked administrator
// role, duplicate names, in-use deletes, and live permission effects.
// Opt in with: OM_E2E=1 pnpm --filter @om/api test
// Requires a reachable database (DATABASE_URL) and a seeded administrator.

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('roles e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let adminCookie: string[];
  let prisma: PrismaService;
  const suffix = randomBytes(4).toString('hex');
  const userEmail = `roles-flow-${suffix}@example.com`;
  let createdRoleId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    agent = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('ADMIN_PASSWORD must be set for the e2e suite.');
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password })
      .expect(200);
    adminCookie = login.headers['set-cookie'] as unknown as string[];
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: userEmail } });
      if (createdRoleId) {
        await prisma.userRole.deleteMany({ where: { roleId: createdRoleId } });
        await prisma.role.deleteMany({ where: { id: createdRoleId } });
      }
    }
    await app?.close();
  });

  it('seeds the locked wildcard administrator and the four templates', async () => {
    const res = await agent
      .get('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .expect(200);
    const roles = res.body as {
      key: string;
      locked: boolean;
      permissions: string[];
      userCount: number;
    }[];
    const admin = roles.find((role) => role.key === 'admin');
    expect(admin?.locked).toBe(true);
    expect(admin?.permissions).toEqual(['*']);
    for (const template of ['supervisor', 'packer', 'placer', 'inspector']) {
      const role = roles.find((candidate) => candidate.key === template);
      expect(role, `template ${template} missing`).toBeDefined();
      expect(role?.locked).toBe(false);
      expect(role?.permissions.length).toBeGreaterThan(0);
    }
  });

  it('creates a custom role and reflects it in the list', async () => {
    const res = await agent
      .post('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .send({ name: `测试打包 ${suffix}`, permissions: ['orders:read', 'notes:read'] })
      .expect(201);
    createdRoleId = res.body.id;
    expect(res.body.userCount).toBe(0);
    expect(res.body.permissions).toEqual(['orders:read', 'notes:read']);

    const list = await agent
      .get('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (list.body as { id: string }[]).some((role) => role.id === createdRoleId),
    ).toBe(true);
  });

  it('rejects duplicate role names with a conflict', async () => {
    await agent
      .post('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .send({ name: `测试打包 ${suffix}`, permissions: ['orders:read'] })
      .expect(409);
  });

  it('rejects unknown and wildcard permission keys', async () => {
    await agent
      .post('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .send({ name: `坏权限 ${suffix}`, permissions: ['nope:read'] })
      .expect(409);
    await agent
      .post('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .send({ name: `坏权限 ${suffix}`, permissions: ['*'] })
      .expect(409);
  });

  it('updates the role and echoes the new permission set', async () => {
    const res = await agent
      .patch(`/api/v1/users/roles/${createdRoleId}`)
      .set('Cookie', adminCookie)
      .send({ permissions: ['orders:read'] })
      .expect(200);
    expect(res.body.permissions).toEqual(['orders:read']);
  });

  it('locks the administrator role against edit and delete', async () => {
    const list = await agent
      .get('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .expect(200);
    const admin = (list.body as { key: string; id: string }[]).find(
      (role) => role.key === 'admin',
    );
    await agent
      .patch(`/api/v1/users/roles/${admin!.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Hacked' })
      .expect(403);
    await agent
      .delete(`/api/v1/users/roles/${admin!.id}`)
      .set('Cookie', adminCookie)
      .expect(403);
  });

  it('assigns the role to a user; permissions apply without re-login', async () => {
    const created = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: userEmail, name: 'Roles Flow', roleKeys: ['staff'] })
      .expect(201);
    const userId = created.body.user.id as string;

    const list = await agent
      .get('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (list.body as { id: string; userCount: number }[]).find(
        (role) => role.id === createdRoleId,
      )?.userCount,
    ).toBe(0);

    // Assign by key.
    const roleKey = (
      list.body as { id: string; key: string }[]
    ).find((role) => role.id === createdRoleId)!.key;
    await agent
      .post(`/api/v1/users/${userId}/roles`)
      .set('Cookie', adminCookie)
      .send({ roleKeys: [roleKey] })
      .expect(201);

    const withAssignee = await agent
      .get('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (withAssignee.body as { id: string; userCount: number }[]).find(
        (role) => role.id === createdRoleId,
      )?.userCount,
    ).toBe(1);

    // Deleting a role still in use is refused.
    await agent
      .delete(`/api/v1/users/roles/${createdRoleId}`)
      .set('Cookie', adminCookie)
      .expect(409);

    // Live permission effect: log in and check the effective permissions.
    const userLogin = await agent
      .post('/api/v1/auth/login')
      .send({
        email: userEmail,
        password: created.body.temporaryPassword as string,
      })
      .expect(200);
    const cookie = userLogin.headers['set-cookie'] as unknown as string[];
    const me = await agent
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.permissions).toEqual(['orders:read']);
  });

  it('deletes the role once unassigned', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: userEmail },
      include: { roles: true },
    });
    await agent
      .post(`/api/v1/users/${user.id}/roles`)
      .set('Cookie', adminCookie)
      .send({ roleKeys: ['staff'] })
      .expect(201);
    await agent
      .delete(`/api/v1/users/roles/${createdRoleId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    createdRoleId = '';
  });
});
