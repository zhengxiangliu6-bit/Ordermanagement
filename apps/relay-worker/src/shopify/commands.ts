import { z } from "zod";
import type { ShopifyClientConfig } from "../config.js";
import {
  paginate,
  ShopifyGraphqlClient,
  ShopifyGraphqlError,
  ShopifyHttpError,
  type GraphQLClientDeps,
} from "./graphql-client.js";
import { ShopifyTokenManager } from "./token.js";

/**
 * Shopify command handlers for the relay `/commands` endpoint.
 *
 * Command kinds are platform-scoped by the envelope (`platform: "shopify"`);
 * the payload selects and parameterizes the operation. Results carry
 * platform-shaped payloads only — mapping into the private system's
 * domain models happens on the API side (ADR-002 boundary).
 *
 * Current single-store limitation: credentials come from worker config
 * (one store per worker). Multi-store support will carry `shopDomain` in
 * command payloads and select per-store credentials.
 */

export interface CommandOutcome {
  status: "succeeded" | "failed" | "unsupported";
  response: unknown;
  error: { code: string; message: string } | null;
}

const ok = (response: unknown): CommandOutcome => ({
  status: "succeeded",
  response,
  error: null,
});

const fail = (code: string, message: string, response: unknown = null): CommandOutcome => ({
  status: "failed",
  response,
  error: { code, message },
});

export const SCOPES_QUERY = /* GraphQL */ `
  query ScopesCheck {
    shop { name myshopifyDomain }
    currentAppInstallation { accessScopes { handle } }
  }
`;

export const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      nodes {
        id title status handle updatedAt descriptionHtml
        variants(first: 100) {
          nodes { id title sku selectedOptions { name value } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const ORDERS_QUERY = /* GraphQL */ `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query) {
      nodes {
        id name createdAt updatedAt cancelledAt
        displayFinancialStatus displayFulfillmentStatus
        note currencyCode
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { id firstName lastName email phone }
        shippingAddress { name phone address1 address2 city zip provinceCode countryCodeV2 }
        lineItems(first: 100) {
          nodes { id quantity name variant { id title sku product { id title status } } }
        }
        fulfillments(first: 10) {
          id status createdAt trackingInfo { number company url }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// 2026-10 renamed the input type FulfillmentV2Input -> FulfillmentInput
// (fields unchanged); older examples using FulfillmentV2Input fail with a
// variable/argument type mismatch on this version.
export const FULFILLMENT_CREATE_MUTATION = /* GraphQL */ `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status trackingInfo { number company url } }
      userErrors { field message }
    }
  }
`;

export const FULFILLMENT_ORDERS_QUERY = /* GraphQL */ `
  query FulfillmentOrders($id: ID!) {
    order(id: $id) {
      id
      fulfillmentOrders(first: 10) {
        nodes {
          id status
          assignedLocation { name }
          lineItems(first: 100) {
            nodes { id totalQuantity remainingQuantity lineItem { id } }
          }
        }
      }
    }
  }
