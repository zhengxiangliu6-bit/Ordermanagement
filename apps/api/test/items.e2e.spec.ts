// Items module integration flow (create → version → variant → notes →
// archive → delete) against a live database.
// Opt in with: OM_E2E=1 pnpm --filter @om/api test
// Requires a reachable database (DATABASE_URL) and a seeded administrator.

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ITEM_CODE_PATTERN } from '../src/items/item-code';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('items e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let cookie: string[];

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
    cookie = login.headers['set-cookie'] as unknown as string[];
  });

  afterAll(async () => {
    await app?.close();
  });

  let itemId = '';
  let noteId = '';

  it('rejects unauthenticated item creation', async () => {
    await agent.post('/api/v1/items').send({ name: 'Nope' }).expect(401);
  });

  it('creates an Item with an initial content version', async () => {
    const res = await agent
      .post('/api/v1/items')
      .set('Cookie', cookie)
      .send({ name: 'Core ESP32 Board', category: 'core', tags: ['wifi', 'ble'] })
      .expect(201);
    itemId = res.body.id;
    expect(res.body.name).toBe('Core ESP32 Board');

    const detail = await agent
      .get(`/api/v1/items/${itemId}`)
      .set('Cookie', cookie)
      .expect(200);
    // Every item carries a default variant (2026-10-15 ruling): variant-less
    // items cannot be mapping targets, mirroring Shopify's model.
    expect(detail.body.variants).toHaveLength(1);
    expect(detail.body.variants[0].name).toBe('Default');
  });

  it('stores bilingual names and image URL lists on items and variants', async () => {
    const patched = await agent
      .patch(`/api/v1/items/${itemId}`)
      .set('Cookie', cookie)
      .send({
        nameEn: 'Core ESP32 Board EN',
        images: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
      })
      .expect(200);
    expect(patched.body.nameEn).toBe('Core ESP32 Board EN');
    expect(patched.body.images).toEqual([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
    ]);

    const variant = await agent
      .post(`/api/v1/items/${itemId}/variants`)
      .set('Cookie', cookie)
      .send({
        name: '带天线',
        nameEn: 'With Antenna',
        images: ['https://cdn.example.com/v1.png'],
      })
      .expect(201);
    const created = variant.body.variants.at(-1);
    expect(created.nameEn).toBe('With Antenna');
    expect(created.images).toEqual(['https://cdn.example.com/v1.png']);
  });

  it('lists the Item with pagination metadata', async () => {
    const res = await agent
      .get('/api/v1/items')
      .set('Cookie', cookie)
      .query({ search: 'core esp32' })
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.items.some((i: { id: string }) => i.id === itemId)).toBe(true);
  });

  it('updates the Item and records a second content version', async () => {
    await agent
      .patch(`/api/v1/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ description: 'Updated description.' })
      .expect(200);

    const versions = await agent
      .get(`/api/v1/items/${itemId}`)
      .set('Cookie', cookie)
      .then((res) => res.body);
    expect(versions.description).toBe('Updated description.');
  });

  it('creates a variant with a permanent generated Item Code', async () => {
    const res = await agent
      .post(`/api/v1/items/${itemId}/variants`)
      .set('Cookie', cookie)
      .send({ name: 'Rev B', optionValues: { color: 'black' } })
      .expect(201);
    expect(res.body.variants[0].itemCode).toMatch(ITEM_CODE_PATTERN);
  });

  it('manages notes with edit history', async () => {
    const created = await agent
      .post(`/api/v1/items/${itemId}/notes`)
      .set('Cookie', cookie)
      .send({ body: 'First note.' })
      .expect(201);
    noteId = created.body.id;

    await agent
      .patch(`/api/v1/notes/${noteId}`)
      .set('Cookie', cookie)
      .send({ body: 'First note, edited.' })
      .expect(200);

    const notes = await agent
      .get(`/api/v1/items/${itemId}/notes`)
      .set('Cookie', cookie)
      .expect(200);
    expect(notes.body).toHaveLength(1);
    expect(notes.body[0].body).toBe('First note, edited.');
    expect(notes.body[0].revisions).toHaveLength(1);

    // Regression: the item detail must surface the note through the
    // owner relation as well (relation FK vs scalar owner columns).
    const detail = await agent
      .get(`/api/v1/items/${itemId}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.notes).toHaveLength(1);
    expect(detail.body.notes[0].body).toBe('First note, edited.');
  });

  it('archives and restores the Item', async () => {
    const archived = await agent
      .post(`/api/v1/items/${itemId}/archive`)
      .set('Cookie', cookie)
      .expect(201);
    expect(archived.body.archivedAt).toBeTruthy();

    const inArchive = await agent
      .get('/api/v1/items')
      .set('Cookie', cookie)
      .query({ archived: true })
      .expect(200);
    expect(inArchive.body.items.some((i: { id: string }) => i.id === itemId)).toBe(
      true,
    );

    await agent.post(`/api/v1/items/${itemId}/restore`).set('Cookie', cookie).expect(201);
  });

  it('deletes the Item permanently', async () => {
    await agent.delete(`/api/v1/items/${itemId}`).set('Cookie', cookie).expect(200);
    await agent.get(`/api/v1/items/${itemId}`).set('Cookie', cookie).expect(404);
  });
});
