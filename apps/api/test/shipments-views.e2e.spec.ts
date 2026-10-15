// Shipments list views and tracking-provider flows (M4d).
// Opt in with: OM_E2E=1 pnpm --filter @om/api test

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundExecutorService } from '../src/shipping/outbound-executor.service';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('shipments views and tracking e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let adminCookie: string[];
  let staffCookie: string[] = [];
  let prisma: PrismaService;
  let executor: OutboundExecutorService;

  const suffix = randomBytes(4).toString('hex');
  const staffEmail = `staff-views-${suffix}@example.com`;
  const carrierKey = `e2e-vw-${suffix}`;
  const noTransformKey = `e2e-nt-${suffix}`;
  const dateSeed = Date.now() % 90_000_000;

  let carrierId = '';
  let noTransformId = '';
  let storeOrderId = '';
  let manualOrderId = '';
  let shipmentId = '';
  let storeId = '';
  let numStore = '';
  let numManual = '';

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
    executor = app.get(OutboundExecutorService);

    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('ADMIN_PASSWORD must be set for the e2e suite.');
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password })
      .expect(200);
    adminCookie = login.headers['set-cookie'] as unknown as string[];

    const staffCreated = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: staffEmail, name: 'Staff Views', roleKeys: ['staff'] })
      .expect(201);
    const tempPassword = staffCreated.body.temporaryPassword as string;
    const staffLogin = await agent
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: tempPassword })
      .expect(200);
    staffCookie = staffLogin.headers['set-cookie'] as unknown as string[];
    await agent
      .post('/api/v1/users/me/change-password')
      .set('Cookie', staffCookie)
      .send({ currentPassword: tempPassword, newPassword: 'Staff-Pass-9' })
      .expect(200);

    // Pin the settings this suite asserts against (parallel spec files).
    await agent
      .patch('/api/v1/shipping-settings')
      .set('Cookie', adminCookie)
      .send({
        initialSyncPolicy: 'review_then_immediate',
        revisionSyncPolicy: 'review_then_scheduled',
        schedule: {
          fixedTime: null,
          windowStart: '09:00',
          windowEnd: '18:00',
          workdaysOnly: true,
        },
      })
      .expect(200);

    const carrier = await agent
      .post('/api/v1/carriers')
      .set('Cookie', adminCookie)
      .send({
        key: carrierKey,
        name: carrierKey.toUpperCase(),
        recognition: { regexes: ['^VV(\\d{8})$'], normalization: { uppercase: true } },
        trackingUrlTemplate: 'https://track.example.com/{number}',
        attakyTransform: {
          rules: [{ pattern: '^VV(\\d{8})$', replacement: 'ATKV$1' }],
          version: 1,
        },
      })
      .expect(201);
    carrierId = carrier.body.id;

    const noTransform = await agent
      .post('/api/v1/carriers')
      .set('Cookie', adminCookie)
      .send({
        key: noTransformKey,
        name: noTransformKey.toUpperCase(),
        recognition: { regexes: ['^NN(\\d{6})$'], normalization: { uppercase: true } },
        trackingUrlTemplate: 'https://carrier.example.com/{number}',
      })
      .expect(201);
    noTransformId = noTransform.body.id;

    // A store order through the simulated import + review pipeline.
    const store = await agent
      .post('/api/v1/stores')
      .set('Cookie', adminCookie)
      .send({ platform: 'shopify', displayName: `Views E2E ${suffix}` })
      .expect(201);
    storeId = store.body.id;
    await agent
      .post(`/api/v1/stores/${storeId}/resume`)
      .set('Cookie', adminCookie)
      .expect(201);
    const display = `VW-A-${suffix}`;
    numStore = 'VV' + String(dateSeed).padStart(8, '0').slice(-8);
    await agent
      .post('/api/v1/platform/simulate/inject-order')
      .set('Cookie', adminCookie)
      .send({
        externalOrderId: `EXT-${display}`,
        displayNumber: display,
        lines: [
          {
            title: 'Views item',
            quantity: 1,
            listingExternalId: `LST-${display}`,
            variantExternalId: `VAR-${display}`,
          },
        ],
        customerName: `Views ${display}`,
      })
      .expect(201);
    await agent
      .post(`/api/v1/stores/${storeId}/synchronize`)
      .set('Cookie', adminCookie)
      .expect(201);
    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: {
        type: 'new_order',
        status: 'pending',
        storeId,
        payload: { path: ['order', 'displayNumber'], equals: display },
      },
    });
    await agent
      .post(`/api/v1/review-queue/${record.id}/approve`)
      .set('Cookie', adminCookie)
      .expect(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { displayNumber: display },
    });
    storeOrderId = order.id;

    const manual = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Views manual item', quantity: 1 }] })
      .expect(201);
    manualOrderId = manual.body.id;
    numManual = 'NN' + String(dateSeed + 5).padStart(6, '0').slice(-6);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({
        where: { id: { in: [storeOrderId, manualOrderId].filter(Boolean) } },
      });
      await prisma.carrier.deleteMany({
        where: { id: { in: [carrierId, noTransformId].filter(Boolean) } },
      });
      await prisma.user.deleteMany({ where: { email: staffEmail } });
    }
    await app?.close();
  });

  it('dbg: staff flag state after beforeAll', async () => {
    const u = await prisma.user.findUnique({ where: { email: staffEmail } });
    console.log('DBG flag after beforeAll:', u?.mustChangePassword, u?.updatedAt.toISOString());
    const sessions = await prisma.session.count({ where: { user: { email: staffEmail } } });
    console.log('DBG staff sessions:', sessions);
  });

  it('lists shipments with sanitized carrier data for staff (§12.14)', async () => {
    const entered = await agent
      .post(`/api/v1/orders/${storeOrderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: numStore, carrierId })
      .expect(201);
    shipmentId = entered.body.id;

    const adminList = await agent
      .get('/api/v1/shipments?view=all')
      .set('Cookie', adminCookie)
      .expect(200);
    const adminRow = (adminList.body.shipments ?? []).find(
      (r: { id: string }) => r.id === shipmentId,
    );
    expect(adminRow).toBeTruthy();
    expect(adminRow.carrier?.key).toBe(carrierKey);
    expect(adminRow.originalTrackingNumber).toBeTruthy();

    const staffList = await agent
      .get('/api/v1/shipments?view=all')
      .set('Cookie', staffCookie)
      .expect(200);
    const staffRow = (staffList.body.shipments ?? []).find(
      (r: { id: string }) => r.id === shipmentId,
    );
    expect(staffRow.carrier).toBeNull();
    expect(staffRow.originalTrackingNumber).toBeNull();
    expect(staffRow.attakyTrackingNumber).toBe(`ATKV${numStore.slice(2)}`);
  });

  it('moves rows between views as the shipment progresses', async () => {
    // pending_review: not in scheduled yet.
    const before = await agent
      .get('/api/v1/shipments?view=scheduled')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (before.body.shipments ?? []).some((r: { id: string }) => r.id === shipmentId),
    ).toBe(false);

    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'shipment', status: 'pending', subjectId: shipmentId },
    });
    await agent
      .post(`/api/v1/review-queue/${record.id}/approve`)
      .set('Cookie', adminCookie)
      .expect(201);

    const scheduled = await agent
      .get('/api/v1/shipments?view=scheduled')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (scheduled.body.shipments ?? []).some((r: { id: string }) => r.id === shipmentId),
    ).toBe(true);

    await executor.executeShipment(shipmentId);

    const after = await agent
      .get('/api/v1/shipments?view=scheduled')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (after.body.shipments ?? []).some((r: { id: string }) => r.id === shipmentId),
    ).toBe(false);
    const all = await agent
      .get('/api/v1/shipments?view=all')
      .set('Cookie', adminCookie)
      .expect(200);
    const row = (all.body.shipments ?? []).find(
      (r: { id: string }) => r.id === shipmentId,
    );
    expect(row.remoteSyncStatus).toBe('synced');
  });

  it('serves the internal tracking snapshot for shipments with an Attaky number', async () => {
    const res = await agent
      .get(`/api/v1/orders/${storeOrderId}/shipments/${shipmentId}/tracking`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.kind).toBe('provider');
    expect(res.body.snapshot.providerKey).toBe('attaky-internal');
    expect(res.body.snapshot.currentStatus).toBe('in_transit');
    expect(res.body.snapshot.events.length).toBeGreaterThanOrEqual(3);
    expect(res.body.snapshot.link).toContain('track.example.com');
  });

  it('falls back to the carrier URL when no provider data applies (§12.6)', async () => {
    const entered = await agent
      .post(`/api/v1/orders/${manualOrderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: numManual, carrierId: noTransformId })
      .expect(201);
    const res = await agent
      .get(`/api/v1/orders/${manualOrderId}/shipments/${entered.body.id}/tracking`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.kind).toBe('fallback');
    expect(res.body.url).toContain('carrier.example.com');
  });
});