`;

const ProductsFetchPayload = z.object({}).passthrough();

const OrdersFetchPayload = z.object({
  /** ISO datetime; only orders updated at/after this instant are returned. */
  since: z.string().datetime().optional(),
});

const FulfillmentCreatePayload = z.object({
  fulfillmentOrderId: z.string().min(1),
  trackingNumber: z.string().min(1),
  trackingCompany: z.string().nullable().optional(),
  trackingUrl: z.string().nullable().optional(),
  /** Test phase default: never notify the customer. */
  notifyCustomer: z.boolean().optional(),
});

const FulfillmentOrdersFetchPayload = z.object({
  /** Shopify Order GID whose fulfillment orders are needed. */
  orderId: z.string().min(1),
});

type ShopifyRecord = Record<string, unknown>;

export class ShopifyCommands {
  private readonly client: ShopifyGraphqlClient;

  constructor(
    readonly config: ShopifyClientConfig,
    deps: GraphQLClientDeps = {},
  ) {
    this.client = new ShopifyGraphqlClient(
      config,
      new ShopifyTokenManager(config, deps.fetchImpl),
      deps,
    );
  }

  supports(kind: string): boolean {
    return [
      "scopes.check",
      "products.fetch",
      "orders.fetch",
      "fulfillmentOrders.fetch",
      "fulfillment.create",
    ].includes(kind);
  }

  async run(kind: string, payload: unknown): Promise<CommandOutcome> {
    try {
      switch (kind) {
        case "scopes.check":
          return await this.scopesCheck();
        case "products.fetch":
          return await this.productsFetch(payload);
        case "orders.fetch":
          return await this.ordersFetch(payload);
        case "fulfillmentOrders.fetch":
          return await this.fulfillmentOrdersFetch(payload);
        case "fulfillment.create":
          return await this.fulfillmentCreate(payload);
        default:
          return {
            status: "unsupported",
            response: null,
            error: { code: "UNKNOWN_COMMAND", message: `Unknown shopify command: ${kind}` },
          };
      }
    } catch (err) {
      return this.toFailure(err);
    }
  }

  /** Actual scopes granted to the current installation (§8 lesson: the
   *  dashboard's released scopes are not proof — the store must approve
   *  the Update, and only this query reflects it). */
  private async scopesCheck(): Promise<CommandOutcome> {
    const data = await this.client.query<{
      shop: { name: string; myshopifyDomain: string };
      currentAppInstallation: { accessScopes: { handle: string }[] };
    }>(SCOPES_QUERY);
    return ok({
      shop: data.shop,
      accessScopes: data.currentAppInstallation.accessScopes.map((s) => s.handle),
    });
  }

  private async productsFetch(payload: unknown): Promise<CommandOutcome> {
    const parsed = ProductsFetchPayload.parse(payload ?? {});
    const products = await paginate<ShopifyRecord>(
      this.client,
      PRODUCTS_QUERY,
      parsed,
      (data) => data.products as never,
    );
    return ok({ products });
  }

  private async ordersFetch(payload: unknown): Promise<CommandOutcome> {
    const parsed = OrdersFetchPayload.parse(payload ?? {});
    const baseVariables: Record<string, unknown> = parsed.since
      ? { query: `updated_at:>=${parsed.since}` }
      : {};
    const orders = await paginate<ShopifyRecord>(
      this.client,
      ORDERS_QUERY,
      baseVariables,
      (data) => data.orders as never,
    );
    return ok({ orders });
  }

  /**
   * Fulfillment orders for one order, fetched live at outbound-execution
   * time: remaining quantities and open/closed status must be current,
   * and global `fulfillmentOrders` queries return empty where per-order
   * queries succeed (bring-up lesson).
   */
  private async fulfillmentOrdersFetch(payload: unknown): Promise<CommandOutcome> {
    const parsed = FulfillmentOrdersFetchPayload.parse(payload ?? {});
    const data = await this.client.query<{
      order: {
        fulfillmentOrders: {
          nodes: ShopifyRecord[];
        } | null;
      } | null;
    }>(FULFILLMENT_ORDERS_QUERY, { id: parsed.orderId });
    if (!data.order) {
      return fail("ORDER_NOT_FOUND", `Shopify order not found: ${parsed.orderId}`);
    }
    return ok({ fulfillmentOrders: data.order.fulfillmentOrders?.nodes ?? [] });
  }

  private async fulfillmentCreate(payload: unknown): Promise<CommandOutcome> {
    const parsed = FulfillmentCreatePayload.parse(payload ?? {});
    const trackingInfo: Record<string, unknown> = {
      number: parsed.trackingNumber,
    };
    if (parsed.trackingCompany) trackingInfo.company = parsed.trackingCompany;
    if (parsed.trackingUrl) trackingInfo.url = parsed.trackingUrl;

    // 2026-10 shape: FulfillmentInput.lineItemsByFulfillmentOrder is an
    // array of { fulfillmentOrderId, fulfillmentOrderLineItems? }; leaving
    // the line items blank fulfills the whole fulfillment order (§12.2
    // whole-order shipments). The older FulfillmentV2Input field name
    // lineItemsByFulfillmentOrderId no longer exists on this version.
    const data = await this.client.query<{
      fulfillmentCreate: {
        fulfillment: ShopifyRecord | null;
        userErrors: { field?: string[]; message: string }[];
      };
    }>(FULFILLMENT_CREATE_MUTATION, {
      fulfillment: {
        lineItemsByFulfillmentOrder: [
          { fulfillmentOrderId: parsed.fulfillmentOrderId },
        ],
        notifyCustomer: parsed.notifyCustomer ?? false,
        trackingInfo,
      },
    });

    const { fulfillment, userErrors } = data.fulfillmentCreate;
    if (userErrors.length > 0) {
      return fail(
        "USER_ERRORS",
        userErrors.map((e) => `${e.field?.join(".") ?? ""}: ${e.message}`).join("; "),
        { fulfillment, userErrors },
      );
    }
    return ok({ fulfillment });
  }

  private toFailure(err: unknown): CommandOutcome {
    if (err instanceof z.ZodError) {
      return fail("INVALID_PAYLOAD", err.message);
    }
    if (err instanceof ShopifyGraphqlError) {
      return fail("GRAPHQL_ERROR", err.message, { errors: err.errors });
    }
    if (err instanceof ShopifyHttpError) {
      return fail(`HTTP_${err.status}`, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    return fail("INTERNAL", message);
  }
}
