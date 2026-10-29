/**
 * Per-store tracking-jump configuration (2026-10-15 model, final ruling):
 *
 *   carrier (has transform rule?)  ×  store (jump mode)
 *
 * - Carriers WITH an Attaky transform (Yunexpress/4PX style) produce an
 *   own tracking number; where that number is queried is decided by the
 *   STORE: mode=inherit uses the global-default own-site template,
 *   mode=custom overrides it with the store's own template, mode=carrier
 *   forces the last-mile number + the carrier's official link.
 * - Carriers WITHOUT a transform always use the carrier's official link
 *   with the original number, regardless of the store's setting.
 *
 * The global-default template lives on ShippingSettings; nothing about
 * stores lives on the carrier, and nothing about carriers lives here.
 *
 * Surfaces governed by this model:
 * - §12.5 outbound values: which number/URL is pushed to the platform
 * - §12.6 tracking display: which link the order detail offers
 */

export type TrackingJumpMode = 'inherit' | 'custom' | 'carrier';

export interface TrackingJumpConfig {
  mode: TrackingJumpMode;
  /** URL template for mode=custom; `{number}` is replaced by the tracking number. */
  customUrlTemplate: string | null;
}

export const DEFAULT_TRACKING_JUMP: TrackingJumpConfig = {
  mode: 'inherit',
  customUrlTemplate: null,
};

const MODES: readonly TrackingJumpMode[] = ['inherit', 'custom', 'carrier'];

/** Reads the config from a Store.settings JSON value; invalid data falls back to the default. */
export function readTrackingJump(settings: unknown): TrackingJumpConfig {
  const raw = (settings as { trackingJump?: unknown } | null)?.trackingJump;
  if (raw === null || raw === undefined) return DEFAULT_TRACKING_JUMP;
  if (typeof raw !== 'object') return DEFAULT_TRACKING_JUMP;
  const candidate = raw as { mode?: unknown; customUrlTemplate?: unknown };
  if (
    typeof candidate.mode !== 'string' ||
    !MODES.includes(candidate.mode as TrackingJumpMode)
  ) {
    // Includes the earlier 'attaky' value: it mapped to the global-default
    // behavior, which 'inherit' now names.
    return DEFAULT_TRACKING_JUMP;
  }
  const template =
    typeof candidate.customUrlTemplate === 'string' &&
    candidate.customUrlTemplate.trim().length > 0
      ? candidate.customUrlTemplate.trim()
      : null;
  if (template === null) return { mode: candidate.mode as TrackingJumpMode, customUrlTemplate: null };
  // Bad stored templates (e.g. full-width punctuation written before the
  // strict validation existed) fall back to the default instead of
  // producing broken links.
  try {
    return {
      mode: candidate.mode as TrackingJumpMode,
      customUrlTemplate: validateOwnSiteTemplate(template),
    };
  } catch {
    return DEFAULT_TRACKING_JUMP;
  }
}

/** Strict validation for the settings PATCH surface (rejects instead of falling back). */
export function validateTrackingJumpInput(input: unknown): TrackingJumpConfig {
  if (input === null || input === undefined) return DEFAULT_TRACKING_JUMP;
  if (typeof input !== 'object') {
    throw new Error('trackingJump must be an object');
  }
  const candidate = input as { mode?: unknown; customUrlTemplate?: unknown };
  if (candidate.mode === undefined) return DEFAULT_TRACKING_JUMP;
  if (
    typeof candidate.mode !== 'string' ||
    !MODES.includes(candidate.mode as TrackingJumpMode)
  ) {
    throw new Error(`trackingJump.mode must be one of: ${MODES.join(', ')}`);
  }
  const mode = candidate.mode as TrackingJumpMode;
  const template =
    candidate.customUrlTemplate === undefined ||
    candidate.customUrlTemplate === null
      ? null
      : String(candidate.customUrlTemplate).trim() || null;
  if (mode === 'custom' && template === null) {
    throw new Error('trackingJump.customUrlTemplate is required for mode=custom');
  }
  if (template !== null) {
    // Reuse the strict URL hygiene (rejects full-width punctuation etc.).
    const validated = validateOwnSiteTemplate(template);
    return { mode, customUrlTemplate: validated };
  }
  return { mode, customUrlTemplate: null };
}

/**
 * URL-template hygiene shared with the global setting (throws on a bad
 * template). Full-width punctuation (Chinese IME artifacts like ？) and
 * non-URL inputs are rejected: they produce silently broken links.
 */
export function validateOwnSiteTemplate(input: string): string {
  const template = input.trim();
  if (!/^https?:\/\/[^\s]+$/.test(template)) {
    throw new Error('Template must be an http(s) URL, e.g. https://track.example.com/{number}');
  }
  if (!/^[\x20-\x7E]+$/.test(template)) {
    throw new Error(
      'Template must contain ASCII characters only (check for full-width punctuation such as ？ / ：)',
    );
  }
  if (!template.includes('{number}')) {
    throw new Error('Template must contain the {number} placeholder');
  }
  return template;
}

/**
 * The own-site template actually in effect for a store: the store's
 * override (mode=custom), else the global default (mode=inherit).
 * Null means "no own-site surface configured" — M4 behavior applies
 * (the carrier's official template rendered with the Attaky number).
 */
export function effectiveOwnSiteTemplate(
  jump: TrackingJumpConfig,
  globalTemplate: string | null,
): string | null {
  if (jump.mode === 'custom') return jump.customUrlTemplate;
  if (jump.mode === 'inherit') return globalTemplate;
  return null;
}

/** §12.6 display link for a shipment under this store's config. */
export function displayTrackingUrl(
  jump: TrackingJumpConfig,
  globalOwnSiteTemplate: string | null,
  shipment: {
    attakyTrackingNumber: string | null;
    originalTrackingNumber: string | null;
    attakyTrackingUrl: string | null;
    carrierTrackingUrl: string | null;
  },
): string | null {
  if (jump.mode === 'carrier') {
    return shipment.carrierTrackingUrl ?? shipment.attakyTrackingUrl;
  }
  // The store's own tracking surface applies ONLY to shipments that carry
  // an Attaky tracking number — i.e. carriers configured with an Attaky
  // transform. Carriers without a transform always keep their own official
  // tracking link, regardless of the store's jump setting.
  if (shipment.attakyTrackingNumber !== null) {
    const ownSiteTemplate = effectiveOwnSiteTemplate(jump, globalOwnSiteTemplate);
    if (ownSiteTemplate) {
      return ownSiteTemplate.replace('{number}', shipment.attakyTrackingNumber);
    }
    // No own-site surface configured: M4 behavior (the carrier's official
    // template rendered with the Attaky number).
    return shipment.attakyTrackingUrl ?? shipment.carrierTrackingUrl;
  }
  return shipment.carrierTrackingUrl ?? shipment.attakyTrackingUrl;
}
