import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { RelayConfig } from "../src/config.js";
import { InMemoryRelayStore } from "../src/store.js";

const CONFIG: RelayConfig = {
  port: 0,
  machineToken: "test-machine-token",
  shopifyWebhookSecret: "webhook-secret",
  leaseTtlSeconds: 60,
  shopify: null,
};

function signWebhook(body: string): string {
  return createHmac("sha256", CONFIG.shopifyWebhookSecret!)
    .update(body)
    .digest("base64");
}

describe("relay worker http surface", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    app = buildApp({
      config: CONFIG,
      store: new InMemoryRelayStore(CONFIG.leaseTtlSeconds * 1000),
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      // supertest keeps the server short-lived per request; nothing to close.
      resolve();
    });
  });

  it("exposes non-sensitive health publicly", async () => {
    const res = await request(app).get("/relay/v1/health").expect(200);
    expect(res.body).toMatchObject({ status: "ok", protocolVersion: "v1" });
  });

  it("requires the machine credential for sync routes", async () => {
    await request(app)
      .post("/relay/v1/messages/pull")
      .send({ max: 1 })
      .expect(401);
    await request(app)
      .post("/relay/v1/messages/pull")
      .set("Authorization", "Bearer wrong")
      .send({ max: 1 })
      .expect(401);
  });

  it("rejects webhooks with an invalid signature", async () => {
    const body = JSON.stringify({ id: 1 });
    await request(app)
      .post("/relay/v1/webhooks/shopify")
      .set("X-Shopify-Hmac-Sha256", "bad-signature")
      .set("Content-Type", "application/json")
      .send(body)
      .expect(401);
  });

  it("accepts signed webhooks and hands them out over pull/ack", async () => {
    const body = JSON.stringify({ id: 42 });
    const accepted = await request(app)
      .post("/relay/v1/webhooks/shopify")
      .set("X-Shopify-Hmac-Sha256", signWebhook(body))
      .set("X-Shopify-Topic", "orders/create")
      .set("X-Shopify-Shop-Domain", "test.myshopify.com")
      .set("X-Shopify-Webhook-Id", "wh-42")
      .set("Content-Type", "application/json")
      .send(body)
      .expect(202);
    expect(accepted.body).toMatchObject({ accepted: true, envelopeId: "wh-42" });

    const auth = { Authorization: `Bearer ${CONFIG.machineToken}` };

    const pull = await request(app)
      .post("/relay/v1/messages/pull")
      .set(auth)
      .send({ max: 10 })
      .expect(200);
    expect(pull.body.messages).toHaveLength(1);
    const message = pull.body.messages[0];
    expect(message.envelope).toMatchObject({
      kind: "webhook",
      platform: "shopify",
      topic: "orders/create",
    });
    expect(
      Buffer.from(message.envelope.bodyBase64, "base64").toString(),
    ).toBe(body);

    const ack = await request(app)
      .post("/relay/v1/messages/ack")
      .set(auth)
      .send({ leaseToken: message.leaseToken })
      .expect(200);
    expect(ack.body.delivered).toBe(true);

    const empty = await request(app)
      .post("/relay/v1/messages/pull")
      .set(auth)
      .send({ max: 10 })
      .expect(200);
    expect(empty.body.messages).toHaveLength(0);
  });

  it("accepts commands and returns an unsupported result envelope", async () => {
    const auth = { Authorization: `Bearer ${CONFIG.machineToken}` };
    const command = {
      command: {
        id: "cmd-1",
        protocolVersion: "v1",
        platform: "shopify",
        kind: "fulfillment.create",
        payload: { storeRef: "s1" },
        issuedAt: new Date().toISOString(),
      },
    };

    const submitted = await request(app)
      .post("/relay/v1/commands")
      .set(auth)
      .send(command)
      .expect(202);
    expect(submitted.body).toMatchObject({ commandId: "cmd-1" });

    const pull = await request(app)
      .post("/relay/v1/messages/pull")
      .set(auth)
      .send({ max: 10 })
      .expect(200);
    const resultMessage = pull.body.messages.find(
      (m: { envelope: { commandId?: string } }) =>
        m.envelope.commandId === "cmd-1",
    );
    expect(resultMessage).toBeTruthy();
    expect(resultMessage.envelope).toMatchObject({
      kind: "command-result",
      status: "unsupported",
    });
  });

  it("executes shopify commands against the platform and queues the result", async () => {
    const auth = { Authorization: `Bearer ${CONFIG.machineToken}` };
    const fetchImpl = (async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.endsWith("/admin/oauth/access_token")) {
        return new Response(
          JSON.stringify({ access_token: "tok-1", expires_in: 86399 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            shop: { name: "Attaky Dev", myshopifyDomain: "attaky-dev.myshopify.com" },
            currentAppInstallation: { accessScopes: [{ handle: "read_orders" }] },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const appWithShopify = buildApp({
      config: { ...CONFIG, shopify: {
        clientId: "cid",
        clientSecret: "csecret",
        shopDomain: "attaky-dev.myshopify.com",
        apiVersion: "2026-10",
      } },
      store: new InMemoryRelayStore(CONFIG.leaseTtlSeconds * 1000),
      fetchImpl,
      sleep: async () => {},
    });

    const submitted = await request(appWithShopify)
      .post("/relay/v1/commands")
      .set(auth)
      .send({
        command: {
          id: "cmd-2",
          protocolVersion: "v1",
          platform: "shopify",
          kind: "scopes.check",
          payload: {},
          issuedAt: new Date().toISOString(),
        },
      })
      .expect(202);
    expect(submitted.body).toMatchObject({ commandId: "cmd-2" });

    // Command execution is asynchronous; poll the pull queue briefly.
    let resultMessage: { envelope: { commandId?: string } } | undefined;
    for (let attempt = 0; attempt < 100 && !resultMessage; attempt += 1) {
      const pull = await request(appWithShopify)
        .post("/relay/v1/messages/pull")
        .set(auth)
        .send({ max: 10 })
        .expect(200);
      resultMessage = pull.body.messages.find(
        (m: { envelope: { commandId?: string } }) =>
          m.envelope.commandId === "cmd-2",
      );
      if (!resultMessage) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    expect(resultMessage).toBeTruthy();
    expect(resultMessage!.envelope).toMatchObject({
      kind: "command-result",
      status: "succeeded",
    });
  });

  it("answers non-shopify platforms with PLATFORM_NOT_SUPPORTED", async () => {
    const auth = { Authorization: `Bearer ${CONFIG.machineToken}` };
    const submitted = await request(app)
      .post("/relay/v1/commands")
      .set(auth)
      .send({
        command: {
          id: "cmd-3",
          protocolVersion: "v1",
          platform: "etsy",
          kind: "orders.fetch",
          payload: {},
          issuedAt: new Date().toISOString(),
        },
      })
      .expect(202);
    expect(submitted.body).toMatchObject({ commandId: "cmd-3" });

    const pull = await request(app)
      .post("/relay/v1/messages/pull")
      .set(auth)
      .send({ max: 10 })
      .expect(200);
    const resultMessage = pull.body.messages.find(
      (m: { envelope: { commandId?: string } }) =>
        m.envelope.commandId === "cmd-3",
    );
    expect(resultMessage).toBeTruthy();
    expect(resultMessage.envelope).toMatchObject({
      kind: "command-result",
      status: "unsupported",
      error: { code: "PLATFORM_NOT_SUPPORTED" },
    });
  });
});
