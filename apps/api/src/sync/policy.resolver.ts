/**
 * Review policy resolution (functional design §13.1): a global default,
 * overridable per Store, per content type. Changing a policy affects future
 * incoming content only — already pending records stay pending.
 */

export interface ReviewPolicyContentTypes {
  orders: { new: boolean; updates: boolean };
  listings: { new: boolean; updates: boolean };
}

export type ReviewContentType =
  | 'orders.new'
  | 'orders.updates'
  | 'listings.new'
  | 'listings.updates';

export const DEFAULT_REVIEW_POLICY: ReviewPolicyContentTypes = {
  orders: { new: true, updates: true },
  listings: { new: true, updates: true },
};

/**
 * Store-level overrides come from `Store.reviewPolicy` JSON, e.g.
 * `{ "orders": { "new": false }, "listings": { "updates": false } }`.
 * Unknown/malformed overrides fall back to the global default.
 */
export function resolveReviewRequired(
  storeReviewPolicy: unknown,
  contentType: ReviewContentType,
): boolean {
  const globalDefault =
    contentType === 'orders.new'
      ? DEFAULT_REVIEW_POLICY.orders.new
      : contentType === 'orders.updates'
        ? DEFAULT_REVIEW_POLICY.orders.updates
        : contentType === 'listings.new'
          ? DEFAULT_REVIEW_POLICY.listings.new
          : DEFAULT_REVIEW_POLICY.listings.updates;

  if (typeof storeReviewPolicy !== 'object' || storeReviewPolicy === null) {
    return globalDefault;
  }
  const [domain, kind] = contentType.split('.');
  const override = (storeReviewPolicy as Record<string, unknown>)[domain];
  if (typeof override !== 'object' || override === null) return globalDefault;
  const value = (override as Record<string, unknown>)[kind];
  return typeof value === 'boolean' ? value : globalDefault;
}
