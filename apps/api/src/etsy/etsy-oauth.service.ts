import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const REDIRECT_URI = 'https://etsyapi.beartechworkshop.com';
const TOKEN_ENDPOINT = 'https://api.etsy.com/v3/public/oauth/token';
const AUTH_ENDPOINT = 'https://www.etsy.com/oauth/connect';
const SCOPES = 'shops_r listings_r transactions_r';
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Only the private NestJS backend handles PKCE and tokens. */
@Injectable()
export class EtsyOAuthService {
  constructor(private readonly prisma: PrismaService) {}

  private config(): { clientId: string; key: Buffer } {
    const clientId = process.env.ETSY_KEYSTRING?.trim();
    const key = Buffer.from(process.env.ETSY_TOKEN_ENCRYPTION_KEY ?? '', 'base64');
    if (!clientId || key.length !== 32) {
      throw new ServiceUnavailableException('Etsy OAuth is not configured on the private API.');
    }
    if (process.env.ETSY_REDIRECT_URI && process.env.ETSY_REDIRECT_URI !== REDIRECT_URI) {
      throw new ServiceUnavailableException('Etsy redirect URI does not match the registered redirect.');
    }
    return { clientId, key };
  }

  private seal(value: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  private open(ciphertext: string, key: Buffer): string {
    const raw = Buffer.from(ciphertext, 'base64');
    if (raw.length < 29) throw new Error('Invalid encrypted payload');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }

  private stateHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async start(storeId: string): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const { clientId, key } = this.config();
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Store not found');
    if (store.platform !== 'etsy') throw new ConflictException('Store is not an Etsy store');

    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
    await this.prisma.etsyOAuthPending.create({
      data: {
        stateHash: this.stateHash(state),
        storeId,
        verifierCipher: this.seal(verifier, key),
        expiresAt,
      },
    });
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async complete(storeId: string, callbackUrl: string): Promise<{ authorized: boolean; scopes: string[]; accessExpiresAt: string }> {
    const { clientId, key } = this.config();
    let callback: URL;
    try { callback = new URL(callbackUrl); }
    catch { throw new BadRequestException('Invalid callback URL'); }

    // Compare against Etsy's registered redirect, including host and path.
    if (callback.protocol !== 'https:' ||
        callback.host !== 'etsyapi.beartechworkshop.com' ||
        callback.pathname !== '/' ||
        callback.username || callback.password ||
        callback.hash || callback.searchParams.has('error')) {
      throw new BadRequestException('Unexpected Etsy callback URL');
    }
    const states = callback.searchParams.getAll('state');
    const codes = callback.searchParams.getAll('code');
    if (states.length !== 1 || codes.length !== 1 || !states[0] || !codes[0]) {
      throw new BadRequestException('Missing or duplicate OAuth code/state');
    }
    const state = states[0];
    const code = codes[0];
    const hashed = this.stateHash(state);
    const pending = await this.prisma.etsyOAuthPending.findUnique({ where: { stateHash: hashed } });
    if (!pending || pending.storeId !== storeId || pending.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Expired or invalid authorization state');
    }

    // Atomic one-use claim prevents two requests from redeeming the same code.
    const claim = await this.prisma.etsyOAuthPending.deleteMany({
      where: { stateHash: hashed, storeId, expiresAt: { gt: new Date() } },
    });
    if (claim.count !== 1) throw new BadRequestException('Authorization state already used');

    let response: Response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code,
          code_verifier: this.open(pending.verifierCipher, key),
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ServiceUnavailableException('Cannot connect to Etsy token endpoint; start a new authorization.');
    }
    if (!response.ok) {
      throw new BadRequestException('Etsy rejected the authorization code; start a new authorization.');
    }
    let json: unknown;
    try { json = await response.json(); }
    catch { throw new BadRequestException('Etsy returned invalid token data'); }
    if (!json || typeof json !== 'object') throw new BadRequestException('Etsy returned invalid token data');
    const result = json as Record<string, unknown>;
    const access = result.access_token;
    const refresh = result.refresh_token;
    const seconds = result.expires_in;
    const scope = typeof result.scope === 'string' ? result.scope : '';
    if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh ||
        typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new BadRequestException('Etsy token response is incomplete');
    }
    const accessExpiresAt = new Date(Date.now() + seconds * 1000);
    await this.prisma.etsyCredential.upsert({
      where: { storeId },
      create: {
        storeId, accessTokenCipher: this.seal(access, key),
        refreshTokenCipher: this.seal(refresh, key), accessExpiresAt, scopes: scope,
      },
      update: {
        accessTokenCipher: this.seal(access, key),
        refreshTokenCipher: this.seal(refresh, key), accessExpiresAt, scopes: scope,
      },
    });
    // Do not set connected until shop identity and scopes are verified.
    return { authorized: true, scopes: scope.split(' ').filter(Boolean), accessExpiresAt: accessExpiresAt.toISOString() };
  }

  async status(storeId: string): Promise<{ authorized: boolean; accessExpiresAt?: string; scopes?: string[] }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { platform: true } });
    if (!store) throw new NotFoundException('Store not found');
    if (store.platform !== 'etsy') throw new ConflictException('Store is not an Etsy store');
    const credentials = await this.prisma.etsyCredential.findUnique({ where: { storeId } });
    if (!credentials) return { authorized: false };
    return {
      authorized: true,
      accessExpiresAt: credentials.accessExpiresAt.toISOString(),
      scopes: credentials.scopes.split(' ').filter(Boolean),
    };
  }
}
