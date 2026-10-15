import { describe, expect, it } from 'vitest';
import {
  buildFulfillmentCreatePayload,
  isTransientRelayCode,
} from './outbound-executor.service';

describe('isTransientRelayCode (§12.11 classification)', () => {
  it('treats relay connectivity problems and throttling as transient', () => {
    expect(isTransientRelayCode('RELAY_TIMEOUT')).toBe(true);
    expect(isTransientRelayCode('RELAY_SUBMIT_FAILED')).toBe(true);
    expect(isTransientRelayCode('RELAY_PULL_FAILED')).toBe(true);
    expect(isTransientRelayCode('HTTP_429')).toBe(true);
    expect(isTransientRelayCode('HTTP_502')).toBe(true);
    expect(isTransientRelayCode('HTTP_503')).toBe(true);
  });

  it('treats platform rejections, auth, and client errors as permanent', () => {
    expect(isTransientRelayCode('USER_ERRORS')).toBe(false);
    expect(isTransientRelayCode('GRAPHQL_ERROR')).toBe(false);
    expect(isTransientRelayCode('SCOPES_MISSING')).toBe(false);
    expect(isTransientRelayCode('RELAY_UNAUTHORIZED')).toBe(false);
    expect(isTransientRelayCode('ORDER_NOT_FOUND')).toBe(false);
    expect(isTransientRelayCode('HTTP_400')).toBe(false);
    expect(isTransientRelayCode('HTTP_401')).toBe(false);
    expect(isTransientRelayCode('HTTP_404')).toBe(false);
  });
});

describe('buildFulfillmentCreatePayload', () => {
  const values = {
    trackingNumber: 'ATK123',
    trackingUrl: 'https://track.attaky.com/ATK123',
    publicTrackingMode: 'attaky' as const,
  };

  it('builds the whole-remaining-quantity payload with carrier and URL', () => {
    expect(
      buildFulfillmentCreatePayload(
        { id: 'gid://shopify/FulfillmentOrder/1' },
        values,
        'SF Express',
        false,
      ),
    ).toEqual({
      fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
      trackingNumber: 'ATK123',
      notifyCustomer: false,
      trackingCompany: 'SF Express',
      trackingUrl: 'https://track.attaky.com/ATK123',
    });
  });

  it('omits company and URL when absent', () => {
    expect(
      buildFulfillmentCreatePayload(
        { id: 'gid://shopify/FulfillmentOrder/2' },
        { ...values, trackingUrl: null },
        null,
        false,
      ),
    ).toEqual({
      fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/2',
      trackingNumber: 'ATK123',
      notifyCustomer: false,
    });
  });
});
