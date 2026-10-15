// M2.2 integration flows: customer related-order suggestions/linking and
// attachment upload/download/delete.
// Opt in with: OM_E2E=1 pnpm --filter @om/api test

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('related orders and attachments e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let adminCookie: string[];

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
    await app?.close();
  });

  const createOrder = async (customer: Record<string, string>) => {
    const res = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({ lines: [{ title: 'Line' }], customer })
      .expect(201);
    return res.body.id as string;
  };

  let primary = '';
  let sameAddress = '';

  it('suggests strong matches for normalized email/phone and weak for address', async () => {
    primary = await createOrder({
      name: 'Li Na',
      email: 'li.na@EXAMPLE.com',
      phone: '+49 30 1234567',
      addressLine1: 'Hauptstraße 12',
    });
    await createOrder({
      name: 'Li Na (2)',
      email: 'li.na@example.com',
      addressLine1: 'Other street 99',
    });
    sameAddress = await createOrder({
      name: 'Someone Else',
      email: 'different@corp.io',
      addressLine1: 'hauptstrasse 12',
    });

    const res = await agent
      .get(`/api/v1/orders/${primary}/related`)
      .set('Cookie', adminCookie)
      .expect(200);
    const strongEmails = res.body.suggestions.strong.map(
      (s: { customerSnapshot: Record<string, string> }) => s.customerSnapshot?.email,
    );
    expect(strongEmails).toContain('li.na@example.com');
    const weakNames = res.body.suggestions.weak.map(
      (s: { customerSnapshot: Record<string, string> }) => s.customerSnapshot?.name,
    );
    expect(weakNames).toContain('Someone Else');
  });

  it('links two orders manually, once each direction', async () => {
    const link = await agent
      .post(`/api/v1/orders/${primary}/links`)
      .set('Cookie', adminCookie)
      .send({ relatedOrderId: sameAddress })
      .expect(201);
    expect(link.body.linkId).toBeTruthy();

    const duplicate = await agent
      .post(`/api/v1/orders/${primary}/links`)
      .set('Cookie', adminCookie)
      .send({ relatedOrderId: sameAddress });
    expect(duplicate.status).toBe(409);

    const linked = await agent
      .get(`/api/v1/orders/${primary}/related`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      linked.body.manual.some(
        (m: { orderId: string }) => m.orderId === sameAddress,
      ),
    ).toBe(true);

    const unlink = await agent
      .delete(`/api/v1/orders/${primary}/links/${link.body.linkId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(unlink.body.ok).toBe(true);
  });

  it('uploads, lists, downloads, and deletes an order attachment', async () => {
    const uploaded = await agent
      .post('/api/v1/attachments')
      .set('Cookie', adminCookie)
      .field('ownerType', 'order')
      .field('ownerId', primary)
      .attach('file', Buffer.from('attachment-content-123'), {
        filename: 'proof.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const attachmentId = uploaded.body.id as string;
    expect(uploaded.body.filename).toBe('proof.txt');

    const list = await agent
      .get('/api/v1/attachments')
      .query({ ownerType: 'order', ownerId: primary })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(list.body.some((a: { id: string }) => a.id === attachmentId)).toBe(true);

    const download = await agent
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(download.text).toBe('attachment-content-123');

    await agent
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    await agent
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('rejects uploads without a file and for unknown owners', async () => {
    await agent
      .post('/api/v1/attachments')
      .set('Cookie', adminCookie)
      .field('ownerType', 'order')
      .field('ownerId', primary)
      .expect(400);
    await agent
      .post('/api/v1/attachments')
      .set('Cookie', adminCookie)
      .field('ownerType', 'nonsense')
      .field('ownerId', primary)
      .attach('file', Buffer.from('x'), { filename: 'x.txt' })
      .expect(400);
  });
});
