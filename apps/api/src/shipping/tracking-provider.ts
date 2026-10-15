/**
 * Tracking Provider boundary (§12.6).
 *
 * A Carrier describes who transports the package; a Tracking Provider
 * describes which system supplies status and event data. The port below is
 * the seam: the first internal provider (the Attaky customer-facing
 * tracking system for China-origin shipments) ships here as a deterministic
 * snapshot derived from local shipment facts, with the real tracking-system
 * API plugging into `AttakyInternalTrackingProvider.fetch` later — the
 * Shipment model and every consumer stay unchanged.
 */

export interface TrackingEvent {
  /** ISO timestamp of the event. */
  at: string;
  /** Human-readable event label (already localized by the provider layer). */
  label: string;
}

export interface TrackingSnapshot {
  providerKey: string;
  currentStatus: string;
  lastUpdate: string | null;
  events: TrackingEvent[];
  link: string | null;
}

export interface TrackingQuery {
  attakyTrackingNumber: string | null;
  originalTrackingNumber: string | null;
  attakyTrackingUrl: string | null;
  carrierTrackingUrl: string | null;
  enteredAt: Date;
  dispatchedAt: Date | null;
  remoteSyncStatus: string;
  lastExecutedAt: string | null;
}

export interface TrackingProviderPort {
  readonly key: string;
  /**
   * Returns the current tracking snapshot, or null when this provider has
   * no data for the shipment (the caller then falls back to the tracking
   * URL, §12.6).
   */
  fetch(query: TrackingQuery): Promise<TrackingSnapshot | null>;
}

/** Provider registry key of the first internal provider (§12.6). */
export const ATTAKY_INTERNAL_PROVIDER_KEY = 'attaky-internal';

/**
 * First internal Tracking Provider. Until the real Attaky tracking-system
 * endpoint is wired (same interface, config-driven base URL), the snapshot
 * is derived deterministically from local shipment facts — no fabricated
 * data beyond what Attaky itself recorded.
 */
export class AttakyInternalTrackingProvider implements TrackingProviderPort {
  readonly key = ATTAKY_INTERNAL_PROVIDER_KEY;

  async fetch(query: TrackingQuery): Promise<TrackingSnapshot | null> {
    // The internal system tracks shipments by their Attaky-facing number;
    // without one there is nothing to look up.
    if (!query.attakyTrackingNumber) return null;

    const events: TrackingEvent[] = [
      { at: query.enteredAt.toISOString(), label: 'recorded' },
    ];
    if (query.dispatchedAt) {
      events.push({ at: query.dispatchedAt.toISOString(), label: 'dispatched' });
    }
    const sentAt = query.lastExecutedAt
      ? new Date(query.lastExecutedAt)
      : null;
    const confirmedOutbound =
      query.remoteSyncStatus === 'synced' ||
      query.remoteSyncStatus === 'partially_synced';
    if (sentAt && confirmedOutbound) {
      events.push({ at: sentAt.toISOString(), label: 'in_transit' });
    }

    const last = events[events.length - 1];
    return {
      providerKey: this.key,
      currentStatus: confirmedOutbound ? last.label : 'prepared',
      lastUpdate: last.at,
      events,
      link: query.attakyTrackingUrl,
    };
  }
}

/** Registry of available provider implementations. */
export class TrackingProviderRegistry {
  private readonly ports = new Map<string, TrackingProviderPort>();

  constructor(ports: TrackingProviderPort[]) {
    for (const port of ports) this.ports.set(port.key, port);
  }

  resolve(key: string | null | undefined): TrackingProviderPort | null {
    if (!key) return null;
    return this.ports.get(key) ?? null;
  }
}
