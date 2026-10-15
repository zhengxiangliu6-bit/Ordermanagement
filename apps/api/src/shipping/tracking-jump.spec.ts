import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACKING_JUMP,
  displayTrackingUrl,
  effectiveOwnSiteTemplate,
  readTrackingJump,
  validateTrackingJumpInput,
} from './tracking-jump';
import { resolveOutboundValues } from './outbound-executor.service';

const shipment = {
  attakyTrackingNumber: 'ATK123',
  attakyTrackingUrl: 'https://www.sf-express.com/track/ATK123',
  originalTrackingNumber: 'SF1234567890123',
  carrierTrackingUrl: 'https://www.sf-express.com/track/SF1234567890123',
};

const GLOBAL_TEMPLATE = 'https://track.attaky.com/{number}';

describe('readTrackingJump', () => {
  it('defaults to inherit mode without settings', () => {
    expect(readTrackingJump(null)).toEqual(DEFAULT_TRACKING_JUMP);
    expect(readTrackingJump({})).toEqual(DEFAULT_TRACKING_JUMP);
    expect(readTrackingJump({ trackingJump: { mode: 'bogus' } })).toEqual(
      DEFAULT_TRACKING_JUMP,
    );
    // The earlier 'attaky' value now means inherit.
    expect(readTrackingJump({ trackingJump: { mode: 'attaky' } })).toEqual(
      DEFAULT_TRACKING_JUMP,
    );
  });

  it('reads a valid custom config and keeps other settings untouched', () => {
    expect(
      readTrackingJump({
        dataSource: 'relay',
        trackingJump: { mode: 'custom', customUrlTemplate: ' https://track.beartech.ca/{number} ' },
      }),
    ).toEqual({ mode: 'custom', customUrlTemplate: 'https://track.beartech.ca/{number}' });
  });
});

describe('validateTrackingJumpInput (settings PATCH surface)', () => {
  it('accepts valid configs and absence', () => {
    expect(validateTrackingJumpInput(undefined)).toEqual(DEFAULT_TRACKING_JUMP);
    expect(validateTrackingJumpInput({ mode: 'carrier' })).toEqual({
      mode: 'carrier',
      customUrlTemplate: null,
    });
    expect(
      validateTrackingJumpInput({ mode: 'custom', customUrlTemplate: 'https://t.example/{number}' }),
    ).toEqual({ mode: 'custom', customUrlTemplate: 'https://t.example/{number}' });
  });

  it('rejects invalid modes and templates without a placeholder', () => {
    expect(() => validateTrackingJumpInput({ mode: 'nope' })).toThrow(/mode/);
    expect(() => validateTrackingJumpInput({ mode: 'custom' })).toThrow(/customUrlTemplate/);
    expect(() =>
      validateTrackingJumpInput({ mode: 'custom', customUrlTemplate: 'https://t.example' }),
    ).toThrow(/\{number\}/);
  });
});

describe('effectiveOwnSiteTemplate', () => {
  it('store override wins, inherit uses the global default, carrier has none', () => {
    expect(
      effectiveOwnSiteTemplate({ mode: 'custom', customUrlTemplate: 'https://b.ca/{number}' }, GLOBAL_TEMPLATE),
    ).toBe('https://b.ca/{number}');
    expect(effectiveOwnSiteTemplate(DEFAULT_TRACKING_JUMP, GLOBAL_TEMPLATE)).toBe(GLOBAL_TEMPLATE);
    expect(effectiveOwnSiteTemplate(DEFAULT_TRACKING_JUMP, null)).toBeNull();
    expect(effectiveOwnSiteTemplate({ mode: 'carrier', customUrlTemplate: null }, GLOBAL_TEMPLATE)).toBeNull();
  });
});

