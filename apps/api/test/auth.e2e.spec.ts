// End-to-end authentication flow (login → me → logout) against the
// Better Auth integration.
// Opt in with: OM_E2E=1 pnpm --filter @om/api test
// Requires a reachable database (DATABASE_URL) and a seeded administrator
// (`pnpm db:seed`). Plain `pnpm test` skips this suite.

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('auth e2e (Better Auth)', () => {
  let app: INestApplication;
  let agent: request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    agent = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes a public health endpoint', async () => {
    const res = await agent.get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('rejects unauthenticated /auth/me', async () => {
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('rejects bad credentials', async () => {
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' })
      .expect(401);
  });

  it('logs in the seeded administrator, returns the principal, and logs out', async () => {
    const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
      throw new Error('ADMIN_PASSWORD must be set for the e2e suite.');
    }

    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    expect(login.body).toMatchObject({ email, displayName: 'Administrator' });
    expect(login.body.mustChangePassword).toBe(false);
    // The locked administrator role carries the wildcard (every permission,
    // including future ones) — M7 R7.
    expect(login.body.permissions).toEqual(['*']);
    const cookie = login.headers['set-cookie'] as unknown as string[];
    expect(cookie.join()).toContain('better-auth');

    const me = await agent
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.email).toBe(email);

    await agent.post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    await agent.get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });
});
