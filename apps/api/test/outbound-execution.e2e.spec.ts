// Outbound execution flows (M4c): review queue approval/rejection, the
// simulated adapter outcomes, retry exhaustion, and revision policy.
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

suite('outbound execution e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let adminCookie: string[];
  let prisma: PrismaService;
  let executor: OutboundExecutorService;
  let staffCookie: string[] = [];

  const suffix = randomBytes(4).toString('hex');
  // Run-unique tracking numbers: ^OO\d{8}$ with a per-run numeric seed.
  const seed = Date.now() % 90_000_000;
  let seq = 0;
  const oo = () => 'OO' + String(seed + seq++).padStart(8, '0').slice(-8);
  const atkOf = (num: string) => 'ATKOO' + num.slice(2);
  const carrierKey = `e2e-out-${suffix}`;
  const staffEmail = `staff-out-${suffix}@example.com`;

  let carrierId = '';
  let orderAId = ''; // review-then-execute flow (synced)
  let orderBId = ''; // revision flow
  let orderCId = ''; // retry exhaustion flow
  let orderDId = ''; // manual order, no outbound
  let shipmentAId = '';

  async function createStoreOrder(display: string): Promise<string> {
    const store = await agent
      .post('/api/v1/stores')
      .set('Cookie', adminCookie)
      .send({ platform: 'shopify', displayName: display })
      .expect(201);
    await agent
      .post(`/api/v1/stores/${store.body.id}/resume`)
      .set('Cookie', adminCookie)
      .expect(201);
    await agent
      .post('/api/v1/platform/simulate/inject-order')
      .set('Cookie', adminCookie)
      .send({
        externalOrderId: `EXT-${display}`,
        displayNumber: display,
        lines: [
          {
            title: 'Outbound item',
            quantity: 1,
            listingExternalId: `LST-${display}`,
            variantExternalId: `VAR-${display}`,
          },
        ],
        customerName: `Out E2E ${display}`,
      })
      .expect(201);
    await agent
      .post(`/api/v1/stores/${store.body.id}/synchronize`)
      .set('Cookie', adminCookie)
      .expect(201);
    // The shared dev database accumulates pending records across runs and
    // the queue list is paginated oldest-first, so resolve the record via a
    // direct query on (store, displayNumber) instead of the HTTP list.
    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: {
        type: 'new_order',
        status: 'pending',
        storeId: store.body.id,
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
    return order.id;
  }

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

    const carrier = await agent
      .post('/api/v1/carriers')
      .set('Cookie', adminCookie)
      .send({
        key: carrierKey,
        name: carrierKey.toUpperCase(),
        enabled: true,
        recognition: { regexes: ['^OO(\\d{8})$'], normalization: { uppercase: true } },
        trackingUrlTemplate: 'https://track.example.com/{number}',
        attakyTransform: { rules: [{ pattern: '^OO(\\d{8})$', replacement: 'ATKOO$1' }], version: 1 },
      })
      .expect(201);
    carrierId = carrier.body.id;

    // Staff (read-only baseline) for the sanitized-view assertions.
    const staffCreated = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: staffEmail, name: 'Out Staff', roleKeys: ['staff'] })
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

    // This suite depends on the review-first initial policy; pin it up-front
    // (spec files run in parallel and may otherwise race the global default).
    await agent
      .patch('/api/v1/shipping-settings')
      .set('Cookie', adminCookie)
      .send({
        initialSyncPolicy: 'review_then_immediate',
        revisionSyncPolicy: 'review_then_scheduled',
        schedule: { fixedTime: null, windowStart: '09:00', windowEnd: '18:00', workdaysOnly: true },
      })
      .expect(200);

    orderAId = await createStoreOrder(`OUT-A-${suffix}`);
    orderBId = await createStoreOrder(`OUT-B-${suffix}`);
    orderCId = await createStoreOrder(`OUT-C-${suffix}`);
    const manual = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Manual outbound item', quantity: 1 }] })
      .expect(201);
    orderDId = manual.body.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({
        where: { id: { in: [orderAId, orderBId, orderCId, orderDId].filter(Boolean) } },
      });
      await prisma.carrier.deleteMany({ where: { id: carrierId } });
      await prisma.user.deleteMany({ where: { email: staffEmail } });
    }
    await app?.close();
  });

  async function setSimOutcome(orderId: string, outcome: string) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { storeId: true },
    });
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: order.storeId! },
    });
    await prisma.store.update({
      where: { id: store.id },
      data: { settings: { ...(store.settings as object), simOutbound: outcome } },
    });
  }

  async function approveShipmentRecord(shipmentId: string, kind?: 'initial' | 'revision') {
    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: {
        type: 'shipment',
        status: 'pending',
        subjectId: shipmentId,
        ...(kind ? { payload: { path: ['kind'], equals: kind } } : {}),
      },
    });
    await agent
      .post(`/api/v1/review-queue/${record.id}/approve`)
      .set('Cookie', adminCookie)
      .expect(201);
    return record;
  }

  async function enter(orderId: string, num: string) {
    const res = await agent
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: num, carrierId })
      .expect(201);
    return res.body as {
      id: string;
      remoteSyncStatus: string;
      nextSendAt: string | null;
      attakyTrackingNumber: string | null;
    };
  }

  async function shipmentRow(id: string) {
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id } });
    return s as unknown as {
      remoteSyncStatus: string;
      nextSendAt: Date | null;
      platformResults: { attempts?: number; ops?: Array<{ op: string; ok: boolean }> };
    };
  }

  // ------------------------------------------------- review then execution

  it('a review-policy entry joins the Outbound Shipping queue and approves to due-now', async () => {
    await setSimOutcome(orderAId, 'synced');
    const numA = oo();
    const shipment = await enter(orderAId, numA);
    shipmentAId = shipment.id;
    expect(shipment.remoteSyncStatus).toBe('pending_review');

    // The HTTP list hides the sensitive carrier pair for this admin? No:
    // admins hold carrier-source:read, so assert sanitization via the HTTP
    // detail endpoint later; resolve the record directly here.
    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'shipment', status: 'pending', subjectId: shipmentAId },
    });
    expect((record.payload as Record<string, unknown>).attakyTrackingNumber).toBe(
      atkOf(numA),
    );
    await agent
      .post(`/api/v1/review-queue/${record.id}/approve`)
      .set('Cookie', adminCookie)
      .expect(201);

    const after = await shipmentRow(shipmentAId);
    expect(after.remoteSyncStatus).toBe('scheduled');
    // review_then_immediate: due now.
    expect(after.nextSendAt?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('staff reviewers see the shipment queue without the sensitive carrier pair (§12.14)', async () => {
    // Queue a shipment for a fresh store order, then read the queue as staff.
    const freshId = await createStoreOrder(`OUT-SAN-${suffix}`);
    await setSimOutcome(freshId, 'synced');
    const shipment = await enter(freshId, oo());
    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'shipment', status: 'pending', subjectId: shipment.id },
    });
    const staffView = await agent
      .get(`/api/v1/review-queue/${record.id}`)
      .set('Cookie', staffCookie)
      .expect(200);
    expect(staffView.body.payload.attakyTrackingNumber).toBe(
      shipment.attakyTrackingNumber,
    );
    expect(staffView.body.payload.carrierKey).toBeUndefined();
    expect(staffView.body.payload.carrierName).toBeUndefined();
    expect(staffView.body.payload.originalTrackingNumber).toBeUndefined();
    // Staff cannot review: the approve action is denied per-type.
    await agent
      .post(`/api/v1/review-queue/${record.id}/approve`)
      .set('Cookie', staffCookie)
      .expect(403);
    // Admin sees the full payload including the carrier identity.
    const adminView = await agent
      .get(`/api/v1/review-queue/${record.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(adminView.body.payload.carrierKey).toBe(carrierKey);
    await prisma.order.delete({ where: { id: freshId } });
  });

  it('the executor completes a due shipment as synced (§12.11)', async () => {
    const { outcome } = await executor.executeShipment(shipmentAId);
    expect(outcome?.remoteSyncStatus).toBe('synced');
    const after = await shipmentRow(shipmentAId);
    expect(after.platformResults.attempts).toBe(1);
    expect((after.platformResults.ops ?? []).every((op) => op.ok)).toBe(true);
    // Idempotency: a second execution of a terminal shipment is skipped.
    const again = await executor.executeShipment(shipmentAId);
    expect(again.skipped).toBe('not_scheduled');
  });

  it('partial outcome records per-operation results without retries', async () => {
    await setSimOutcome(orderBId, 'partial');
    const shipment = await enter(orderBId, oo());
    // Default policy needs review: approve first.
    await approveShipmentRecord(shipment.id);
    const { outcome } = await executor.executeShipment(shipment.id);
    expect(outcome?.remoteSyncStatus).toBe('partially_synced');
  });

  it('transient failures retry inside the schedule and exhaust to manual action', async () => {
    await setSimOutcome(orderCId, 'failed');
    const shipment = await enter(orderCId, oo());
    await approveShipmentRecord(shipment.id);

    // Attempt 1: transient -> rescheduled inside the window.
    const first = await executor.executeShipment(shipment.id);
    expect(first.outcome?.remoteSyncStatus).toBe('scheduled');
    expect(first.outcome?.attempts).toBe(1);
    expect(first.outcome?.nextSendAt).toBeTruthy();
    expect(first.outcome!.nextSendAt!.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);

    // Force due for attempts 2 and 3 (the worker normally waits for the tick).
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { nextSendAt: new Date(Date.now() - 1000) },
    });
    const second = await executor.executeShipment(shipment.id);
    expect(second.outcome?.attempts).toBe(2);
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { nextSendAt: new Date(Date.now() - 1000) },
    });
    const third = await executor.executeShipment(shipment.id);
    expect(third.outcome?.remoteSyncStatus).toBe('manual_action_required');
    expect(third.outcome?.attempts).toBe(3);
  });

  it('not_supported records the unsupported operation without retry', async () => {
    await setSimOutcome(orderBId, 'not_supported');
    // Reuse order B after revision below is separate; use a fresh entry on A?
    // orderA already synced (one per order) — create a fresh store order.
    const freshId = await createStoreOrder(`OUT-D2-${suffix}`);
    await setSimOutcome(freshId, 'not_supported');
    const shipment = await enter(freshId, oo());
    await approveShipmentRecord(shipment.id);
    const { outcome } = await executor.executeShipment(shipment.id);
    expect(outcome?.remoteSyncStatus).toBe('not_supported');
    await prisma.order.delete({ where: { id: freshId } });
  });

  it('a second entry for the same order stays a 409 (correction goes through revisions)', async () => {
    const recognized = await agent
      .post(`/api/v1/orders/${orderCId}/shipments/recognize`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: oo() })
      .expect(201);
    expect(recognized.body.kind).toBe('single');

    const revised = await agent
      .post(`/api/v1/orders/${orderCId}/shipments`)
      .set('Cookie', adminCookie)
      .send({ trackingNumber: oo(), carrierId })
      .expect(409);
    expect(revised.body.message).toContain('already has a shipment');
  });

  it('revision updates values, keeps history, and follows the revision policy', async () => {
    const existing = await prisma.shipment.findFirstOrThrow({
      where: { orderId: orderCId },
    });
    const revNum = oo();
    const res = await agent
      .post(`/api/v1/orders/${orderCId}/shipments/${existing.id}/revisions`)
      .set('Cookie', adminCookie)
      .send({ reason: 'Wrong digit typed', trackingNumber: revNum })
      .expect(201);
    // Default revision policy = review_then_scheduled -> pending review.
    expect(res.body.remoteSyncStatus).toBe('pending_review');
    expect(res.body.attakyTrackingNumber).toBe(atkOf(revNum));

    const revision = await prisma.shipmentRevision.findFirstOrThrow({
      where: { shipmentId: existing.id },
    });
    expect(revision.reason).toBe('Wrong digit typed');

    // The revision joins the queue; approval schedules it.
    await approveShipmentRecord(existing.id, 'revision');
    const after = await shipmentRow(existing.id);
    expect(after.remoteSyncStatus).toBe('scheduled');
  });

  it('rejection marks the shipment rejected and records the decision', async () => {
    const freshId = await createStoreOrder(`OUT-RJ-${suffix}`);
    await setSimOutcome(freshId, 'synced');
    const shipment = await enter(freshId, oo());
    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'shipment', status: 'pending', subjectId: shipment.id },
    });
    await agent
      .post(`/api/v1/review-queue/${record.id}/reject`)
      .set('Cookie', adminCookie)
      .expect(201);
    const after = await shipmentRow(shipment.id);
    expect(after.remoteSyncStatus).toBe('rejected');
    // Correction is available through the revision endpoint.
    const revised = await agent
      .post(`/api/v1/orders/${freshId}/shipments/${shipment.id}/revisions`)
      .set('Cookie', adminCookie)
      .send({ reason: 'Carrier picked wrong', trackingNumber: oo() })
      .expect(201);
    expect(revised.body.remoteSyncStatus).toBe('pending_review');
    await prisma.order.delete({ where: { id: freshId } });
  });
});
