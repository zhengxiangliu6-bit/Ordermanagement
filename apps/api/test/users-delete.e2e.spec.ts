// User deletion e2e: permission gating, self-delete refusal, and the
// last-administrator guard. Also checks that account creation has its own
// permission (users:create) separate from deletion (users:delete).
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

suite('user deletion e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let prisma: PrismaService;
  let adminCookie: string[];
  let adminId = '';
  const suffix = randomBytes(4).toString('hex');
  const roleKey = `user-deleter-${suffix}`;
  const staffEmail = `del-staff-${suffix}@example.com`;
  const deleterEmail = `del-operator-${suffix}@example.com`;
  const targetEmail = `del-target-${suffix}@example.com`;
  let staffCookie: string[] = [];
  let deleterCookie: string[] = [];
  let targetId = '';

  async function loginAfterForcedChange(email: string, tempPassword: string) {
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: tempPassword })
      .expect(200);
    const cookie = login.headers['set-cookie'] as unknown as string[];
    await agent
      .post('/api/v1/users/me/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: tempPassword, newPassword: 'Del-Pass-9' })
      .expect(200);
    return cookie;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    adminId = login.body.id as string;

    // A role that may read and delete users, but not create them.
    await agent
      .post('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .send({ key: roleKey, name: `User deleter ${suffix}`, permissions: ['users:read', 'users:delete'] })
      .expect(201);

    const staff = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: staffEmail, name: 'Del Staff', roleKeys: ['staff'] })
      .expect(201);
    staffCookie = await loginAfterForcedChange(staffEmail, staff.body.temporaryPassword);

    const deleter = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: deleterEmail, name: 'Del Operator', roleKeys: [roleKey] })
      .expect(201);
    deleterCookie = await loginAfterForcedChange(
      deleterEmail,
      deleter.body.temporaryPassword,
    );

    const target = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: targetEmail, name: 'Del Target', roleKeys: ['staff'] })
      .expect(201);
    targetId = target.body.user.id as string;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({
        where: { email: { in: [staffEmail, deleterEmail, targetEmail] } },
      });
      await prisma.role.deleteMany({ where: { key: roleKey } });
    }
    await app?.close();
  });

  it('refuses both creating and deleting users without the permissions', async () => {
    await agent
      .post('/api/v1/users')
      .set('Cookie', staffCookie)
      .send({ email: `nope-${suffix}@example.com`, name: 'Nope' })
      .expect(403);
    await agent
      .delete(`/api/v1/users/${targetId}`)
      .set('Cookie', staffCookie)
      .expect(403);
  });

  it('keeps creation and deletion as separate permissions', async () => {
    // The deleter role has users:delete but not users:create.
    await agent
      .post('/api/v1/users')
      .set('Cookie', deleterCookie)
      .send({ email: `nope2-${suffix}@example.com`, name: 'Nope' })
      .expect(403);
    await agent
      .get('/api/v1/users')
      .set('Cookie', deleterCookie)
      .expect(200);
  });

  it('allows a user with users:delete to delete an account', async () => {
    await agent
      .delete(`/api/v1/users/${targetId}`)
      .set('Cookie', deleterCookie)
      .expect(200);
    const list = await agent
      .get('/api/v1/users')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (list.body as { id: string }[]).some((user) => user.id === targetId),
    ).toBe(false);
  });

  it('refuses deleting the last administrator', async () => {
    const res = await agent
      .delete(`/api/v1/users/${adminId}`)
      .set('Cookie', deleterCookie)
      .expect(409);
    expect(res.body.message).toContain('last administrator');
  });

  it('refuses deleting your own account', async () => {
    await agent
      .delete(`/api/v1/users/${adminId}`)
      .set('Cookie', adminCookie)
      .expect(409);
  });
});
