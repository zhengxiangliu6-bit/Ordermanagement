// Relay Worker configuration (local dev now; public VPS later).
// Secrets come from the environment and never enter source control.
// Local dev: apps/relay-worker/.env (loaded via `node --env-file=.env`).
// VPS deploy: deploy/relay.env (compose env_file). Same variable names.

export interface ShopifyClientConfig {
  /** Shopify app client credential (Dev Dashboard app). */
  clientId: string;
  /** Shopify app client secret. Treat as compromised on any exposure. */
  clientSecret: string;
  /** Store API domain, e.g. `attaky-dev.myshopify.com` (never admin.shopify.com). */
  shopDomain: string;
  /** Admin API version pinned for all GraphQL calls, e.g. `2026-10`. */
  apiVersion: string;
}

export interface RelayConfig {
  port: number;
  /** Shared machine credential for private-system synchronization. */
  machineToken: string;
  /** Shopify webhook signing secret; webhook intake is disabled without it. */
  shopifyWebhookSecret: string | null;
  /** Seconds a lease is held before the message becomes pullable again. */
  leaseTtlSeconds: number;
  /**
   * Shopify Admin API client. When null, shopify commands answer
   * `unsupported` — the worker runs but performs no platform calls.
   */
  shopify: ShopifyClientConfig | null;
}

function normalizeShopDomain(raw: string): string {
  let domain = raw.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/\/+$/, "");
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(domain) || domain.includes("/")) {
    throw new Error(
      `SHOPIFY_SHOP_DOMAIN must be a bare hostname like attaky-dev.myshopify.com, got: ${raw}`,
    );
  }
  return domain;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const machineToken = env.RELAY_MACHINE_TOKEN;
  if (!machineToken) {
    throw new Error(
      "RELAY_MACHINE_TOKEN must be set: private-system synchronization requires the machine credential.",
    );
  }

  const clientId = env.SHOPIFY_CLIENT_ID;
  const clientSecret = env.SHOPIFY_CLIENT_SECRET;
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  let shopify: ShopifyClientConfig | null = null;
  if (clientId && clientSecret && shopDomain) {
    shopify = {
      clientId,
      clientSecret,
      shopDomain: normalizeShopDomain(shopDomain),
      apiVersion: env.SHOPIFY_API_VERSION || "2026-10",
    };
  }

  return {
    port: Number(env.RELAY_PORT ?? 3100),
    machineToken,
    shopifyWebhookSecret: env.SHOPIFY_WEBHOOK_SECRET || null,
    leaseTtlSeconds: Number(env.RELAY_LEASE_TTL_SECONDS ?? 60),
    shopify,
  };
}
