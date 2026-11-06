import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EtsyOAuthService } from './etsy-oauth.service';

describe('EtsyOAuthService', () => {
  const oldEnv = { ...process.env };
  const storeId = '11111111-1111-4111-8111-111111111111';
  const pending = new Map<string, any>();
  const saved: any[] = [];
  let service: EtsyOAuthService;

  beforeEach(() => {
    process.env.ETSY_KEYSTRING = 'test-keystring';
    process.env.ETSY_REDIRECT_URI = 'https://etsyapi.beartechworkshop.com';
    process.env.ETSY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    pending.clear();
    saved.length = 0;
    const prisma = {
      store: { findUnique: vi.fn().mockResolvedValue({ id: storeId, platform: 'etsy' }) },
      etsyOAuthPending: {
        create: vi.fn(async ({ data }: any) => { pending.set(data.stateHash, data); }),
        findUnique: vi.fn(async ({ where }: any) => pending.get(where.stateHash) ?? null),
        deleteMany: vi.fn(async ({ where }: any) => {
          const found = pending.get(where.stateHash);
          if (!found || found.storeId !== where.storeId || found.expiresAt <= new Date()) return { count: 0 };
          pending.delete(where.stateHash);
          return { count: 1 };
        }),
      },
      etsyCredential: {
        upsert: vi.fn(async (input: any) => { saved.push(input); }),
        findUnique: vi.fn(async () => null),
      },
    };
    service = new EtsyOAuthService(prisma as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...oldEnv };
  });

  it('generates Etsy PKCE S256 URL with exact registered redirect and required scopes', async () => {
    const { authorizationUrl } = await service.start(storeId);
    const url = new URL(authorizationUrl);
    expect(url.origin).toBe('https://www.etsy.com');
    expect(url.searchParams.get('client_id')).toBe('test-keystring');
    expect(url.searchParams.get('redirect_uri')).toBe('https://etsyapi.beartechworkshop.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('shops_r listings_r transactions_r');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(pending.size).toBe(1);
    expect([...pending.values()][0].verifierCipher).not.toContain('code_verifier');
  });

  it('validates state, exchanges code, and saves ciphertext without exposing tokens', async () => {
    const { authorizationUrl } = await service.start(storeId);
    const state = new URL(authorizationUrl).searchParams.get('state');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'private-access-token',
        refresh_token: 'private-refresh-token',
        expires_in: 3600,
        scope: 'shops_r listings_r transactions_r',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const callback = `https://etsyapi.beartechworkshop.com/?code=one-time-code&state=${state}`;
    const result = await service.complete(storeId, callback);
    expect(result.authorized).toBe(true);
    expect(result).not.toHaveProperty('accessToken');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('redirect_uri')).toBe('https://etsyapi.beartechworkshop.com');
    expect(saved).toHaveLength(1);
    expect(saved[0].create.accessTokenCipher).not.toContain('private-access-token');
    await expect(service.complete(storeId, callback)).rejects.toThrow();
  });

  it('rejects invalid state without contacting Etsy', async () => {
    const { authorizationUrl } = await service.start(storeId);
    const state = new URL(authorizationUrl).searchParams.get('state');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(service.complete(storeId, `https://evil.example/?code=x&state=${state}`)).rejects.toThrow();
    await expect(service.complete(storeId, 'https://etsyapi.beartechworkshop.com/?code=x&state=incorrect')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects expired state', async () => {
    const { authorizationUrl } = await service.start(storeId);
    const state = new URL(authorizationUrl).searchParams.get('state');
    for (const value of pending.values()) value.expiresAt = new Date(Date.now() - 1000);
    await expect(service.complete(storeId, `https://etsyapi.beartechworkshop.com/?code=x&state=${state}`)).rejects.toThrow();
  });
});
