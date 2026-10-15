import type { ShopifyClientConfig } from "../config.js";
import { ShopifyTokenManager } from "./token.js";

/**
 * Minimal Shopify Admin GraphQL API client.
 *
 * - endpoint: `https://{shop}/admin/api/{version}/graphql.json` (version pinned
 *   in config; never mix versions between features);
 * - auth header: `X-Shopify-Access-Token` with the client-credentials token;
 * - a GraphQL response can be HTTP 200 and still carry `errors` — those are
 *   surfaced as ShopifyGraphqlError;
 * - THROTTLED errors (cost-based rate limiting) are retried with backoff;
 * - HTTP 401 invalidates the cached token and retries once with a fresh one.
 */

export interface GraphQLExecutionError {
  message: string;
  extensions?: {
    code?: string;
    cost?: ThrottleCost;
  };
}

export interface ThrottleCost {
  requestedQueryCost?: number;
  currentlyAvailable?: number;
  restoreRate?: number;
}

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    readonly errors: GraphQLExecutionError[],
  ) {
    super(message);
    this.name = "ShopifyGraphqlError";
  }
}

export class ShopifyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShopifyHttpError";
  }
}

export interface GraphQLClientDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxThrottleRetries?: number;
}

const DEFAULT_THROTTLE_RETRIES = 4;

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLExecutionError[];
}

export class ShopifyGraphqlClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxThrottleRetries: number;

  constructor(
    readonly config: ShopifyClientConfig,
    private readonly tokens: ShopifyTokenManager,
    deps: GraphQLClientDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.maxThrottleRetries = deps.maxThrottleRetries ?? DEFAULT_THROTTLE_RETRIES;
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let refreshed = false;
    let throttleRetries = 0;

    for (;;) {
      const accessToken = await this.tokens.getAccessToken();
      const res = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 401 && !refreshed) {
        // Cached token rejected: fetch a fresh one and retry exactly once.
        this.tokens.invalidate();
        refreshed = true;
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ShopifyHttpError(
          res.status,
          `Shopify GraphQL HTTP ${res.status}: ${detail.slice(0, 300)}`,
        );
      }

      const parsed = (await res.json()) as GraphQLResponse<T>;

      if (parsed.errors?.length) {
        const throttled = parsed.errors.every(
          (e) => e.extensions?.code === "THROTTLED",
        );
        if (throttled && throttleRetries < this.maxThrottleRetries) {
          throttleRetries += 1;
          await this.sleep(this.throttleWaitMs(parsed.errors));
          continue;
        }
        throw new ShopifyGraphqlError(
          `Shopify GraphQL errors: ${parsed.errors.map((e) => e.message).join("; ")}`,
          parsed.errors,
        );
      }

      if (parsed.data === undefined || parsed.data === null) {
        throw new ShopifyGraphqlError("Shopify GraphQL response had no data", []);
      }
      return parsed.data;
    }
  }

  private endpoint(): string {
    return `https://${this.config.shopDomain}/admin/api/${this.config.apiVersion}/graphql.json`;
  }

  private throttleWaitMs(errors: GraphQLExecutionError[]): number {
    const cost = errors[0]?.extensions?.cost;
    if (
      cost &&
      typeof cost.requestedQueryCost === "number" &&
      typeof cost.currentlyAvailable === "number" &&
      typeof cost.restoreRate === "number" &&
      cost.restoreRate > 0
    ) {
      const deficit = cost.requestedQueryCost - cost.currentlyAvailable;
      if (deficit > 0) {
        return Math.ceil((deficit / cost.restoreRate) * 1000) + 250;
      }
    }
    return 2000;
  }
}

/** Page shape expected by `paginate` (Shopify connection convention). */
export interface ConnectionPage<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/**
 * Walks a Shopify connection to exhaustion using cursor pagination.
 * `queryText` must declare `query($first: Int!, $after: String, ...)`;
 * `baseVariables` are merged into each page request. Page size stays modest
 * so single-call cost stays within typical rate-limit buckets.
 */
export async function paginate<T>(
  client: ShopifyGraphqlClient,
  queryText: string,
  baseVariables: Record<string, unknown>,
  extract: (data: Record<string, unknown>) => ConnectionPage<T>,
  pageSize = 50,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  do {
    const data = await client.query<Record<string, unknown>>(queryText, {
      ...baseVariables,
      first: pageSize,
      after: cursor,
    });
    const page = extract(data);
    all.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return all;
}
