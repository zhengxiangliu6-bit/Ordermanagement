// M7 order flow e2e: stage-based import routing, copy numbering, approve-only
// review, manual cancellation, shipping regions, and the packing -> ordering ->
// inspection -> tail workflow. Run against the scratch database:
//   DATABASE_URL=postgresql://om:om_dev_pw@localhost:5432/order_management_e2e \
//   OM_E2E=1 pnpm --filter @om/api test:e2e

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SyncService } from '../src/sync/sync.service';
import type { ExternalOrder } from '../src/platforms/platform-adapter';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('order flow e2e (workflow, copy, cancel)', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let prisma: PrismaService;
  let sync: SyncService;
  let adminCookie: string[];

  const suffix = randomBytes(4).toString('hex');
  const unfulfilledNumber = `#U-${suffix}F`;
  const fulfilledNumber = `#F-${suffix}F`;
  const cancelledNumber = `#C-${suffix}F`;
  const partialNumber = `#P-${suffix}F`;
  const staffEmail = `flow-staff-${suffix}@example.com`;
  const carrierKey = `e2e-carrier-${suffix}`;

  let storeId = '';
  let regionId = '';
  let categoryId = '';
  let carrierId = '';
  let unfulfilledOrderId = '';
  let fulfilledOrderId = '';
  const extraOrderIds: string[] = [];

  function externalOrder(
    key: string,
    displayNumber: string,
    statusRaw: Record<string, unknown>,
  ): ExternalOrder {
    return {
      externalOrderId: `${key}-${suffix}`,
      displayNumber,
      statusRaw,
      customer: { name: `Flow ${key}`, email: `${key.toLowerCase()}-${suffix}@example.com` },
      sourceUpdatedAt: new Date().toISOString(),
      lines: [
        {
          externalLineId: `${key}-${suffix}-L1`,
          title: `Flow line ${key}`,
          quantity: 1,
          listingExternalId: `LST-${key}-${suffix}`,
          variantExternalId: `VAR-${key}-${suffix}`,
        },
      ],
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    agent = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    sync = app.get(SyncService);

    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('ADMIN_PASSWORD must be set for the e2e suite.');
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password })
      .expect(200);
    adminCookie = login.headers['set-cookie'] as unknown as string[];

    const regions = await agent
      .get('/api/v1/shipping-regions')
      .set('Cookie', adminCookie)
      .expect(200);
    regionId = (regions.body as Array<{ id: string }>)[0].id;
    const categories = await agent
      .get('/api/v1/categories')
      .set('Cookie', adminCookie)
      .expect(200);
    categoryId = (categories.body as Array<{ id: string }>)[0].id;

    const carrier = await prisma.carrier.create({
      data: {
        key: carrierKey,
        name: `E2E Carrier ${suffix}`,
        enabled: true,
        recognition: { regexes: [], normalization: { stripSpaces: true, uppercase: true } },
        crossBorder: true,
      },
    });
    carrierId = carrier.id;

    const store = await prisma.store.create({
      data: { platform: 'shopify', displayName: `Flow E2E ${suffix}` },
    });
    storeId = store.id;

    const summary = await sync.runStoreSync(store, [], [
      externalOrder('U', unfulfilledNumber, {
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
      }),
      externalOrder('F', fulfilledNumber, {
        financialStatus: 'PAID',
        fulfillmentStatus: 'FULFILLED',
      }),
      externalOrder('C', cancelledNumber, {
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        cancelledAt: new Date().toISOString(),
      }),
      externalOrder('P', partialNumber, {
        financialStatus: 'PAID',
        fulfillmentStatus: 'PARTIALLY_FULFILLED',
      }),
    ]);

    // Orders are created immediately. Paid unfulfilled/partial orders enter
    // review; fulfilled/cancelled orders jump to their terminal stage.
    expect(summary.orders.staged).toBe(2);
    expect(summary.orders.merged).toBe(2);

    const imported = await prisma.order.findMany({ where: { storeId } });
    expect(imported).toHaveLength(4);
    const byNumber = new Map(imported.map((row) => [row.displayNumber, row]));
    expect(byNumber.get(unfulfilledNumber)?.stage).toBe('review');
    expect(byNumber.get(partialNumber)?.stage).toBe('review');
    expect(byNumber.get(fulfilledNumber)?.stage).toBe('completed');
    expect(byNumber.get(cancelledNumber)?.stage).toBe('cancelled');
    expect(byNumber.get(cancelledNumber)?.cancelledAt).not.toBeNull();
    fulfilledOrderId = byNumber.get(fulfilledNumber)!.id;

    const pending = await prisma.reviewRecord.findMany({
      where: { storeId, type: 'new_order', status: 'pending' },
    });
    expect(pending).toHaveLength(2);

    // Region + category are mandatory before approval.
    await agent
      .post(`/api/v1/review-queue/${pending[0].id}/approve`)
      .set('Cookie', adminCookie)
      .send({ shippingRegionId: regionId })
      .expect(400);
    // Unfulfilled review is approve-only.
    await agent
      .post(`/api/v1/review-queue/${pending[0].id}/reject`)
      .set('Cookie', adminCookie)
      .expect(409);
    for (const record of pending) {
      await agent
        .post(`/api/v1/review-queue/${record.id}/approve`)
        .set('Cookie', adminCookie)
        .send({ shippingRegionId: regionId, categoryId })
        .expect(201);
    }
    const unfulfilled = await prisma.order.findFirstOrThrow({
      where: { storeId, displayNumber: unfulfilledNumber },
    });
    expect(unfulfilled.stage).toBe('packing');
    unfulfilledOrderId = unfulfilled.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.reviewRecord.deleteMany({ where: { storeId } });
      if (extraOrderIds.length > 0) {
        await prisma.reviewRecord.deleteMany({
          where: { subjectId: { in: extraOrderIds } },
        });
        await prisma.order.deleteMany({ where: { id: { in: extraOrderIds } } });
      }
      await prisma.order.deleteMany({ where: { storeId } });
      await prisma.store.deleteMany({ where: { id: storeId } });
      await prisma.user.deleteMany({ where: { email: staffEmail } });
      await prisma.shippingRegion.deleteMany({ where: { name: { contains: suffix } } });
      await prisma.carrier.deleteMany({ where: { key: carrierKey } });
    }
    await app?.close();
  });

  it('numbers copies from the root and queues them for review', async () => {
    const first = await agent
      .post(`/api/v1/orders/${fulfilledOrderId}/copy`)
      .set('Cookie', adminCookie)
      .expect(201);
    extraOrderIds.push(first.body.id);
    expect(first.body.displayNumber).toBe(`${fulfilledNumber}-001`);
    expect(first.body.stage).toBe('review');

    const second = await agent
      .post(`/api/v1/orders/${fulfilledOrderId}/copy`)
      .set('Cookie', adminCookie)
      .expect(201);
    extraOrderIds.push(second.body.id);
    expect(second.body.displayNumber).toBe(`${fulfilledNumber}-002`);

    const third = await agent
      .post(`/api/v1/orders/${first.body.id}/copy`)
      .set('Cookie', adminCookie)
      .expect(201);
    extraOrderIds.push(third.body.id);
    expect(third.body.displayNumber).toBe(`${fulfilledNumber}-003`);

    const copyReview = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: first.body.id },
    });
    const before = await prisma.order.count({
      where: { displayNumber: { startsWith: `${fulfilledNumber}-` } },
    });
    await agent
      .post(`/api/v1/review-queue/${copyReview.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ shippingRegionId: regionId, categoryId, note: `E2E review note ${suffix}` })
      .expect(201);

    const approved = await prisma.reviewRecord.findUniqueOrThrow({
      where: { id: copyReview.id },
    });
    expect(approved.status).toBe('approved');
    const copy = await agent
      .get(`/api/v1/orders/${first.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(copy.body.stage).toBe('packing');
    expect(copy.body.shippingRegion?.id).toBe(regionId);
    expect(
      (copy.body.notes as Array<{ body: string }>).some((note) =>
        note.body.includes(`E2E review note ${suffix}`),
      ),
    ).toBe(true);

    const list = await agent
      .get('/api/v1/orders')
      .set('Cookie', adminCookie)
      .query({ search: `${fulfilledNumber}-001`, pageSize: 10 })
      .expect(200);
    expect(
      (list.body.orders as Array<{ latestReviewNote?: string | null }>).some((row) =>
        row.latestReviewNote?.includes(`E2E review note ${suffix}`),
      ),
    ).toBe(true);
    expect(
      await prisma.order.count({
        where: { displayNumber: { startsWith: `${fulfilledNumber}-` } },
      }),
    ).toBe(before);
  });

  it('returns a packed-stage order back to the unfulfilled review', async () => {
    const created = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Return line', quantity: 1 }] })
      .expect(201);
    const orderId = created.body.id as string;
    extraOrderIds.push(orderId);
    const review = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    await agent
      .post(`/api/v1/review-queue/${review.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ shippingRegionId: regionId, categoryId })
      .expect(201);

    // Packing stage: the packer can send the order back to review.
    await agent
      .post(`/api/v1/shipping-work/${orderId}/return-to-review`)
      .set('Cookie', adminCookie)
      .send({ note: 'customer changed address' })
      .expect(201);

    const order = await agent
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(order.body.stage).toBe('review');

    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    const payload = record.payload as { returnedFromPacking?: boolean; returnedNote?: string | null };
    expect(payload.returnedFromPacking).toBe(true);
    expect(payload.returnedNote).toBe('customer changed address');

    // The old review record is decided; re-approving it is refused.
    await agent
      .post(`/api/v1/review-queue/${review.id}/approve`)
      .set('Cookie', adminCookie)
      .expect(409);
  });

  it('returns an ordering-stage order back to review with its note', async () => {
    const created = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Ordering return line', quantity: 1 }] })
      .expect(201);
    const orderId = created.body.id as string;
    extraOrderIds.push(orderId);
    const review = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    await agent
      .post(`/api/v1/review-queue/${review.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ shippingRegionId: regionId, categoryId })
      .expect(201);

    await agent
      .post(`/api/v1/shipping-work/${orderId}/pack`)
      .set('Cookie', adminCookie)
      .send({
        weightValue: 200,
        weightUnit: 'g',
        lengthValue: 10,
        widthValue: 10,
        heightValue: 10,
        dimensionUnit: 'cm',
      })
      .expect(201);
    // Ordering-stage orders can also return to review.
    await agent
      .post(`/api/v1/shipping-work/${orderId}/return-to-review`)
      .set('Cookie', adminCookie)
      .send({ note: 'wrong carrier chosen' })
      .expect(201);

    const order = await agent
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(order.body.stage).toBe('review');
    const record = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    const payload = record.payload as {
      returnedFromPacking?: boolean;
      returnedNote?: string | null;
    };
    expect(payload.returnedFromPacking).toBe(true);
    expect(payload.returnedNote).toBe('wrong carrier chosen');
  });

  it('requires orders:cancel for manual cancellation', async () => {
    const created = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email: staffEmail, name: 'Flow Staff', roleKeys: ['staff'] })
      .expect(201);
    const temp = created.body.temporaryPassword as string;
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: temp })
      .expect(200);
    const cookie = login.headers['set-cookie'] as unknown as string[];
    await agent
      .post('/api/v1/users/me/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: temp, newPassword: 'Flow-Pass-9' })
      .expect(200);

    await agent
      .post(`/api/v1/orders/${unfulfilledOrderId}/cancel`)
      .set('Cookie', cookie)
      .send({ reason: 'denied' })
      .expect(403);
  });

  it('cancels manually and closes the pending review', async () => {
    const created = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({
        lines: [{ title: 'Manual cancel line', quantity: 1 }],
        customer: { name: 'Manual Cancel' },
      })
      .expect(201);
    extraOrderIds.push(created.body.id);
    expect(created.body.stage).toBe('review');
    const review = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: created.body.id },
    });

    await agent
      .post(`/api/v1/orders/${created.body.id}/cancel`)
      .set('Cookie', adminCookie)
      .send({ reason: 'manual test' })
      .expect(201);

    const closed = await prisma.reviewRecord.findUniqueOrThrow({
      where: { id: review.id },
    });
    expect(closed.status).toBe('cancelled');
    const reloaded = await agent
      .get(`/api/v1/orders/${created.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(reloaded.body.stage).toBe('cancelled');
  });

  it('filters the order list by operational status', async () => {
    const ids = async (status: string) => {
      const res = await agent
        .get('/api/v1/orders')
        .set('Cookie', adminCookie)
        .query({ storeId, status, pageSize: 50 })
        .expect(200);
      return (res.body.orders as Array<{ displayNumber: string }>).map(
        (row) => row.displayNumber,
      );
    };

    expect(await ids('fulfilled')).toEqual([fulfilledNumber]);
    const cancelled = await ids('cancelled');
    expect(cancelled).toContain(cancelledNumber);

    const unfulfilled = await ids('unfulfilled');
    expect(unfulfilled).toContain(unfulfilledNumber);
    expect(unfulfilled).toContain(partialNumber);
    expect(unfulfilled).not.toContain(fulfilledNumber);
    expect(unfulfilled).not.toContain(cancelledNumber);
  });

  it('manages configurable shipping regions', async () => {
    const created = await agent
      .post('/api/v1/shipping-regions')
      .set('Cookie', adminCookie)
      .send({ name: `E2E Region ${suffix}`, sortOrder: 99 })
      .expect(201);
    const renamed = await agent
      .patch(`/api/v1/shipping-regions/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ name: `E2E Region Renamed ${suffix}` })
      .expect(200);
    expect(renamed.body.name).toBe(`E2E Region Renamed ${suffix}`);
    await agent
      .delete(`/api/v1/shipping-regions/${created.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
  });

  it('runs packing -> ordering -> inspection -> tail on a manual order', async () => {
    const created = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({
        lines: [{ title: 'Workflow line', quantity: 2 }],
        customer: { name: 'Workflow Customer', addressLine1: '1 Test Road' },
      })
      .expect(201);
    const orderId = created.body.id as string;
    const displayNumber = created.body.displayNumber as string;
    extraOrderIds.push(orderId);
    const review = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    const detailBefore = await agent
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    const lineId = (detailBefore.body.lines as Array<{ id: string }>)[0].id;
    const editedItems = await agent
      .patch(`/api/v1/orders/${orderId}/review-items`)
      .set('Cookie', adminCookie)
      .send({
        lines: [
          { id: lineId, title: 'Workflow line updated', quantity: 3 },
          { title: 'Extra product', quantity: 1 },
        ],
      })
      .expect(200);
    expect(editedItems.body.lines).toHaveLength(2);
    expect(
      (editedItems.body.lines as Array<{ title: string; quantity: number }>).map((line) => [
        line.title,
        line.quantity,
      ]),
    ).toEqual([
      ['Workflow line updated', 3],
      ['Extra product', 1],
    ]);
    const queued = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    const queuedPayload = queued.payload as {
      order?: { lines?: Array<{ title: string }> };
    };
    expect(queuedPayload.order?.lines).toHaveLength(2);

    const edited = await agent
      .patch(`/api/v1/orders/${orderId}/review-customer`)
      .set('Cookie', adminCookie)
      .send({ name: 'Workflow Customer Updated', addressLine1: '2 New Road' })
      .expect(200);
    expect(edited.body.customerSnapshot.name).toBe('Workflow Customer Updated');
    await agent
      .post(`/api/v1/review-queue/${review.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ shippingRegionId: regionId, categoryId })
      .expect(201);

    await agent
      .post(`/api/v1/shipping-work/${orderId}/add-ons`)
      .set('Cookie', adminCookie)
      .send({ title: 'Gift sticker', quantity: 2 })
      .expect(201);

    const packing = await agent
      .get('/api/v1/shipping-work/packing')
      .set('Cookie', adminCookie)
      .expect(200);
    const packingRow = (packing.body as Array<{
      id: string;
      addOns: Array<{ title: string; quantity: number }>;
    }>).find((row) => row.id === orderId);
    expect(packingRow?.addOns?.[0]?.title).toBe('Gift sticker');
    expect(packingRow?.addOns?.[0]?.quantity).toBe(2);

    await agent
      .post(`/api/v1/shipping-work/${orderId}/pack`)
      .set('Cookie', adminCookie)
      .send({
        weightValue: 250,
        weightUnit: 'g',
        lengthValue: 30,
        widthValue: 20,
        heightValue: 10,
        dimensionUnit: 'cm',
        note: 'pack note',
      })
      .expect(201);

    const ordering = await agent
      .get('/api/v1/shipping-work/ordering')
      .set('Cookie', adminCookie)
      .expect(200);
    const orderingRow = (ordering.body as Array<{
      id: string;
      shipments: Array<{ weightGrams: number }>;
      addOns: Array<{ title: string }>;
    }>).find((row) => row.id === orderId);
    expect(orderingRow?.shipments?.[0]?.weightGrams).toBe(250);
    expect(orderingRow?.addOns?.[0]?.title).toBe('Gift sticker');

    await agent
      .post(`/api/v1/shipping-work/${orderId}/tracking`)
      .set('Cookie', adminCookie)
      .send({ carrierId, trackingNumber: 'E2E123456789' })
      .expect(201);

    const inspection = await agent
      .get('/api/v1/shipping-work/inspection')
      .set('Cookie', adminCookie)
      .expect(200);
    expect((inspection.body as Array<{ id: string }>).some((row) => row.id === orderId)).toBe(true);

    await agent
      .post(`/api/v1/shipping-work/${orderId}/inspect`)
      .set('Cookie', adminCookie)
      .send({ note: 'inspect note' })
      .expect(201);

    const completed = await agent
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(completed.body.stage).toBe('completed');
    expect(completed.body.fulfillmentStatus).toBe('FULFILLED');

    const activeList = await agent
      .get('/api/v1/orders')
      .set('Cookie', adminCookie)
      .query({ stageGroup: 'active', search: displayNumber, pageSize: 10 })
      .expect(200);
    expect(
      (activeList.body.orders as Array<{ id: string }>).some((row) => row.id === orderId),
    ).toBe(false);
    const finishedList = await agent
      .get('/api/v1/orders')
      .set('Cookie', adminCookie)
      .query({ stageGroup: 'finished', search: displayNumber, pageSize: 10 })
      .expect(200);
    expect(
      (finishedList.body.orders as Array<{ id: string }>).some((row) => row.id === orderId),
    ).toBe(true);
    const events = completed.body.stageEvents as Array<{
      action: string;
      note: string | null;
      actorName: string | null;
    }>;
    expect(events.find((event) => event.action === 'packed')?.note).toBe('pack note');
    expect(events.find((event) => event.action === 'inspected')?.note).toBe('inspect note');
    expect(events.find((event) => event.action === 'packed')?.actorName).toBe('Administrator');

    // Cross-border carrier -> the completed shipment appears in the tail queue.
    const tailBefore = await agent
      .get('/api/v1/shipping-work/tail')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (tailBefore.body as Array<{ order: { id: string } }>).some(
        (row) => row.order.id === orderId,
      ),
    ).toBe(true);

    await agent
      .post(`/api/v1/shipping-work/${orderId}/tail`)
      .set('Cookie', adminCookie)
      .send({ tailTrackingNumber: 'TAIL-E2E-1', tailCarrier: 'E2E Tail', tailTrackingUrl: 'https://tail.example.com/1' })
      .expect(201);

    const tailAfter = await agent
      .get('/api/v1/shipping-work/tail')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (tailAfter.body as Array<{ order: { id: string } }>).some(
        (row) => row.order.id === orderId,
      ),
    ).toBe(false);
  });

  it('reports a problem item and restarts the original', async () => {
    const created = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Problem line', quantity: 1 }] })
      .expect(201);
    const orderId = created.body.id as string;
    extraOrderIds.push(orderId);
    const review = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    await agent
      .post(`/api/v1/review-queue/${review.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ shippingRegionId: regionId, categoryId })
      .expect(201);

    const reported = await agent
      .post(`/api/v1/shipping-work/${orderId}/problem`)
      .set('Cookie', adminCookie)
      .send({ type: 'damaged', content: 'Box crushed on arrival' })
      .expect(201);

    const order = await agent
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(order.body.stage).toBe('problem');
    expect(order.body.problemItems[0].status).toBe('open');
    expect(order.body.problemItems[0].reportedByName).toBe('Administrator');

    const list = await agent
      .get('/api/v1/problem-items')
      .set('Cookie', adminCookie)
      .expect(200);
    expect((list.body as Array<{ id: string }>).some((row) => row.id === reported.body.id)).toBe(true);

    await agent
      .post(`/api/v1/problem-items/${reported.body.id}/resolve`)
      .set('Cookie', adminCookie)
      .send({ resolution: 'restart', note: 'Repack with extra padding' })
      .expect(201);

    const restarted = await agent
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(restarted.body.stage).toBe('packing');
    expect(restarted.body.problemItems[0].status).toBe('resolved_restart');
    expect(
      (restarted.body.problemItems[0].resolutionNote as string),
    ).toBe('Repack with extra padding');
    // The resolution note is recorded in the order notes section.
    expect(
      (restarted.body.notes as Array<{ body: string }>).some((note) =>
        note.body.includes('Repack with extra padding'),
      ),
    ).toBe(true);
  });

  it('copies a new order from a problem item and closes the original', async () => {
    const created = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Copy problem line', quantity: 1 }] })
      .expect(201);
    const orderId = created.body.id as string;
    extraOrderIds.push(orderId);
    const review = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    await agent
      .post(`/api/v1/review-queue/${review.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ shippingRegionId: regionId, categoryId })
      .expect(201);

    const reported = await agent
      .post(`/api/v1/shipping-work/${orderId}/problem`)
      .set('Cookie', adminCookie)
      .send({ type: 'address', content: 'Customer asked to reship elsewhere' })
      .expect(201);

    const resolved = await agent
      .post(`/api/v1/problem-items/${reported.body.id}/resolve`)
      .set('Cookie', adminCookie)
      .send({ resolution: 'copy', note: 'Reship to the new address' })
      .expect(201);
    expect(resolved.body.copiedOrderId).toBeTruthy();
    extraOrderIds.push(resolved.body.copiedOrderId as string);

    const original = await agent
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(original.body.stage).toBe('cancelled');

    const copy = await agent
      .get(`/api/v1/orders/${resolved.body.copiedOrderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(copy.body.stage).toBe('packing');
    expect(copy.body.shippingRegion?.id).toBe(regionId);
  });
});
