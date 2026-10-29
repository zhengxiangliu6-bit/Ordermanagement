/**
 * Platform adapter boundary (architecture §4): the Relay Worker (M5) will
 * implement this interface with real Shopify/Etsy calls. M3 ships the
 * simulated adapter so the full import → policy → review → mapping pipeline
 * runs on fixture data (functional design testing notes allow simulated
 * platform endpoints).
 */

export interface ExternalVariant {
  externalVariantId: string;
  /** Platform-side variant name (e.g. Shopify variant title). */
  title?: string | null;
  externalSku?: string;
  optionValues?: Record<string, unknown>;
}

export interface ExternalListing {
  externalListingId: string;
  status: string;
  title: string;
  description?: string;
  variants: ExternalVariant[];
  sourceUpdatedAt: string;
}

export interface ExternalOrderLine {
  externalLineId: string;
  title: string;
  quantity: number;
  listingExternalId: string;
  variantExternalId: string;
  personalization?: Record<string, unknown>;
}

/** Read-only fulfillment record the PLATFORM created (outside Order Management). */
export interface PlatformFulfillment {
  externalId: string;
  status?: string | null;
  createdAt?: string | null;
  tracking: Array<{ number: string | null; company: string | null; url: string | null }>;
}

export interface ExternalOrder {
  externalOrderId: string;
  displayNumber: string;
  statusRaw: Record<string, unknown>;
  customer: {
    name?: string;
    phone?: string;
    email?: string;
    addressLine1?: string;
    city?: string;
    postalCode?: string;
    country?: string;
  };
  buyerNote?: string;
  deliveryMethod?: string;
  lines: ExternalOrderLine[];
  sourceUpdatedAt: string;
  /** Platform-side fulfillments (already shipped before/without us): display-only mirror. */
  platformFulfillments?: PlatformFulfillment[];
}

export interface PlatformAdapter {
  readonly platform: string;
  fetchListings(): Promise<ExternalListing[]>;
  fetchOrders(): Promise<ExternalOrder[]>;
}

/** Well-known simulated listing fixtures (stable external ids). */
export const SIMULATED_LISTINGS: ExternalListing[] = [
  {
    externalListingId: "SIM-LST-001",
    status: "active",
    title: "Simulated Flip Keyboard (color options)",
    description: "Simulated platform fixture listing.",
    sourceUpdatedAt: "2026-09-09T08:00:00.000Z",
    variants: [
      { externalVariantId: "SIM-001-BLACK", externalSku: "SIM-SKU-BLACK", optionValues: { color: "black" } },
      { externalVariantId: "SIM-001-WHITE", externalSku: "SIM-SKU-WHITE", optionValues: { color: "white" } },
    ],
  },
  {
    externalListingId: "SIM-LST-002",
    status: "active",
    title: "Simulated Power Dock",
    description: "Simulated platform fixture listing.",
    sourceUpdatedAt: "2026-09-09T08:00:00.000Z",
    variants: [
      { externalVariantId: "SIM-002-STD", externalSku: "SIM-SKU-STD", optionValues: { version: "standard" } },
    ],
  },
];

export const SIMULATED_ORDERS: ExternalOrder[] = [
  {
    externalOrderId: "SIM-ORD-1001",
    displayNumber: "#SIM1001",
    statusRaw: { financialStatus: "paid", fulfillmentStatus: null },
    customer: { name: "Chen Yu", email: "chen.yu@example.com", country: "CN" },
    buyerNote: "Simulated order 1001.",
    deliveryMethod: "Standard",
    sourceUpdatedAt: "2026-09-09T09:00:00.000Z",
    lines: [
      {
        externalLineId: "SIM-ORD-1001-L1",
        title: "Simulated Flip Keyboard",
        quantity: 1,
        listingExternalId: "SIM-LST-001",
        variantExternalId: "SIM-001-BLACK",
      },
    ],
  },
  {
    externalOrderId: "SIM-ORD-1002",
    displayNumber: "#SIM1002",
    statusRaw: { financialStatus: "pending" },
    customer: { name: "Dana K", email: "dana@example.com" },
    sourceUpdatedAt: "2026-09-09T09:00:00.000Z",
    lines: [
      {
        externalLineId: "SIM-ORD-1002-L1",
        title: "Simulated Power Dock",
        quantity: 1,
        listingExternalId: "SIM-LST-002",
        variantExternalId: "SIM-002-STD",
      },
    ],
  },
];
