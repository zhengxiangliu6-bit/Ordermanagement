import { describe, expect, it } from "vitest";
import type { ShopifyClientConfig } from "../config.js";
import { ShopifyCommands } from "./commands.js";

const CONFIG: ShopifyClientConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  shopDomain: "attaky-dev.myshopify.com",
  apiVersion: "2026-10",
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface CapturedBody {
  query: string;
  variables?: Record<string, unknown>;
}

function makeCommands(
  graphqlResponses: Response[],
): { commands: ShopifyCommands; bodies: CapturedBody[] } {
  const bodies: CapturedBody[] = [];
  const graphQl = [...graphqlResponses];
  const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/admin/oauth/access_token")) {
      return jsonResponse({
        access_token: "tok-1",
        expires_in: 86399,
        scope: "read_orders",
      });
    }
    bodies.push(JSON.parse(String(init?.body)) as CapturedBody);
    return graphQl.shift() ?? jsonResponse({ data: {} });
  }) as typeof fetch;

  return {
    commands: new ShopifyCommands(CONFIG, {
      fetchImpl,
      sleep: async () => {},
    }),
    bodies,
  };
}

describe("ShopifyCommands", () => {
  it("reports supported kinds", () => {
    const { commands } = makeCommands([]);
    expect(commands.supports("orders.fetch")).toBe(true);
    expect(commands.supports("etsy.orders.fetch")).toBe(false);
  });

  it("scopes.check returns the shop and the actually granted scopes", async () => {
    const { commands } = makeCommands([
      jsonResponse({
        data: {
          shop: { name: "Attaky Dev", myshopifyDomain: "attaky-dev.myshopify.com" },
          currentAppInstallation: {
            accessScopes: [{ handle: "read_orders" }, { handle: "read_products" }],
          },
        },
      }),
    ]);

    const outcome = await commands.run("scopes.check", {});
    expect(outcome.status).toBe("succeeded");
    expect(outcome.error).toBeNull();
    expect(outcome.response).toEqual({
      shop: { name: "Attaky Dev", myshopifyDomain: "attaky-dev.myshopify.com" },
      accessScopes: ["read_orders", "read_products"],
    });
  });

  it("products.fetch walks cursor pagination to exhaustion", async () => {
    const { commands, bodies } = makeCommands([
      jsonResponse({
        data: {
          products: {
            nodes: [{ id: "gid://shopify/Product/1", title: "A" }],
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          },
        },
      }),
      jsonResponse({
        data: {
          products: {
            nodes: [
              { id: "gid://shopify/Product/2", title: "B" },
              { id: "gid://shopify/Product/3", title: "C" },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    ]);

    const outcome = await commands.run("products.fetch", {});
    expect(outcome.status).toBe("succeeded");
    expect((outcome.response as { products: unknown[] }).products).toHaveLength(3);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.variables).toMatchObject({ after: "cursor-1" });
  });

  it("orders.fetch maps `since` onto the updated_at search filter", async () => {
    const { commands, bodies } = makeCommands([
      jsonResponse({
        data: {
          orders: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    ]);

    const outcome = await commands.run("orders.fetch", {
      since: "2026-10-01T00:00:00.000Z",
    });
    expect(outcome.status).toBe("succeeded");
    expect(bodies[0]?.variables?.query).toBe("updated_at:>=2026-10-01T00:00:00.000Z");
  });

  it("orders.fetch omits the query filter without `since`", async () => {
    const { commands, bodies } = makeCommands([
      jsonResponse({
        data: {
          orders: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    ]);

    const outcome = await commands.run("orders.fetch", {});
    expect(outcome.status).toBe("succeeded");
    expect(bodies[0]?.variables).not.toHaveProperty("query");
  });

  it("fulfillment.create submits line items, tracking, and notifyCustomer=false by default", async () => {
    const { commands, bodies } = makeCommands([
      jsonResponse({
        data: {
          fulfillmentCreate: {
            fulfillment: {
              id: "gid://shopify/Fulfillment/9",
              status: "SUCCESS",
              trackingInfo: [{ number: "TRK-1" }],
            },
            userErrors: [],
          },
        },
      }),
    ]);

    const outcome = await commands.run("fulfillment.create", {
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1",
      trackingNumber: "TRK-1",
      trackingCompany: "SF Express",
      trackingUrl: "https://track.example/TRK-1",
    });

    expect(outcome.status).toBe("succeeded");
    expect(bodies[0]?.variables).toEqual({
      fulfillment: {
        lineItemsByFulfillmentOrder: [
          { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1" },
        ],
        notifyCustomer: false,
        trackingInfo: {
          number: "TRK-1",
          company: "SF Express",
          url: "https://track.example/TRK-1",
        },
      },
    });
  });

  it("fulfillment.create maps userErrors to a structured failure", async () => {
    const { commands } = makeCommands([
      jsonResponse({
        data: {
          fulfillmentCreate: {
            fulfillment: null,
            userErrors: [{ field: ["fulfillment"], message: "Already fulfilled" }],
          },
        },
      }),
    ]);

    const outcome = await commands.run("fulfillment.create", {
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1",
      trackingNumber: "TRK-1",
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("USER_ERRORS");
    expect(outcome.error?.message).toContain("Already fulfilled");
  });

  it("rejects invalid payloads with INVALID_PAYLOAD", async () => {
    const { commands } = makeCommands([]);
    const outcome = await commands.run("fulfillment.create", {
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("INVALID_PAYLOAD");
  });

  it("fulfillmentOrders.fetch returns per-order fulfillment order nodes", async () => {
    const { commands, bodies } = makeCommands([
      jsonResponse({
        data: {
          order: {
            id: "gid://shopify/Order/9",
            fulfillmentOrders: {
              nodes: [
                {
                  id: "gid://shopify/FulfillmentOrder/1",
                  status: "OPEN",
                  assignedLocation: { name: "Attaky HQ" },
                  lineItems: {
                    nodes: [
                      { id: "fo-li-1", totalQuantity: 2, remainingQuantity: 2, lineItem: { id: "gid://shopify/LineItem/1" } },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    ]);

    const outcome = await commands.run("fulfillmentOrders.fetch", {
      orderId: "gid://shopify/Order/9",
    });
    expect(outcome.status).toBe("succeeded");
    expect(bodies[0]?.variables).toEqual({ id: "gid://shopify/Order/9" });
    expect(
      (outcome.response as { fulfillmentOrders: { status: string }[] }).fulfillmentOrders,
    ).toHaveLength(1);
  });

  it("fulfillmentOrders.fetch fails with ORDER_NOT_FOUND for unknown orders", async () => {
    const { commands } = makeCommands([
      jsonResponse({ data: { order: null } }),
    ]);
    const outcome = await commands.run("fulfillmentOrders.fetch", {
      orderId: "gid://shopify/Order/missing",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("ORDER_NOT_FOUND");
  });

  it("maps GraphQL errors to a failed outcome", async () => {
    const { commands } = makeCommands([
      jsonResponse({
        errors: [{ message: "Access denied" }],
      }),
    ]);
    const outcome = await commands.run("scopes.check", {});
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("GRAPHQL_ERROR");
  });

  it("answers unknown kinds as unsupported", async () => {
    const { commands } = makeCommands([]);
    const outcome = await commands.run("shop.delete", {});
    expect(outcome.status).toBe("unsupported");
    expect(outcome.error?.code).toBe("UNKNOWN_COMMAND");
  });
});
