import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Shopify webhook HMAC (base64 in `X-Shopify-Hmac-Sha256`)
 * against the raw request body. Signature verification uses the untouched
 * body bytes; the public boundary trusts nothing else.
 */
export function verifyShopifyHmac(
  rawBody: Buffer,
  hmacBase64: string | undefined,
  secret: string,
): boolean {
  if (!hmacBase64) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacBase64, "base64");
  } catch {
    return false;
  }
  if (provided.length !== digest.length) return false;
  return timingSafeEqual(digest, provided);
}
