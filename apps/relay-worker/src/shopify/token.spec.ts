import { describe, expect, it } from "vitest";
import type { ShopifyClientConfig } from "../config.js";
import { ShopifyTokenManager } from "./token.js";

const CONFIG: ShopifyClientConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  shopDomain: "attaky-dev.myshopify.com",
  apiVersion: "2026-10",
};

function tokenResponse(token: string, expiresIn = 86399): Response {
  return new Response(
    JSON.stringify({
      access_token: token,
      expires_in: expiresIn,
      scope: "read_orders,read_products",
    }),
    { status: 200 },
  );
}

describe("ShopifyTokenManager", () => {
  it("exchanges credentials with a form-encoded POST to the shop domain", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (
      url: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      capturedUrl = String(url);
      capturedInit = init;
      return tokenResponse("tok-1");
    }) as typeof fetch;

    const nowMs = 0;
    const manager = new ShopifyTokenManager(CONFIG, fetchImpl, () => nowMs);
    const token = await manager.getToken();

    expect(capturedUrl).toBe(
      "https://attaky-dev.myshopify.com/admin/oauth/access_token",
    );
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(String(capturedInit?.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("csecret");

    expect(token.accessToken).toBe("tok-1");
    expect(token.expiresAtMs).toBe(86399 * 1000);
    expect(token.scope).toContain("read_orders");
  });

  it("caches the token until the refresh margin", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return tokenResponse(`tok-${calls}`);
    }) as typeof fetch;

    let nowMs = 0;
    const manager = new ShopifyTokenManager(CONFIG, fetchImpl, () => nowMs);

    expect((await manager.getToken()).accessToken).toBe("tok-1");
    // Deep inside the validity window: cached.
    nowMs = 60 * 60 * 1000;
    expect((await manager.getToken()).accessToken).toBe("tok-1");
    expect(calls).toBe(1);

    // Past expiry minus the 5-minute margin: refreshed proactively.
    nowMs = (86399 - 200) * 1000;
    expect((await manager.getToken()).accessToken).toBe("tok-2");
    expect(calls).toBe(2);
  });

  it("shares one in-flight request across concurrent callers", async () => {
    let calls = 0;
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = (async () => {
      calls += 1;
      return gate;
    }) as typeof fetch;

    const manager = new ShopifyTokenManager(CONFIG, fetchImpl, () => 0);
    const first = manager.getToken();
    const second = manager.getToken();
    release(tokenResponse("tok-1"));
    const [a, b] = await Promise.all([first, second]);
    void gate;

    expect(calls).toBe(1);
    expect(a.accessToken).toBe("tok-1");
    expect(b.accessToken).toBe("tok-1");
  });

  it("invalidate() forces a fresh token on the next call", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return tokenResponse(`tok-${calls}`);
    }) as typeof fetch;

    const manager = new ShopifyTokenManager(CONFIG, fetchImpl, () => 0);
    expect((await manager.getToken()).accessToken).toBe("tok-1");
    manager.invalidate();
    expect((await manager.getToken()).accessToken).toBe("tok-2");
    expect(calls).toBe(2);
  });

  it("surfaces a non-200 token response as an error", async () => {
    const fetchImpl = (async () =>
      new Response('{"error":"invalid_client"}', { status: 400 })) as typeof fetch;
    const manager = new ShopifyTokenManager(CONFIG, fetchImpl, () => 0);
    await expect(manager.getToken()).rejects.toThrow(/HTTP 400/);
  });
});
