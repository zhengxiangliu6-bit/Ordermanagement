import { describe, expect, it } from "vitest";
import { deepEqualNormalized, detectConflict, stableHash } from "./conflict.js";

describe("conflict detection", () => {
  const base = { buyerNote: "ship fast", customer: { name: "Li", phone: "+49 30 111" } };

  it("follows policy when only the platform changed", () => {
    expect(
      detectConflict({
        lastAcceptedExternal: base,
        currentInternal: base,
        incomingExternal: { ...base, buyerNote: "changed" },
      }),
    ).toBe("follow-policy");
  });

  it("reports no-change when nothing moved", () => {
    expect(
      detectConflict({
        lastAcceptedExternal: base,
        currentInternal: base,
        incomingExternal: base,
      }),
    ).toBe("no-change");
  });

  it("flags a conflict when internal and incoming diverge", () => {
    expect(
      detectConflict({
        lastAcceptedExternal: base,
        currentInternal: { ...base, buyerNote: "internal fix" },
        incomingExternal: { ...base, buyerNote: "platform edit" },
      }),
    ).toBe("conflict");
  });

  it("treats convergence as no-change even after an internal revision", () => {
    expect(
      detectConflict({
        lastAcceptedExternal: base,
        currentInternal: { ...base, buyerNote: "same edit" },
        incomingExternal: { ...base, buyerNote: "same edit" },
      }),
    ).toBe("no-change");
  });

  it("normalizes whitespace and case", () => {
    expect(
      deepEqualNormalized(
        { phone: "+49 30 1234567", note: "  Ship FAST " },
        { phone: "+49 30 1234567", note: "ship fast" },
      ),
    ).toBe(true);
  });

  it("hashes deterministically regardless of key order", () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});
