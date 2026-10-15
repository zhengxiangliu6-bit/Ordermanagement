/**
 * Reserved framework for direct carrier API integration (2026-10-15
 * decision: scaffold now, integrate later as an independent milestone).
 *
 * Direct integration means the system talks to the carrier's HTTP API
 * end to end: rate quote -> create shipment -> purchase label (PDF) ->
 * tracking number returned automatically -> tracking events polled or
 * pushed. Outbound fulfillment then no longer requires re-entering the
 * tracking number by hand.
 *
 * Each carrier gets a client implementing CarrierApiClient. Until real
 * credentials and flows are wired in, clients stay in the reserved
 * (not-configured) state and every call fails fast with
 * CarrierApiNotConfiguredError — no silent stubs.
 */

export interface CarrierApiAddress {
  name: string;
  company?: string | null;
  street1: string;
  street2?: string | null;
  city: string;
  province?: string | null;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2
  phone?: string | null;
  email?: string | null;
}

export interface CarrierApiParcel {
  weightGrams: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export interface CarrierApiQuoteRequest {
  from: CarrierApiAddress;
  to: CarrierApiAddress;
  parcel: CarrierApiParcel;
}

export interface CarrierApiQuote {
  service: string;
  amountCents: number;
  currency: string;
  estimatedDays?: number | null;
}

export interface CarrierApiShipmentRequest {
  from: CarrierApiAddress;
  to: CarrierApiAddress;
  parcel: CarrierApiParcel;
  service: string;
  /** Order reference for the carrier's dashboard. */
  reference?: string | null;
}

export interface CarrierApiShipment {
  carrierShipmentId: string;
  trackingNumber: string;
  /** Label PDF bytes when the carrier returns them inline. */
  labelPdfBase64: string | null;
  labelUrl: string | null;
}

export interface CarrierApiTrackingEvent {
  at: string;
  status: string;
  description?: string | null;
}

export interface CarrierApiClient {
  readonly carrierKey: string;
  quotes(request: CarrierApiQuoteRequest): Promise<CarrierApiQuote[]>;
  createShipment(request: CarrierApiShipmentRequest): Promise<CarrierApiShipment>;
  fetchTracking(trackingNumber: string): Promise<CarrierApiTrackingEvent[]>;
}

export class CarrierApiNotConfiguredError extends Error {
  constructor(carrierKey: string) {
    super(
      `Carrier API for "${carrierKey}" is reserved but not configured; ` +
        'provide credentials and complete the integration before use.',
    );
    this.name = 'CarrierApiNotConfiguredError';
  }
}

/** Registry of carrier API clients; populated as integrations land. */
export class CarrierApiRegistry {
  private readonly clients = new Map<string, CarrierApiClient>();

  constructor(clients: CarrierApiClient[]) {
    for (const client of clients) this.clients.set(client.carrierKey, client);
  }

  resolve(carrierKey: string): CarrierApiClient | null {
    return this.clients.get(carrierKey) ?? null;
  }
}
