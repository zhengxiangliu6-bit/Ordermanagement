import { describe, expect, it } from "vitest";
import { generateOrderNumber, ORDER_NUMBER_PATTERN } from "./order-number";

describe("generateOrderNumber", () => {
  it("generates internal order numbers in the permanent format", () => {
    const number = generateOrderNumber();
    expect(number).toMatch(ORDER_NUMBER_PATTERN);
    expect(generateOrderNumber()).not.toBe(number);
  });
});
