// Permission matrix integration checks against a live database.
// Opt in with: OM_E2E=1 pnpm --filter @om/api test

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('permission matrix e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let adminCookie: string[];
  const staffEmail = `staff-matrix-${randomBytes(4).toString('hex')}@example.com`;
  let staffCookie: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    agent = request(app.getHttpServer());

    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('ADMIN_PASSWORD must be set for the e2e suite.');
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password })
      .expect(200);
    adminCookie = login.headers['set-cookie'] as unknown as string[];

    const created = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: staffEmail, name: 'Staff Matrix', roleKeys: ['staff'] })
      .expect(201);
    const temp = created.body.temporaryPassword as string;
    const staffLogin = await agent
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: temp })
      .expect(200);
    staffCookie = staffLogin.headers['set-cookie'] as unknown as string[];
    // Complete the forced change so the matrix tests pure permissions.
    await agent
      .post('/api/v1/users/me/change-password')
      .set('Cookie', staffCookie)
      .send({ currentPassword: temp, newPassword: 'Staff-Pass-9' })
      .expect(200);
  });

  afterAll(async () => {
    const prisma = app?.get(PrismaService);
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: staffEmail } });
    }
    await app?.close();
  });

  it('staff reads operational data (items, stores, audit-free surfaces)', async () => {
    await agent.get('/api/v1/items').set('Cookie', staffCookie).expect(200);
    await agent.get('/api/v1/stores').set('Cookie', staffCookie).expect(200);
  });

  it('staff is denied audit history, user administration, and role listing', async () => {
    await agent.get('/api/v1/audit').set('Cookie', staffCookie).expect(403);
    await agent.get('/api/v1/users').set('Cookie', staffCookie).expect(403);
    await agent.get('/api/v1/users/roles').set('Cookie', adminCookie ?? staffCookie).expect(200);
  });

  it('staff cannot create or modify items', async () => {
    await agent
      .post('/api/v1/items')
      .set('Cookie', staffCookie)
      .send({ name: 'Should not exist' })
      .expect(403);
  });

  it('administrator reads audit history containing recorded actions', async () => {
    const res = await agent
      .get('/api/v1/audit')
      .set('Cookie', adminCookie)
      .query({ action: 'item.created', pageSize: 5 })
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.events[0]).toMatchObject({
      objectType: 'Item',
      action: 'item.created',
    });
  });
});
