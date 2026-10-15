import { randomBytes } from "node:crypto";

/**
 * In-memory relay store implementing the lease/acknowledge lifecycle.
 *
 * Skeleton only: the architecture leaves the Relay Worker's durable-storage
 * engine open; a persistent store replaces this class in the platform
 * integration milestone without changing the HTTP contract. Unacknowledged
 * messages stay queued (bounded by process memory) so a short private-system
 * outage loses nothing beyond a restart.
 */

export interface PulledMessageInternal {
  leaseToken: string;
  expiresAtMs: number;
  envelopeId: string;
  payloadJson: string;
}

interface QueueItem {
  envelopeId: string;
  payloadJson: string;
}

interface HeldLease {
  leaseToken: string;
  envelopeId: string;
  payloadJson: string;
  expiresAtMs: number;
}

export class InMemoryRelayStore {
  private readonly queue: QueueItem[] = [];
  private readonly heldLeases = new Map<string, HeldLease>();
  private readonly ackedEnvelopeIds = new Set<string>();

  constructor(private readonly leaseTtlMs: number) {}

  enqueue(envelopeId: string, payloadJson: string): void {
    this.queue.push({ envelopeId, payloadJson });
  }

  isDelivered(envelopeId: string): boolean {
    return this.ackedEnvelopeIds.has(envelopeId);
  }

  /** Leases up to `max` available messages; expired leases are reclaimed. */
  pull(max: number, now = Date.now()): PulledMessageInternal[] {
    this.reclaimExpiredLeases(now);
    const messages: PulledMessageInternal[] = [];

    while (messages.length < max && this.queue.length > 0) {
      const candidate = this.queue.shift();
      if (!candidate) break;
      if (this.ackedEnvelopeIds.has(candidate.envelopeId)) continue;
      const lease: HeldLease = {
        leaseToken: randomBytes(24).toString("hex"),
        envelopeId: candidate.envelopeId,
        payloadJson: candidate.payloadJson,
        expiresAtMs: now + this.leaseTtlMs,
      };
      this.heldLeases.set(lease.leaseToken, lease);
      messages.push({
        leaseToken: lease.leaseToken,
        expiresAtMs: lease.expiresAtMs,
        envelopeId: lease.envelopeId,
        payloadJson: lease.payloadJson,
      });
    }
    return messages;
  }

  /** Marks a leased message delivered. Returns false for unknown/expired leases. */
  acknowledge(leaseToken: string, now = Date.now()): boolean {
    const lease = this.heldLeases.get(leaseToken);
    if (!lease) return false;
    this.heldLeases.delete(leaseToken);
    if (lease.expiresAtMs <= now) {
      // Lease already lapsed: not acknowledged; message returns to the queue.
      this.queue.push({
        envelopeId: lease.envelopeId,
        payloadJson: lease.payloadJson,
      });
      return false;
    }
    this.ackedEnvelopeIds.add(lease.envelopeId);
    return true;
  }

  pendingCount(now = Date.now()): number {
    this.reclaimExpiredLeases(now);
    return this.queue.length;
  }

  /** Expired leases go back to the queue; duplicate delivery is expected. */
  private reclaimExpiredLeases(now: number): void {
    for (const [token, lease] of this.heldLeases) {
      if (lease.expiresAtMs <= now) {
        this.heldLeases.delete(token);
        this.queue.push({
          envelopeId: lease.envelopeId,
          payloadJson: lease.payloadJson,
        });
      }
    }
  }
}
