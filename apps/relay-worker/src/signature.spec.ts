import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyShopifyHmac } from "./signature.js";

const SECRET = "webhook-secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyShopifyHmac", () => {
  const body = Buffer.from(JSON.stringify({ id: 1 }));

  it("accepts a valid signature", () => {
    expect(verifyShopifyHmac(body, sign(body.toString()), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(JSON.stringify({ id: 2 }));
    expect(verifyShopifyHmac(tampered, sign(body.toString()), SECRET)).toBe(
      false,
    );
  });

  it("rejects a signature from a different secret", () => {
    expect(verifyShopifyHmac(body, sign(body.toString(), "other"), SECRET)).toBe(
      false,
    );
  });

  it("rejects a missing signature", () => {
    expect(verifyShopifyHmac(body, undefined, SECRET)).toBe(false);
  });
});