describe('resolveOutboundValues under the store×carrier model (§12.5)', () => {
  it('inherit with a global template: transform carriers use the own-site surface', () => {
    expect(
      resolveOutboundValues(shipment, { customTrackingUrl: true }, DEFAULT_TRACKING_JUMP, GLOBAL_TEMPLATE),
    ).toEqual({
      trackingNumber: 'ATK123',
      trackingUrl: 'https://track.attaky.com/ATK123',
      publicTrackingMode: 'attaky',
    });
  });

  it('custom override: the store template replaces the URL (beartech case)', () => {
    expect(
      resolveOutboundValues(
        shipment,
        { customTrackingUrl: true },
        { mode: 'custom', customUrlTemplate: 'https://track.beartech.ca/{number}' },
        GLOBAL_TEMPLATE,
      ),
    ).toEqual({
      trackingNumber: 'ATK123',
      trackingUrl: 'https://track.beartech.ca/ATK123',
      publicTrackingMode: 'attaky',
    });
  });

  it('no own-site template anywhere: M4 behavior (carrier template + Attaky number)', () => {
    expect(
      resolveOutboundValues(shipment, { customTrackingUrl: true }, DEFAULT_TRACKING_JUMP, null),
    ).toEqual({
      trackingNumber: 'ATK123',
      trackingUrl: 'https://www.sf-express.com/track/ATK123',
      publicTrackingMode: 'attaky',
    });
  });

  it('carrier mode forces the last-mile values (bunnyhouse case)', () => {
    expect(
      resolveOutboundValues(
        shipment,
        { customTrackingUrl: true },
        { mode: 'carrier', customUrlTemplate: null },
        GLOBAL_TEMPLATE,
      ),
    ).toEqual({
      trackingNumber: 'SF1234567890123',
      trackingUrl: 'https://www.sf-express.com/track/SF1234567890123',
      publicTrackingMode: 'carrier',
    });
  });

  it('non-transform carriers ignore the own-site template entirely', () => {
    const noTransform = { ...shipment, attakyTrackingNumber: null, attakyTrackingUrl: null };
    expect(
      resolveOutboundValues(noTransform, { customTrackingUrl: true }, DEFAULT_TRACKING_JUMP, GLOBAL_TEMPLATE),
    ).toEqual({
      trackingNumber: 'SF1234567890123',
      trackingUrl: 'https://www.sf-express.com/track/SF1234567890123',
      publicTrackingMode: 'carrier',
    });
  });
});

describe('displayTrackingUrl (§12.6)', () => {
  it('selects the link per mode and template', () => {
    expect(displayTrackingUrl(DEFAULT_TRACKING_JUMP, GLOBAL_TEMPLATE, shipment)).toBe(
      'https://track.attaky.com/ATK123',
    );
    expect(
      displayTrackingUrl(
        { mode: 'custom', customUrlTemplate: 'https://track.beartech.ca/{number}' },
        GLOBAL_TEMPLATE,
        shipment,
      ),
    ).toBe('https://track.beartech.ca/ATK123');
    expect(
      displayTrackingUrl({ mode: 'carrier', customUrlTemplate: null }, GLOBAL_TEMPLATE, shipment),
    ).toBe('https://www.sf-express.com/track/SF1234567890123');
    // No own-site surface configured: M4 legacy link.
    expect(displayTrackingUrl(DEFAULT_TRACKING_JUMP, null, shipment)).toBe(
      'https://www.sf-express.com/track/ATK123',
    );
  });

  it('never hijacks carriers without a transform; falls back for manual entries', () => {
    const noAttaky = {
      attakyTrackingNumber: null,
      originalTrackingNumber: 'SF1234567890123',
      attakyTrackingUrl: null,
      carrierTrackingUrl: 'https://www.sf-express.com/track/SF1234567890123',
    };
    expect(displayTrackingUrl(DEFAULT_TRACKING_JUMP, GLOBAL_TEMPLATE, noAttaky)).toBe(
      'https://www.sf-express.com/track/SF1234567890123',
    );
    expect(displayTrackingUrl({ mode: 'carrier', customUrlTemplate: null }, GLOBAL_TEMPLATE, noAttaky)).toBe(
      'https://www.sf-express.com/track/SF1234567890123',
    );
    expect(
      displayTrackingUrl(
        { mode: 'custom', customUrlTemplate: 'https://track.beartech.ca/{number}' },
        GLOBAL_TEMPLATE,
        noAttaky,
      ),
    ).toBe('https://www.sf-express.com/track/SF1234567890123');
  });
});
