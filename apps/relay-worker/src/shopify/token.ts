import type { ShopifyClientConfig } from "../config.js";

/**
 * Shopify access tokens via the Client Credentials Grant.
 *
 * The grant exchanges the app's client_id/client_secret for a short-lived
 * Admin API access token (~24h). Requirements captured here:
 * - the token endpoint is `POST https://{shop}.myshopify.com/admin/oauth/access_token`
 *   with an `application/x-www-form-urlencoded` body (a GET here fails with 400);
 * - tokens expire, so a cached token is refreshed proactively before the
 *   expiry margin and reactively after `invalidate()` (e.g. a 401);
 * - concurrent command executions must share one token request (single flight).
 */

export interface ShopifyToken {
  accessToken: string;
  expiresAtMs: number;
  scope: string | null;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class ShopifyTokenManager {
  private cached: ShopifyToken | null = null;
  private inflight: Promise<ShopifyToken> | null = null;

  constructor(
    private readonly config: ShopifyClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns a token valid for at least the refresh margin. */
  async getAccessToken(): Promise<string> {
    const token = await this.getToken();
    return token.accessToken;
  }

  async getToken(): Promise<ShopifyToken> {
    if (this.isUsable(this.cached)) {
      return this.cached;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.fetchToken();
    try {
      this.cached = await this.inflight;
      return this.cached;
    } finally {
      this.inflight = null;
    }
  }

  /** Drops the cached token; the next getToken() fetches a fresh one. */
  invalidate(): void {
    this.cached = null;
  }

  private isUsable(token: ShopifyToken | null): token is ShopifyToken {
    if (!token) return false;
    return token.expiresAtMs - REFRESH_MARGIN_MS > this.now();
  }

  private async fetchToken(): Promise<ShopifyToken> {
    const url = `https://${this.config.shopDomain}/admin/oauth/access_token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Shopify token request failed: HTTP ${res.status} ${detail.slice(0, 300)}`,
      );
    }
    const parsed = (await res.json()) as TokenResponse;
    if (!parsed.access_token || typeof parsed.expires_in !== "number") {
      throw new Error("Shopify token response missing access_token/expires_in");
    }
    return {
      accessToken: parsed.access_token,
      expiresAtMs: this.now() + parsed.expires_in * 1000,
      scope: parsed.scope ?? null,
    };
  }
}
