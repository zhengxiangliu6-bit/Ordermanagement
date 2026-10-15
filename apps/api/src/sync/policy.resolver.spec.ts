import { describe, expect, it } from "vitest";
import { DEFAULT_REVIEW_POLICY, resolveReviewRequired } from "./policy.resolver.js";

describe("review policy resolver", () => {
  it("defaults to review-required for every content type", () => {
    expect(resolveReviewRequired(undefined, "orders.new")).toBe(true);
    expect(resolveReviewRequired(undefined, "orders.updates")).toBe(true);
    expect(resolveReviewRequired(null, "listings.new")).toBe(true);
    expect(resolveReviewRequired({}, "listings.updates")).toBe(true);
  });

  it("applies per-store overrides", () => {
    const policy = {
      orders: { new: false },
      listings: { updates: false },
    };
    expect(resolveReviewRequired(policy, "orders.new")).toBe(false);
    expect(resolveReviewRequired(policy, "orders.updates")).toBe(true);
    expect(resolveReviewRequired(policy, "listings.new")).toBe(true);
    expect(resolveReviewRequired(policy, "listings.updates")).toBe(false);
  });

  it("falls back to the global default for malformed overrides", () => {
    expect(resolveReviewRequired({ orders: "nope" }, "orders.new")).toBe(true);
    expect(
      resolveReviewRequired({ listings: { updates: "sometimes" } }, "listings.updates"),
    ).toBe(true);
  });

  it("exposes the documented default policy", () => {
    expect(DEFAULT_REVIEW_POLICY).toEqual({
      orders: { new: true, updates: true },
      listings: { new: true, updates: true },
    });
  });
});
