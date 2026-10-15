/**
 * Carrier recognition & tracking-number transformation rules (§12.4).
 *
 * Pure functions only: matching, normalization, the restricted Attaky
 * tracking-number transformation model (regex + capture groups + template —
 * never shell/sed/arbitrary code), URL template rendering, and rule-set
 * validation used by the settings UI.
 */

export interface CarrierNormalization {
  /** Remove all whitespace before matching/transforming. */
  stripSpaces?: boolean;
  /** Uppercase before matching/transforming. */
  uppercase?: boolean;
}

export interface CarrierRecognition {
  /** One or more regexes (JS syntax); any match recognizes the carrier. */
  regexes: string[];
  normalization?: CarrierNormalization;
  /** Display ordering only — never used to silently disambiguate matches. */
  priority?: number;
}

export interface AttakyTransformRule {
  /** Restricted regex applied to the normalized tracking number. */
  pattern: string;
  /** Replacement template; only $1..$9 capture references are allowed. */
  replacement: string;
}

export interface AttakyTransform {
  /** Rules apply in order; the last write wins per captured portion. */
  rules: AttakyTransformRule[];
  /** Increments whenever recognition/transformation rules change (§12.4). */
  version: number;
}

export interface CarrierRuleSet {
  key: string;
  name: string;
  enabled: boolean;
  recognition: CarrierRecognition;
  trackingUrlTemplate?: string | null;
  attakyTransform?: AttakyTransform | null;
}

export type CarrierMatchResult =
  | { kind: "single"; carrier: CarrierRuleSet }
  | { kind: "ambiguous"; carriers: CarrierRuleSet[] }
  | { kind: "none" };

export class InvalidRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRuleError";
  }
}

const ALLOWED_TEMPLATE_REF = /^\$\d$/;

export function normalizeTrackingNumber(
  trackingNumber: string,
  normalization?: CarrierNormalization,
): string {
  let value = trackingNumber.trim();
  if (normalization?.stripSpaces) value = value.replace(/\s+/g, "");
  if (normalization?.uppercase) value = value.toUpperCase();
  return value;
}

function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    throw new InvalidRuleError(`Invalid regex pattern: ${pattern}`);
  }
}

/**
 * Validates a rule set up-front: patterns must compile, and replacement
 * templates may only reference $1..$9 (restricted transformation model,
 * §12.4 — no shell, no sed, no arbitrary code).
 */
export function validateAttakyTransform(transform: AttakyTransform): void {
  if (!Array.isArray(transform.rules) || transform.rules.length === 0) {
    throw new InvalidRuleError("Transformation requires at least one rule.");
  }
  if (typeof transform.version !== "number") {
    throw new InvalidRuleError("Transformation rules require a version.");
  }
  for (const rule of transform.rules) {
    compilePattern(rule.pattern);
    for (const ref of rule.replacement.match(/\$\d+/g) ?? []) {
      if (!ALLOWED_TEMPLATE_REF.test(ref)) {
        throw new InvalidRuleError(
          `Replacement references invalid group ${ref} (only $1..$9 allowed).`,
        );
      }
    }
  }
}

export function validateRecognition(recognition: CarrierRecognition): void {
  if (!Array.isArray(recognition.regexes) || recognition.regexes.length === 0) {
    throw new InvalidRuleError("Recognition requires at least one regex.");
  }
  for (const regex of recognition.regexes) compilePattern(regex);
}

/** Applies the (already validated) transformation rules in order. */
export function transformToAttakyNumber(
  normalizedNumber: string,
  transform: AttakyTransform,
): string {
  let value = normalizedNumber;
  for (const rule of transform.rules) {
    value = value.replace(compilePattern(rule.pattern), rule.replacement);
  }
  return value;
}

/** Renders an official tracking URL from a template with {number}. */
export function renderTrackingUrl(
  template: string | null | undefined,
  trackingNumber: string,
): string | null {
  if (!template) return null;
  if (!template.includes("{number}")) return null;
  return template.replace("{number}", encodeURIComponent(trackingNumber));
}

/** Matches a normalized tracking number against all enabled carriers. */
export function matchCarriers(
  trackingNumber: string,
  carriers: CarrierRuleSet[],
): CarrierMatchResult {
  const normalized = (carrier: CarrierRuleSet) =>
    normalizeTrackingNumber(trackingNumber, carrier.recognition.normalization);
  const matches = carriers.filter((carrier) => {
    if (!carrier.enabled) return false;
    const value = normalized(carrier);
    return carrier.recognition.regexes.some((regex) =>
      compilePattern(regex).test(value),
    );
  });
  if (matches.length === 1) return { kind: "single", carrier: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", carriers: matches };
  return { kind: "none" };
}

export interface PreviewOutcome {
  carrierKey: string;
  normalizedNumber: string;
  attakyTrackingNumber: string | null;
  attakyTrackingUrl: string | null;
  carrierTrackingUrl: string | null;
}

/** Full preview pipeline for one carrier (§12.3 step 6). */
export function previewForCarrier(
  trackingNumber: string,
  carrier: CarrierRuleSet,
): PreviewOutcome {
  const normalizedNumber = normalizeTrackingNumber(
    trackingNumber,
    carrier.recognition.normalization,
  );
  let attakyTrackingNumber: string | null = null;
  if (carrier.attakyTransform) {
    validateAttakyTransform(carrier.attakyTransform);
    attakyTrackingNumber = transformToAttakyNumber(
      normalizedNumber,
      carrier.attakyTransform,
    );
  }
  return {
    carrierKey: carrier.key,
    normalizedNumber,
    attakyTrackingNumber,
    attakyTrackingUrl: attakyTrackingNumber
      ? renderTrackingUrl(carrier.trackingUrlTemplate, attakyTrackingNumber)
      : null,
    carrierTrackingUrl: renderTrackingUrl(
      carrier.trackingUrlTemplate,
      normalizedNumber,
    ),
  };
}

/**
 * Collision detection (§12.4): runs a batch of original numbers through the
 * transform and reports any two distinct originals producing the same Attaky
 * number. Returns the colliding pairs (empty when clean).
 */
export function findTransformCollisions(
  sampleNumbers: string[],
  carrier: CarrierRuleSet,
): Array<{ a: string; b: string; attakyNumber: string }> {
  if (!carrier.attakyTransform) return [];
  const outputs = new Map<string, string>();
  const collisions: Array<{ a: string; b: string; attakyNumber: string }> = [];
  for (const original of sampleNumbers) {
    const normalized = normalizeTrackingNumber(
      original,
      carrier.recognition.normalization,
    );
    const attaky = transformToAttakyNumber(
      normalized,
      carrier.attakyTransform,
    );
    const existing = outputs.get(attaky);
    if (existing !== undefined && existing !== original) {
      collisions.push({ a: existing, b: original, attakyNumber: attaky });
    } else {
      outputs.set(attaky, original);
    }
  }
  return collisions;
}
