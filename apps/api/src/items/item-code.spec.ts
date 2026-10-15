import { describe, expect, it } from "vitest";
import { generateItemCode, ITEM_CODE_PATTERN } from "./item-code";

describe("generateItemCode", () => {
  it("generates codes matching the permanent format", () => {
    const code = generateItemCode();
    expect(code).toMatch(ITEM_CODE_PATTERN);
    expect(generateItemCode()).not.toBe(code);
  });

  it("avoids ambiguous characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const body = generateItemCode().slice(4);
      expect(body).not.toMatch(/[0O1IL]/);
    }
  });
});
