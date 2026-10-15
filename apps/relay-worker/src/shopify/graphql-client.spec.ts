import { describe, expect, it, vi } from "vitest";
import type { ShopifyClientConfig } from "../config.js";
import {
  ShopifyGraphqlClient,
  ShopifyGraphqlError,
  ShopifyHttpError,
} from "./graphql-client.js";
import { ShopifyTokenManager } from "./token.js";

const CONFIG: ShopifyClientConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  shopDomain: "attaky-dev.myshopify.com",
  apiVersion: "2026-10",
};

const GRAPHQL_URL =
  "https://attaky-dev.myshopify.com/admin/api/2026-10/graphql.json";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenOk(): Response {
  return jsonResponse({
    access_token: "tok-1",
    expires_in: 86399,
    scope: "read_orders",
  });
}

interface Captured {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFetch(
  graphqlResponses: Response[],
  tokenResponses: Response[] = [],
): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const tokens = [...tokenResponses];
  const graphQl = [...graphqlResponses];
  const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const target = String(url);
    calls.push({
      url: target,
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    });
    if (target.endsWith("/admin/oauth/access_token")) {
      return tokens.shift() ?? tokenOk();
    }
    return graphQl.shift() ?? jsonResponse({ data: {} });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function buildClient(fetchImpl: typeof fetch) {
  const tokens = new ShopifyTokenManager(CONFIG, fetchImpl, () => 0);
  const sleep = vi.fn(async () => {});
  const client = new ShopifyGraphqlClient(CONFIG, tokens, {
    fetchImpl,
    sleep,
  });
  return { client, sleep };
}

describe("ShopifyGraphqlClient", () => {
  it("posts to the pinned-version endpoint with the token header", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({ data: { shop: { name: "Attaky Dev" } } }),
    ]);
    const { client } = buildClient(fetchImpl);

    const data = await client.query<{ shop: { name: string } }>(
      "query { shop { name } }",
    );

    expect(data.shop.name).toBe("Attaky Dev");
    const graphqlCall = calls.find((c) => c.url === GRAPHQL_URL);
    expect(graphqlCall?.method).toBe("POST");
    expect(graphqlCall?.headers["X-Shopify-Access-Token"]).toBe("tok-1");
    expect(JSON.parse(String(graphqlCall?.body))).toEqual({
      query: "query { shop { name } }",
      variables: undefined,
    });
  });

  it("throws ShopifyGraphqlError when the response carries errors", async () => {
    const { fetchImpl } = makeFetch([
      jsonResponse({
        errors: [{ message: "Field 'bad' doesn't exist" }],
      }),
    ]);
    const { client } = buildClient(fetchImpl);

    await expect(client.query("query { bad }")).rejects.toBeInstanceOf(
      ShopifyGraphqlError,
    );
  });

  it("retries THROTTLED errors and succeeds", async () => {
    const { fetchImpl } = makeFetch([
      jsonResponse({
        errors: [
          {
            message: "Throttled",
            extensions: { code: "THROTTLED" },
          },
        ],
      }),
      jsonResponse({ data: { shop: { name: "ok" } } }),
    ]);
    const { client, sleep } = buildClient(fetchImpl);

    const data = await client.query<{ shop: { name: string } }>(
      "query { shop { name } }",
    );

    expect(data.shop.name).toBe("ok");
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up after the throttle retry budget", async () => {
    const throttled = () =>
      jsonResponse({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      });
    const { fetchImpl } = makeFetch([
      throttled(),
      throttled(),
      throttled(),
      throttled(),
      throttled(),
    ]);
    const { client } = buildClient(fetchImpl);

    await expect(client.query("query { shop { name } }")).rejects.toBeInstanceOf(
      ShopifyGraphqlError,
    );
  });

  it("invalidates the token on 401 and retries once", async () => {
    const { fetchImpl, calls } = makeFetch(
      [
        new Response("unauthorized", { status: 401 }),
        jsonResponse({ data: { shop: { name: "ok" } } }),
      ],
      [tokenOk(), tokenOk()],
    );
    const { client } = buildClient(fetchImpl);

    const data = await client.query<{ shop: { name: string } }>(
      "query { shop { name } }",
    );

    expect(data.shop.name).toBe("ok");
    const tokenCalls = calls.filter((c) =>
      c.url.endsWith("/admin/oauth/access_token"),
    );
    expect(tokenCalls).toHaveLength(2);
  });

  it("throws ShopifyHttpError when 401 persists after the retry", async () => {
    const { fetchImpl } = makeFetch(
      [
        new Response("unauthorized", { status: 401 }),
        new Response("unauthorized", { status: 401 }),
      ],
      [tokenOk(), tokenOk()],
    );
    const { client } = buildClient(fetchImpl);

    await expect(client.query("query { shop { name } }")).rejects.toBeInstanceOf(
      ShopifyHttpError,
    );
  });

  it("throws ShopifyHttpError on server errors", async () => {
    const { fetchImpl } = makeFetch([
      new Response("boom", { status: 500 }),
    ]);
    const { client } = buildClient(fetchImpl);

    await expect(client.query("query { shop { name } }")).rejects.toThrow(
      /HTTP 500/,
    );
  });
});
