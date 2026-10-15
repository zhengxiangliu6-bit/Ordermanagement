// Shipment entry + outbound policy/scheduling integration flows (M4b).
// Opt in with: OM_E2E=1 pnpm --filter @om/api test

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('shipments and outbound scheduling e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let adminCookie: string[];
  let staffCookie: string[] = [];
  let prisma: PrismaService;

  const suffix = randomBytes(4).toString('hex');
  const staffEmail = `staff-ship-${suffix}@example.com`;
  const carrierAKey = `e2e-aa-${suffix}`;
  const carrierBKey = `e2e-bb-${suffix}`;
  const carrierCKey = `e2e-cc-${suffix}`;
  const carrierDKey = `e2e-dd-${suffix}`;

  let carrierAId = '';
  let carrierBId = '';
  let carrierCId = '';
  let carrierDId = '';
  let manualOrderId = '';
  let storeOrderId = '';
  let storeId = '';
  let secondManualOrderId = '';
  const storeDisplayNumber = `E2E-SHIP-${suffix}`;

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

    // Staff (read-only baseline: shipping:read but not shipping:enter).
    const created = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: staffEmail, name: 'Staff Ship', roleKeys: ['staff'] })
      .expect(201);
    const temp = created.body.temporaryPassword as string;
    const staffLogin = await agent
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: temp })
      .expect(200);
    staffCookie = staffLogin.headers['set-cookie'] as unknown as string[];
    await agent
      .post('/api/v1/users/me/change-password')
      .set('Cookie', staffCookie)
      .send({ currentPassword: temp, newPassword: 'Staff-Pass-9' })
      .expect(200);

    // Pin the policy defaults this suite asserts against (parallel spec
    // files may otherwise race the global settings).
    await agent
      .patch('/api/v1/shipping-settings')
      .set('Cookie', adminCookie)
      .send({
        initialSyncPolicy: 'review_then_immediate',
        revisionSyncPolicy: 'review_then_scheduled',
        schedule: { fixedTime: null, windowStart: '09:00', windowEnd: '18:00', workdaysOnly: true },
      })
      .expect(200);

    // Carriers: A and C both match ^AA\d{10}$ (ambiguity pair); B is unique.
    // A/B/C transforms are injective (capture group passes through); D maps
    // every number to one constant so the DB-level collision path is testable.
    const carrierDto = (key: string, regex: string, replacement: string) => ({
      key,
      name: key.toUpperCase(),
      enabled: true,
      recognition: { regexes: [regex], normalization: { uppercase: true } },
      trackingUrlTemplate: 'https://track.example.com/{number}',
      attakyTransform: { rules: [{ pattern: regex, replacement }], version: 1 },
    });
    const a = await agent
      .post('/api/v1/carriers')
      .set('Cookie', adminCookie)
      .send(carrierDto(carrierAKey, '^AA(\\d{10})$', 'ATKAA$1'))
      .expect(201);
    carrierAId = a.body.id;
    const b = await agent
      .post('/api/v1/carriers')
      .set('Cookie', adminCookie)
      .send(carrierDto(carrierBKey, '^XX(\\d{8})$', 'ATKXX$1'))
      .expect(201);
    carrierBId = b.body.id;
    const c = await agent
      .post('/api/v1/carriers')
      .set('Cookie', adminCookie)
      .send(carrierDto(carrierCKey, '^AA(\\d{10})$', 'ATKCC$1'))
      .expect(201);
    carrierCId = c.body.id;
    const d = await agent
      .post('/api/v1/carriers')
      .set('Cookie', adminCookie)
      .send(carrierDto(carrierDKey, '^DD(\\d{6})$', 'ATK-DD-CONSTANT'))
      .expect(201);
    carrierDId = d.body.id;

    // A manual order (§12.13: no outbound synchronization).
    const manual = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({
        lines: [{ title: 'Shipment e2e item', quantity: 1 }],
        customer: { name: 'E2E Manual', email: 'manual@example.com' },
      })
      .expect(201);
    manualOrderId = manual.body.id;

    // A store order through the simulated platform import + review flow.
    const store = await agent
      .post('/api/v1/stores')
      .set('Cookie', adminCookie)
      .send({ platform: 'etsy', displayName: `Ship E2E ${suffix}` })
      .expect(201);
    storeId = store.body.id;
    await agent
      .post(`/api/v1/stores/${storeId}/resume`)
      .set('Cookie', adminCookie)
      .expect(201);
    await agent
      .post('/api/v1/platform/simulate/inject-order')
      .set('Cookie', adminCookie)
      .send({
        externalOrderId: `EXT-${suffix}`,
        displayNumber: storeDisplayNumber,
        lines: [
          {
            title: 'Store item',
            quantity: 1,
            listingExternalId: `LST-${suffix}`,
            variantExternalId: `VAR-${suffix}`,
          },
        ],
        customerName: 'E2E Store',
      })
      .expect(201);
    await agent
      .post(`/api/v1/stores/${storeId}/synchronize`)
      .set('Cookie', adminCookie)
      .expect(201);
    // Resolve the run's own record directly: the shared dev database
    // accumulates pending records across runs and the HTTP list paginates
    // oldest-first, which can push this record off the first page.
    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: {
        type: 'new_order',
        status: 'pending',
        storeId,
        payload: { path: ['order', 'displayNumber'], equals: storeDisplayNumber },
      },
    });
    await agent
      .post(`/api/v1/review-queue/${record.id}/approve`)
      .set('Cookie', adminCookie)
      .expect(201);
    const orders = await agent
      .get('/api/v1/orders')
      .set('Cookie', adminCookie)
      .query({ pageSize: 50 })
      .expect(200);
    storeOrderId = (orders.body.orders ?? []).find(
      (o: { displayNumber: string }) => o.displayNumber === storeDisplayNumber,
    )?.id;
    expect(storeOrderId).toBeTruthy();

    const secondManual = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Collision target', quantity: 1 }] })
      .expect(201);
    secondManualOrderId = secondManual.body.id;
  });

  afterAll(async () => {
    // Clean the run's business rows so reruns stay deterministic; order
    // deletion cascades shipments, leaving carriers deletable.
    if (prisma) {
      await prisma.order.deleteMany({
        where: { id: { in: [manualOrderId, secondManualOrderId, storeOrderId].filter(Boolean) } },
      });
      await prisma.carrier.deleteMany({
        where: {
          id: { in: [carrierAId, carrierBId, carrierCId, carrierDId].filter(Boolean) },
        },
      });
      await prisma.user.deleteMany({ where: { email: staffEmail } });
    }
    await app?.close();
  });

  // ------------------------------------------------------------- settings

  it('returns singleton settings with first-release defaults', async () => {
    const res = await agent
      .get('/api/v1/shipping-settings')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.id).toBe('singleton');
    expect(res.body.externalTimezone).toBe('Asia/Shanghai');
    expect(['immediate', 'scheduled', 'review_then_immediate', 'review_then_scheduled']).toContain(
      res.body.initialSyncPolicy,
    );
  });

  it('rejects an unknown timezone and an inverted window', async () => {
    await agent
      .patch('/api/v1/shipping-settings')
      .set('Cookie', adminCookie)
      .send({ externalTimezone: 'Mars/Olympus' })
      .expect(400);
    await agent
      .patch('/api/v1/shipping-settings')
      .set('Cookie', adminCookie)
      .send({ schedule: { windowStart: '18:00', windowEnd: '09:00' } })
      .expect(400);
  });

  it('staff cannot change shipping settings', async () => {
    await agent
      .patch('/api/v1/shipping-settings')
      .set('Cookie', staffCookie)
      .send({ externalTimezone: 'UTC' })
      .expect(403);
  });

  // ------------------------------------------------------- recognition

  it('recognizes a single carrier match with a full preview', async () => {
    const res = await agent
      .post(`/api/v1/orders/${storeOrderId}/shipments/recognize`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: `xx12345678` })
      .expect(201);
    expect(res.body.kind).toBe('single');
    expect(res.body.carrier.key).toBe(carrierBKey);
    expect(res.body.carrier.preview.attakyTrackingNumber).toBe('ATKXX12345678');
  });

  it('reports ambiguity instead of silently choosing (§12.3)', async () => {
    const res = await agent
      .post(`/api/v1/orders/${storeOrderId}/shipments/recognize`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: 'AA1234567890' })
      .expect(201);
    expect(res.body.kind).toBe('ambiguous');
    expect(res.body.candidates.map((c: { key: string }) => c.key).sort()).toEqual(
      [carrierAKey, carrierCKey].sort(),
    );
  });

  it('falls back to the enabled-carrier list when no rule matches', async () => {
    const res = await agent
      .post(`/api/v1/orders/${storeOrderId}/shipments/recognize`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: 'ZZ-nothing-matches' })
      .expect(201);
    expect(res.body.kind).toBe('none');
    expect(res.body.carriers.length).toBeGreaterThanOrEqual(3);
  });

  it('staff is denied shipment entry actions', async () => {
    await agent
      .post(`/api/v1/orders/${storeOrderId}/shipments/recognize`)
      .set('Cookie', staffCookie)
      .send({ trackingNumber: 'AA1234567890' })
      .expect(403);
  });

  // -------------------------------------------------------- preview/entry

  it('previews policy and projected send time before submission (§12.3 step 6)', async () => {
    const res = await agent
      .post(`/api/v1/orders/${storeOrderId}/shipments/preview`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: 'AA1234567890', carrierId: carrierAId })
      .expect(201);
    expect(res.body.plan.policyMode).toBe('review_then_immediate'); // first-release default
    expect(res.body.plan.remoteSyncStatus).toBe('pending_review');
    expect(res.body.plan.plannedSendAt).toBeTruthy();
    expect(res.body.plan.customerNotification).toBe('mandated'); // Etsy capability
  });

  it('schedules a store order entry under a scheduled policy (§12.7/§12.8)', async () => {
    // Per-store override (§12.8) — keeps the global default intact for the
    // parallel spec files and later tests in this file.
    await agent
      .patch(`/api/v1/stores/${storeId}`)
      .set('Cookie', adminCookie)
      .send({ shippingPolicyOverride: { initial: 'scheduled' } })
      .expect(200);

    const res = await agent
      .post(`/api/v1/orders/${storeOrderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: 'AA1234567890', carrierId: carrierAId })
      .expect(201);
    expect(res.body.localStatus).toBe('dispatched');
    expect(res.body.remoteSyncStatus).toBe('scheduled');
    expect(res.body.policyMode).toBe('scheduled');
    expect(res.body.nextSendAt).toBeTruthy();
    // Inside the allowed window the next permitted time is now (§12.7);
    // out-of-window math is covered by the outbound-policy unit tests.
    expect(new Date(res.body.nextSendAt).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
    expect(res.body.publicTrackingMode).toBe('attaky');
    expect(res.body.ruleVersion).toBe(1);
    // Clear the override so later runs/tests see the global default.
    await agent
      .patch(`/api/v1/stores/${storeId}`)
      .set('Cookie', adminCookie)
      .send({ shippingPolicyOverride: null })
      .expect(200);
  });

  it('manual orders skip outbound synchronization (§12.13)', async () => {
    const res = await agent
      .post(`/api/v1/orders/${manualOrderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: `xx87654321`, carrierId: carrierBId })
      .expect(201);
    expect(res.body.remoteSyncStatus).toBe('not_applicable');
    expect(res.body.nextSendAt).toBeNull();
  });

  it('rejects a second shipment for the same order (first release: one per order)', async () => {
    await agent
      .post(`/api/v1/orders/${storeOrderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: 'AA0987654321', carrierId: carrierCId })
      .expect(409);
  });

  it('rejects a duplicate transformed Attaky tracking number (DB-level collision)', async () => {
    // Carrier D maps every DD-number to one constant Attaky number.
    await agent
      .post(`/api/v1/orders/${secondManualOrderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: 'DD111111', carrierId: carrierDId })
      .expect(201);
    const third = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Collision source', quantity: 1 }] })
      .expect(201);
    const res = await agent
      .post(`/api/v1/orders/${third.body.id}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: 'DD222222', carrierId: carrierDId })
      .expect(409);
    expect(res.body.message).toContain('already exists');
    await prisma.order.delete({ where: { id: third.body.id } });
  });

  it('lists shipments for the order and records the entry in audit history', async () => {
    const res = await agent
      .get(`/api/v1/orders/${storeOrderId}/shipments`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].carrier.key).toBe(carrierAKey);

    const audit = await agent
      .get('/api/v1/audit')
      .set('Cookie', adminCookie)
      .query({ action: 'shipment.entered', pageSize: 5 })
      .expect(200);
    expect(audit.body.total).toBeGreaterThanOrEqual(2);
  });

  // Restore first-release defaults for any suites that run after this one.
  it('restores default settings', async () => {
    await agent
      .patch('/api/v1/shipping-settings')
      .set('Cookie', adminCookie)
      .send({
        initialSyncPolicy: 'review_then_immediate',
        schedule: {
          fixedTime: null,
          windowStart: '09:00',
          windowEnd: '18:00',
          workdaysOnly: true,
        },
      })
      .expect(200);
  });
});
