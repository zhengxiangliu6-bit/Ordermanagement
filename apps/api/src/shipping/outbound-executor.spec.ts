import { describe, expect, it } from 'vitest';
import { resolveOutboundValues } from './outbound-executor.service';

const shipment = {
  attakyTrackingNumber: 'ATK123',
  attakyTrackingUrl: 'https://track.attaky.com/ATK123',
  originalTrackingNumber: 'SF1234567890123',
  carrierTrackingUrl: 'https://www.sf-express.com/track/SF1234567890123',
};

describe('resolveOutboundValues (§12.5 fallback)', () => {
  it('uses Attaky values when the platform accepts custom URLs', () => {
    expect(
      resolveOutboundValues(shipment, { customTrackingUrl: true }),
    ).toEqual({
      trackingNumber: 'ATK123',
      trackingUrl: 'https://track.attaky.com/ATK123',
      publicTrackingMode: 'attaky',
    });
  });

  it('falls back to the carrier number when the platform rejects custom URLs', () => {
    expect(
      resolveOutboundValues(shipment, { customTrackingUrl: false }),
    ).toEqual({
      trackingNumber: 'SF1234567890123',
      trackingUrl: null,
      publicTrackingMode: 'carrier',
    });
  });

  it('uses the Attaky number without URL on URL-less platforms', () => {
    const noUrlShipment = { ...shipment, attakyTrackingUrl: null };
    expect(
      resolveOutboundValues(noUrlShipment, { customTrackingUrl: false }),
    ).toEqual({
      trackingNumber: 'ATK123',
      trackingUrl: null,
      publicTrackingMode: 'attaky',
    });
  });

  it('falls back when no Attaky number exists', () => {
    expect(
      resolveOutboundValues(
        { ...shipment, attakyTrackingNumber: null },
        { customTrackingUrl: true },
      ),
    ).toEqual({
      trackingNumber: 'SF1234567890123',
      trackingUrl: 'https://www.sf-express.com/track/SF1234567890123',
      publicTrackingMode: 'carrier',
    });
  });

  it('returns null when neither number exists', () => {
    expect(
      resolveOutboundValues(
        {
          attakyTrackingNumber: null,
          attakyTrackingUrl: null,
          originalTrackingNumber: null,
          carrierTrackingUrl: null,
        },
        {},
      ),
    ).toBeNull();
  });
});
