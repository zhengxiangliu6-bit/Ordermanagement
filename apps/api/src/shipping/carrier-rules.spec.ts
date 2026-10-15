import { describe, expect, it } from "vitest";
import {
  findTransformCollisions,
  InvalidRuleError,
  matchCarriers,
  normalizeTrackingNumber,
  previewForCarrier,
  renderTrackingUrl,
  transformToAttakyNumber,
  validateAttakyTransform,
  type CarrierRuleSet,
} from "./carrier-rules";

const expressCarrier: CarrierRuleSet = {
  key: "sf-express",
  name: "SF Express",
  enabled: true,
  recognition: {
    regexes: ["^SF\\d{13}$"],
    normalization: { stripSpaces: true, uppercase: true },
  },
  trackingUrlTemplate: "https://www.sf-express.com/track/{number}",
  attakyTransform: {
    rules: [{ pattern: "^SF(\\d{3})\\d{6}(\\d{4})$", replacement: "ATK-$1$2" }],
    version: 1,
  },
};

const yanwenCarrier: CarrierRuleSet = {
  key: "yanwen",
  name: "Yanwen",
  enabled: true,
  recognition: { regexes: ["^YM\\d{12}$"] },
  trackingUrlTemplate: "https://track.yanwen.com/?number={number}",
  attakyTransform: null,
};

describe("carrier rules (§12.4)", () => {
  it("normalizes tracking numbers", () => {
    expect(normalizeTrackingNumber(" sf 1234567890123 ", { stripSpaces: true, uppercase: true })).toBe(
      "SF1234567890123",
    );
  });

  it("matches exactly one carrier", () => {
    const result = matchCarriers("sf1234567890123", [expressCarrier, yanwenCarrier]);
    expect(result).toMatchObject({ kind: "single", carrier: { key: "sf-express" } });
  });

  it("reports ambiguity without silently choosing (§12.3)", () => {
    const overlapping: CarrierRuleSet = {
      ...yanwenCarrier,
      key: "other",
      recognition: { regexes: ["^SF\\d+$"] },
    };
    const result = matchCarriers("SF1234567890123", [expressCarrier, overlapping]);
    expect(result.kind).toBe("ambiguous");
  });

  it("returns none for unmatched numbers (manual selection path)", () => {
    expect(matchCarriers("ZZZ999", [expressCarrier]).kind).toBe("none");
  });

  it("transforms with capture groups only", () => {
    expect(transformToAttakyNumber("SF1234567890123", expressCarrier.attakyTransform!)).toBe(
      "ATK-1230123",
    );
  });

  it("rejects invalid patterns and out-of-range template refs", () => {
    expect(() =>
      validateAttakyTransform({ rules: [{ pattern: "([", replacement: "x" }], version: 1 }),
    ).toThrow(InvalidRuleError);
    expect(() =>
      validateAttakyTransform({ rules: [{ pattern: "(a)", replacement: "$12x" }], version: 1 }),
    ).toThrow(InvalidRuleError);
  });

  it("renders official tracking URLs with {number}", () => {
    expect(renderTrackingUrl("https://t/{number}", "ABC")).toBe("https://t/ABC");
    expect(renderTrackingUrl("https://t/?q={number}", "a b")).toBe("https://t/?q=a%20b");
    expect(renderTrackingUrl(null, "ABC")).toBeNull();
    expect(renderTrackingUrl("https://no-placeholder", "ABC")).toBeNull();
  });

  it("previews the full pipeline for one carrier", () => {
    const preview = previewForCarrier(" sf1234567890123 ", expressCarrier);
    expect(preview).toEqual({
      carrierKey: "sf-express",
      normalizedNumber: "SF1234567890123",
      attakyTrackingNumber: "ATK-1230123",
      attakyTrackingUrl: "https://www.sf-express.com/track/ATK-1230123",
      carrierTrackingUrl: "https://www.sf-express.com/track/SF1234567890123",
    });
  });

  it("detects collisions between distinct originals producing the same Attaky number", () => {
    const lossy: CarrierRuleSet = {
      ...expressCarrier,
      attakyTransform: { rules: [{ pattern: "^SF(\\d{3}).*", replacement: "ATK-$1" }], version: 2 },
    };
    const collisions = findTransformCollisions(
      ["SF1112223334444", "SF1119998887777", "SF2223334445555"],
      lossy,
    );
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({ a: "SF1112223334444", b: "SF1119998887777", attakyNumber: "ATK-111" });
  });
});
