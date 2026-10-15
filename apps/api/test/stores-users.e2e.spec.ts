// Stores + user administration integration flows against a live database.
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

suite('stores and users e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let adminCookie: string[];
  // Random suffix keeps reruns idempotent against a persistent database.
  const staffEmail = `staff-flow-${randomBytes(4).toString('hex')}@example.com`;

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
  });

  afterAll(async () => {
    // Remove the randomly-named test account (cascades sessions, accounts,
    // and role assignments) so reruns stay clean.
    const prisma = app?.get(PrismaService);
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: staffEmail } });
    }
    await app?.close();
  });

  // ---------------------------------------------------------------- stores

  it('creates a Store with platform capabilities and starts paused', async () => {
    const res = await agent
      .post('/api/v1/stores')
      .set('Cookie', adminCookie)
      .send({
        platform: 'etsy',
        displayName: 'Attaky Etsy Shop',
        externalShopName: 'attaky.etsy.com',
      })
      .expect(201);
    expect(res.body.connectionState).toBe('paused');
    expect(res.body.capabilities).toMatchObject({
      createFulfillment: true,
      customTrackingUrl: false,
      customerNotification: 'mandated',
    });
  });

  it('pauses and resumes a Store with audit-visible state changes', async () => {
    const created = await agent
      .post('/api/v1/stores')
      .set('Cookie', adminCookie)
      .send({ platform: 'shopify', displayName: 'Attaky Shopify' })
      .expect(201);

    const paused = await agent
      .post(`/api/v1/stores/${created.body.id}/pause`)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(paused.body.connectionState).toBe('paused');

    const resumed = await agent
      .post(`/api/v1/stores/${created.body.id}/resume`)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(resumed.body.connectionState).toBe('connected');
  });

  it('runs manual synchronization after resume (paused stores refuse sync)', async () => {
    const created = await agent
      .post('/api/v1/stores')
      .set('Cookie', adminCookie)
      .send({ platform: 'shopify', displayName: 'Sync Target' })
      .expect(201);
    // Paused stores refuse synchronization (§25: pause prevents new merges).
    await agent
      .post(`/api/v1/stores/${created.body.id}/synchronize`)
      .set('Cookie', adminCookie)
      .expect(409);
    await agent
      .post(`/api/v1/stores/${created.body.id}/resume`)
      .set('Cookie', adminCookie)
      .expect(201);
    // Seed the simulated platform explicitly: the adapter may start empty
    // (SIM_ADAPTER_FIXTURES=none in the demo-seed flow).
    await agent
      .post('/api/v1/platform/simulate/inject-listing')
      .set('Cookie', adminCookie)
      .send({
        externalListingId: 'E2E-LST-1',
        title: 'E2E Listing',
        variants: [{ externalVariantId: 'E2E-VAR-1', externalSku: 'E2E-SKU-1' }],
      })
      .expect(201);
    const res = await agent
      .post(`/api/v1/stores/${created.body.id}/synchronize`)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.summary.listings.total).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------- users

  let tempPassword = '';
  let newUserId = '';
  let forcedCookie: string[];

  it('creates a user with a one-time temporary password and forced change', async () => {
    const res = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: staffEmail, name: 'Staff Flow', roleKeys: ['staff'] })
      .expect(201);
    newUserId = res.body.user.id;
    tempPassword = res.body.temporaryPassword;
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(res.body.user.roleKeys).toContain('staff');
  });

  it('blocks operational access until the forced password change completes', async () => {
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: tempPassword })
      .expect(200);
    forcedCookie = login.headers['set-cookie'] as unknown as string[];

    const me = await agent
      .get('/api/v1/auth/me')
      .set('Cookie', forcedCookie)
      .expect(200);
    expect(me.body.mustChangePassword).toBe(true);

    const blocked = await agent
      .get('/api/v1/items')
      .set('Cookie', forcedCookie)
      .expect(403);
    expect(blocked.body.code).toBe('MUST_CHANGE_PASSWORD');
  });

  it('completes the forced password change and unlocks access', async () => {
    await agent
      .post('/api/v1/users/me/change-password')
      .set('Cookie', forcedCookie)
      .send({ currentPassword: tempPassword, newPassword: 'BrandNew-Pass-9' })
      .expect(200);

    const me = await agent
      .get('/api/v1/auth/me')
      .set('Cookie', forcedCookie)
      .expect(200);
    expect(me.body.mustChangePassword).toBe(false);

    await agent.get('/api/v1/items').set('Cookie', forcedCookie).expect(200);
  });

  it('disables the user and revokes live sessions', async () => {
    await agent
      .post(`/api/v1/users/${newUserId}/set-active`)
      .set('Cookie', adminCookie)
      .send({ isActive: false })
      .expect(201);

    await agent
      .get('/api/v1/items')
      .set('Cookie', forcedCookie)
      .expect(401);
  });

  it('re-issues a one-time password on reset and revokes sessions', async () => {
    // Re-enable first: a disabled account cannot sign in even with a valid
    // one-time password.
    await agent
      .post(`/api/v1/users/${newUserId}/set-active`)
      .set('Cookie', adminCookie)
      .send({ isActive: true })
      .expect(201);

    const res = await agent
      .post(`/api/v1/users/${newUserId}/reset-password`)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(res.body.temporaryPassword).toBeTruthy();
    expect(res.body.temporaryPassword).not.toBe(tempPassword);

    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: res.body.temporaryPassword })
      .expect(200);
    const cookie = login.headers['set-cookie'] as unknown as string[];
    const me = await agent
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.mustChangePassword).toBe(true);
  });

  it('prevents disabling the own administrator account', async () => {
    const adminId = (
      await agent.get('/api/v1/auth/me').set('Cookie', adminCookie).expect(200)
    ).body.id as string;
    const res = await agent
      .post(`/api/v1/users/${adminId}/set-active`)
      .set('Cookie', adminCookie)
      .send({ isActive: false });
    expect(res.status).toBe(409);
  });
});

