/**
 * Customer identity normalization for related-order suggestions (§17):
 * normalized email/phone matches are strong signals, a normalized address
 * match alone is a weak signal. Display values are never rewritten.
 */

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  // Ignore entries too short to be a meaningful phone identity.
  return digits.length >= 7 ? digits : null;
}

export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const folded = value.toLowerCase().replace(/ß/g, "ss");
  const collapsed = folded.replace(/[^a-z0-9]+/g, " ").trim();
  return collapsed.length >= 5 ? collapsed : null;
}

export interface CustomerIdentity {
  email: string | null;
  phone: string | null;
  address: string | null;
}

export function customerIdentity(snapshot: unknown): CustomerIdentity {
  const cs = (snapshot ?? {}) as Record<string, unknown>;
  return {
    email: normalizeEmail(cs.email),
    phone: normalizePhone(cs.phone),
    address: normalizeAddress(cs.addressLine1),
  };
}
