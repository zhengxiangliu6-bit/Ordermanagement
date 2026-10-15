import { createHash } from 'node:crypto';

/** Deterministic JSON stringification with sorted object keys. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** Normalizes values for conflict comparison (§15: whitespace/case/formatting). */
function normalizeComparable(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeComparable(v)]),
    );
  }
  return value;
}

export function deepEqualNormalized(a: unknown, b: unknown): boolean {
  return stableStringify(normalizeComparable(a)) === stableStringify(normalizeComparable(b));
}

export interface ThreeWayInput {
  lastAcceptedExternal: unknown;
  currentInternal: unknown;
  incomingExternal: unknown;
}

export type ConflictVerdict = 'no-change' | 'follow-policy' | 'conflict';

/**
 * Three-way comparison for one external-controlled field group (§15):
 * - internal equals last accepted  → no internal change; follow policy
 * - internal equals incoming       → converged; nothing to do
 * - internal and incoming both
 *   differ from last accepted      → conflict; must be reviewed
 */
export function detectConflict(input: ThreeWayInput): ConflictVerdict {
  const { lastAcceptedExternal, currentInternal, incomingExternal } = input;

  const internalChanged = !deepEqualNormalized(currentInternal, lastAcceptedExternal);
  const incomingChanged = !deepEqualNormalized(incomingExternal, lastAcceptedExternal);
  if (!internalChanged) {
    return incomingChanged ? 'follow-policy' : 'no-change';
  }
  return deepEqualNormalized(currentInternal, incomingExternal) ? 'no-change' : 'conflict';
}
