// Manual order lifecycle integration flow against a live database.
// Opt in with: OM_E2E=1 pnpm --filter @om/api test

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ORDER_NUMBER_PATTERN } from '../src/orders/order-number';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('orders e2e (manual lifecycle)', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let adminCookie: string[];
  let staffCookie: string[] = [];
  const staffEmail = `order-staff-${randomBytes(4).toString('hex')}@example.com`;

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
      .send({ email: staffEmail, name: 'Order Staff', roleKeys: ['staff'] })
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
      .send({ currentPassword: temp, newPassword: 'Order-Staff-9' })
      .expect(200);
  });

  afterAll(async () => {
    const prisma = app?.get(PrismaService);
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: staffEmail } });
    }
    await app?.close();
  });

  let orderId = '';

  it('creates a manual order with a title-only line and a customer snapshot', async () => {
    const res = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({
        lines: [
          { title: 'Custom engraved badge', quantity: 2 },
          { title: 'Gift wrapping service' },
        ],
        customer: { name: 'Zhang Wei', email: 'zhang@example.com', country: 'DE' },
        buyerNote: 'Please ship after the 20th.',
        deliveryMethod: 'International tracked',
      })
      .expect(201);
    orderId = res.body.id;
    expect(res.body.displayNumber).toMatch(ORDER_NUMBER_PATTERN);
    expect(res.body.source).toBe('manual');
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.lines[0].quantity).toBe(2);
    expect(res.body.customerSnapshot).toMatchObject({ name: 'Zhang Wei' });
    // Original view captured at creation (§11).
    expect(res.body.rawSource).toMatchObject({ buyerNote: 'Please ship after the 20th.' });
  });

  it('lists and searches orders by number and customer fields', async () => {
    const byNumber = await agent
      .get('/api/v1/orders')
      .set('Cookie', adminCookie)
      .query({ search: 'ATK-ORD' })
      .expect(200);
    expect(byNumber.body.orders.some((o: { id: string }) => o.id === orderId)).toBe(true);

    const byCustomer = await agent
      .get('/api/v1/orders')
      .set('Cookie', adminCookie)
      .query({ search: 'zhang@example.com' })
      .expect(200);
    expect(byCustomer.body.orders.some((o: { id: string }) => o.id === orderId)).toBe(true);
  });

  it('requires a reason for internal revisions and records before/after', async () => {
    await agent
      .patch(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .send({ buyerNote: 'Changed without a reason.' })
      .expect(400);

    const revised = await agent
      .patch(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .send({
        reason: 'Customer asked to change the shipping note.',
        buyerNote: 'Ship after the 25th instead.',
      })
      .expect(200);
    expect(revised.body.buyerNote).toBe('Ship after the 25th instead.');

    const detail = await agent
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(detail.body.revisions).toHaveLength(1);
    expect(detail.body.revisions[0].reason).toContain('shipping note');
    // Original view is immutable after revision.
    expect(detail.body.rawSource.buyerNote).toBe('Please ship after the 20th.');
  });

  it('staff can read orders but cannot create or revise them', async () => {
    await agent.get('/api/v1/orders').set('Cookie', staffCookie).expect(200);
    await agent
      .post('/api/v1/orders')
      .set('Cookie', staffCookie)
      .send({ lines: [{ title: 'Nope' }] })
      .expect(403);
    await agent
      .patch(`/api/v1/orders/${orderId}`)
      .set('Cookie', staffCookie)
      .send({ reason: 'nope', buyerNote: 'nope' })
      .expect(403);
  });

  it('refuses deletion before archiving (§22)', async () => {
    await agent
      .delete(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .send({ reason: 'not archived yet' })
      .expect(409);
  });

  it('archives first, then permanently deletes', async () => {
    await agent
      .post(`/api/v1/orders/${orderId}/archive`)
      .set('Cookie', adminCookie)
      .expect(201);

    const trash = await agent
      .get('/api/v1/orders')
      .set('Cookie', adminCookie)
      .query({ archived: true })
      .expect(200);
    expect(trash.body.orders.some((o: { id: string }) => o.id === orderId)).toBe(true);

    await agent
      .delete(`/api/v1/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .send({ reason: 'E2E cleanup' })
      .expect(200);

    await agent.get(`/api/v1/orders/${orderId}`).set('Cookie', adminCookie).expect(404);
  });
});
