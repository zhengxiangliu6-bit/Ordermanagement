import { Injectable } from '@nestjs/common';
import type {
  ExternalListing,
  ExternalOrder,
  PlatformAdapter,
} from './platform-adapter';
import {
  SIMULATED_LISTINGS,
  SIMULATED_ORDERS,
} from './platform-adapter';

/**
 * In-memory simulated platform. Fixtures are mutable at runtime so demos
 * and tests can inject "new listing" / "listing update" / "new order"
 * events and watch them flow through policy → review → mapping.
 *
 * Replaced by the Relay Worker's real adapters in M5 without changing the
 * sync/policy/review pipeline.
 */
@Injectable()
export class SimulatedAdapter implements PlatformAdapter {
  readonly platform = 'shopify';

  // SIM_ADAPTER_FIXTURES=none starts the simulated platform empty (used by
  // the demo seed so the platform state matches the minimal demo data);
  // the default keeps the original demo fixtures.
  private listings: ExternalListing[] = [];
  private orders: ExternalOrder[] = [];

  constructor() {
    if ((process.env.SIM_ADAPTER_FIXTURES ?? 'default') === 'none') return;
    this.listings = SIMULATED_LISTINGS.map((listing) => ({
      ...listing,
      variants: listing.variants.map((variant) => ({ ...variant })),
    }));
    this.orders = SIMULATED_ORDERS.map((order) => ({
      ...order,
      lines: order.lines.map((line) => ({ ...line })),
      customer: { ...order.customer },
      statusRaw: { ...order.statusRaw },
    }));
  }

  async fetchListings(): Promise<ExternalListing[]> {
    return this.listings.map((listing) => ({ ...listing }));
  }

  async fetchOrders(): Promise<ExternalOrder[]> {
    return this.orders.map((order) => ({ ...order }));
  }

  /** Demo/testing hook: introduce (or replace) a listing on the platform. */
  injectListing(listing: ExternalListing): void {
    // Platform listings are keyed by id: re-injecting the same id replaces it,
    // so reseeding the demo never accumulates duplicates.
    this.listings = this.listings.filter(
      (l) => l.externalListingId !== listing.externalListingId,
    );
    this.listings.push({ ...listing, variants: listing.variants.map((v) => ({ ...v })) });
  }

  /** Demo/testing hook: update an existing listing's content. */
  updateListing(
    externalListingId: string,
    patch: { title?: string; description?: string; status?: string },
  ): boolean {
    const listing = this.listings.find((l) => l.externalListingId === externalListingId);
    if (!listing) return false;
    Object.assign(listing, patch, { sourceUpdatedAt: new Date().toISOString() });
    return true;
  }

  /** Demo/testing hook: introduce (or replace) an order on the platform. */
  injectOrder(order: ExternalOrder): void {
    // Platform orders are keyed by id: re-injecting the same id replaces it,
    // so reseeding the demo never accumulates duplicates.
    this.orders = this.orders.filter(
      (o) => o.externalOrderId !== order.externalOrderId,
    );
    this.orders.push({ ...order, lines: order.lines.map((l) => ({ ...l })) });
  }

  /**
   * Demo/testing hook: patch an existing simulated order (creates an order
   * update event on the next sync).
   */
  updateOrder(
    externalOrderId: string,
    patch: { buyerNote?: string; customerName?: string },
  ): boolean {
    const order = this.orders.find((o) => o.externalOrderId === externalOrderId);
    if (!order) return false;
    if (patch.buyerNote !== undefined) order.buyerNote = patch.buyerNote;
    if (patch.customerName !== undefined) order.customer.name = patch.customerName;
    order.sourceUpdatedAt = new Date().toISOString();
    return true;
  }
}
