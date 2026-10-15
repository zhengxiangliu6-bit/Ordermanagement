import { describe, expect, it } from 'vitest';
import { ATTAKY_INTERNAL_PROVIDER_KEY, AttakyInternalTrackingProvider } from './tracking-provider';

describe('AttakyInternalTrackingProvider (§12.6)', () => {
  const provider = new AttakyInternalTrackingProvider();
  const base = {
    attakyTrackingNumber: 'ATK123',
    originalTrackingNumber: 'SF1234567890123',
    attakyTrackingUrl: 'https://track.attaky.com/ATK123',
    carrierTrackingUrl: null,
    enteredAt: new Date('2026-10-12T02:00:00Z'),
    dispatchedAt: new Date('2026-10-12T03:00:00Z'),
    remoteSyncStatus: 'scheduled',
    lastExecutedAt: null,
  };

  it('exposes the internal provider key', () => {
    expect(provider.key).toBe(ATTAKY_INTERNAL_PROVIDER_KEY);
  });

  it('returns null without an Attaky tracking number (nothing to look up)', async () => {
    expect(
      await provider.fetch({ ...base, attakyTrackingNumber: null }),
    ).toBeNull();
  });

  it('derives recorded/dispatched events before outbound confirmation', async () => {
    const snapshot = await provider.fetch(base);
    expect(snapshot?.currentStatus).toBe('prepared');
    expect(snapshot?.events.map((e) => e.label)).toEqual(['recorded', 'dispatched']);
    expect(snapshot?.link).toBe(base.attakyTrackingUrl);
  });

  it('adds in_transit once the platform confirmed the send', async () => {
    const snapshot = await provider.fetch({
      ...base,
      remoteSyncStatus: 'synced',
      lastExecutedAt: '2026-10-12T05:00:00.000Z',
    });
    expect(snapshot?.currentStatus).toBe('in_transit');
    expect(snapshot?.events.map((e) => e.label)).toEqual([
      'recorded',
      'dispatched',
      'in_transit',
    ]);
    expect(snapshot?.lastUpdate).toBe('2026-10-12T05:00:00.000Z');
  });

  it('keeps prepared status for failed/manual outcomes', async () => {
    for (const status of ['manual_action_required', 'rejected', 'not_supported']) {
      const snapshot = await provider.fetch({
        ...base,
        remoteSyncStatus: status,
        lastExecutedAt: '2026-10-12T05:00:00.000Z',
      });
      expect(snapshot?.currentStatus).toBe('prepared');
    }
  });
});
