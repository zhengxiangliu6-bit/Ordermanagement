import { describe, expect, it } from "vitest";

describe("buildTransform keep-digit validation", () => {
  it("rejects keep-first+keep-last exceeding the digit count (no silent no-op)", () => {
    // 13-digit number: keeping 13+13 would never match; must return null.
    expect(buildTransform("TKAT", 13, 13, 13)).toBeNull();
    expect(buildTransform("TKAT", 8, 8, 13)).toBeNull();
    expect(buildTransform("TKAT", 3, 10, 13)).not.toBeNull();
  });
});
import { buildTransform, buildRecognitionRegex } from "./carriers-page";

describe("carriers page rule builders", () => {
  it("keeps first and last digits", () => {
    const t = buildTransform("ATK-", 3, 4, 13)!;
    expect(t.replacement).toBe("ATK-$1$2");
    expect("SF1234567890123".replace(new RegExp(t.pattern), t.replacement)).toBe("ATK-1230123");
  });

  it("keeps only first digits", () => {
    const t = buildTransform("ATK-", 3, 0, 13)!;
    expect("SF1234567890123".replace(new RegExp(t.pattern), t.replacement)).toBe("ATK-123");
  });

  it("keeps only last digits", () => {
    const t = buildTransform("ATK-", 0, 4, 13)!;
    expect("SF1234567890123".replace(new RegExp(t.pattern), t.replacement)).toBe("ATK-0123");
  });

  it("builds recognition regex from prefix and digit count", () => {
    const regex = new RegExp(buildRecognitionRegex("SF", 13));
    expect(regex.test("SF1234567890123")).toBe(true);
    expect(regex.test("SF123")).toBe(false);
    expect(regex.test("YT1234567890123")).toBe(false);
  });
});
