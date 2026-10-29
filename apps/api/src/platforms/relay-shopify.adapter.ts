import { Injectable } from '@nestjs/common';
import type {
  ExternalListing,
  ExternalOrder,
  ExternalOrderLine,
  PlatformAdapter,
  PlatformFulfillment,
} from './platform-adapter';
// Value import (not `import type`): Nest DI reflects constructor param
// types at runtime; a type-only import erases the token.
import { RelayClient } from '../relay/relay.client';

/**
 * Real Shopify adapter backed by the Relay Worker (M6). Executes the
 * platform fetch over relay commands and normalizes Shopify Admin GraphQL
 * payloads into the sync pipeline's external shapes. Mapping to internal
 * domain models (review, mapping, orders) stays in the sync pipeline —
 * this layer only shapes platform data (ADR-002).
 *
 * Shopify list shapes differ per field (lesson from bring-up):
 * - products.variants and orders.lineItems are connections: `{ nodes: [...] }`
 * - orders.fulfillments is a plain list: `[...]`
 */

/** Scopes the connect flow requires before a store may synchronize. */
export const SHOPIFY_REQUIRED_SCOPES = [
  'read_orders',
  'read_products',
  'read_fulfillments',
  'write_fulfillments',
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
] as const;

interface ShopifyVariant {
  image?: { url: string } | null;
  id: string;
  title?: string | null;
  sku?: string | null;
  selectedOptions?: { name: string; value: string }[] | null;
}

interface ShopifyProduct {
  images?: { nodes?: { url: string }[] | null } | null;
  id: string;
  title: string;
  status?: string | null;
  handle?: string | null;
  updatedAt: string;
  descriptionHtml?: string | null;
  variants?: { nodes?: ShopifyVariant[] | null } | null;
}

interface ShopifyLineItem {
  id: string;
  quantity: number;
  name: string;
  variant?: {
    id: string;
    title?: string | null;
    sku?: string | null;
    product?: { id: string; title?: string | null; status?: string | null } | null;
  } | null;
}

interface ShopifyOrder {
  id: string;
  name: string;
  createdAt?: string | null;
  updatedAt: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  note?: string | null;
  currencyCode?: string | null;
  totalPriceSet?: { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null;
  customer?: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null } | null;
  shippingAddress?: {
    name?: string | null;
    phone?: string | null;
    address1?: string | null;
    city?: string | null;
    zip?: string | null;
    countryCodeV2?: string | null;
  } | null;
  lineItems?: { nodes?: ShopifyLineItem[] | null } | null;
  fulfillments?: unknown;
}

/** Product → ExternalListing (variants come as a connection). */
export function normalizeShopifyProduct(product: ShopifyProduct): ExternalListing {
  return {
    images: product.images?.nodes?.map((image) => image.url) ?? [],
    externalListingId: product.id,
    status: (product.status ?? 'unknown').toLowerCase(),
    title: product.title,
    description: product.descriptionHtml ?? undefined,
    sourceUpdatedAt: product.updatedAt,
    variants: (product.variants?.nodes ?? []).map((variant) => ({
      images: variant.image?.url ? [variant.image.url] : [],
      externalVariantId: variant.id,
      title: variant.title ?? null,
      // Shopify allows variants without a SKU; undefined keeps the column
      // nullable instead of persisting a fake value.
      externalSku: variant.sku ?? undefined,
      // selectedOptions is a [{name, value}] list; the pipeline stores a
      // {optionName: value} record (sim-fixture convention).
      optionValues: variant.selectedOptions
        ? Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value]))
        : undefined,
    })),
  };
}

/** Order → ExternalOrder (lineItems connection, fulfillments plain list). */
export function normalizeShopifyOrder(order: ShopifyOrder): ExternalOrder {
  const lines: ExternalOrderLine[] = (order.lineItems?.nodes ?? []).map((line) => ({
    externalLineId: line.id,
    title: line.name,
    quantity: line.quantity,
    // Variant-less lines (custom/gift card) keep their own id; the sync
    // pipeline tolerates unknown listing references by storing the line
    // without internal mapping links.
    listingExternalId: line.variant?.product?.id ?? '',
    variantExternalId: line.variant?.id ?? line.id,
  }));

  const customerName =
    [order.customer?.firstName, order.customer?.lastName]
      .filter((part) => Boolean(part))
      .join(' ') ||
    order.shippingAddress?.name ||
    undefined;

  return {
    externalOrderId: order.id,
    displayNumber: order.name,
    statusRaw: {
      financialStatus: order.displayFinancialStatus ?? null,
      fulfillmentStatus: order.displayFulfillmentStatus ?? null,
      cancelledAt: order.cancelledAt ?? null,
      currency: order.currencyCode ?? null,
      totalAmount: order.totalPriceSet?.shopMoney?.amount ?? null,
      totalCurrency: order.totalPriceSet?.shopMoney?.currencyCode ?? null,
    },
    customer: {
      name: customerName,
      email: order.customer?.email ?? undefined,
      phone: order.customer?.phone ?? order.shippingAddress?.phone ?? undefined,
      addressLine1: order.shippingAddress?.address1 ?? undefined,
      city: order.shippingAddress?.city ?? undefined,
      postalCode: order.shippingAddress?.zip ?? undefined,
      country: order.shippingAddress?.countryCodeV2 ?? undefined,
    },
    buyerNote: order.note ?? undefined,
    deliveryMethod: undefined,
    lines,
    // Platform-side fulfillments (Shopify fulfillments is a plain list):
    // display-only mirror for orders shipped outside Order Management.
    platformFulfillments:
      Array.isArray(order.fulfillments) && order.fulfillments.length > 0
        ? (order.fulfillments as Array<Record<string, unknown>>).map(
            (fulfillment): PlatformFulfillment => ({
              externalId: String(fulfillment.id ?? ''),
              status: (fulfillment.status as string | null) ?? null,
              createdAt: (fulfillment.createdAt as string | null) ?? null,
              tracking: (
                (fulfillment.trackingInfo as Array<Record<string, unknown>> | undefined) ?? []
              ).map((info) => ({
                number: (info.number as string | null) ?? null,
                company: (info.company as string | null) ?? null,
                url: (info.url as string | null) ?? null,
              })),
            }),
          )
        : undefined,
    sourceUpdatedAt: order.updatedAt,
  };
}

@Injectable()
export class RelayShopifyAdapter implements PlatformAdapter {
  readonly platform = 'shopify';

  constructor(private readonly relay: RelayClient) {}

  async fetchListings(): Promise<ExternalListing[]> {
    const { response } = await this.relay.runCommand({
      kind: 'products.fetch',
    });
    const products = (response as { products?: ShopifyProduct[] }).products ?? [];
    return products.map(normalizeShopifyProduct);
  }

  async fetchOrders(): Promise<ExternalOrder[]> {
    const { response } = await this.relay.runCommand({
      kind: 'orders.fetch',
    });
    const orders = (response as { orders?: ShopifyOrder[] }).orders ?? [];
    return orders.map(normalizeShopifyOrder);
  }
}
