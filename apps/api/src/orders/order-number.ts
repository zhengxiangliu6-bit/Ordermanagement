import { randomBytes } from 'node:crypto';

/**
 * Internal Order Numbers are permanent, unique, system-generated
 * (functional design §10.2). Format: `ATK-ORD-` + 8 unambiguous characters.
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const ORDER_NUMBER_PATTERN = /^ATK-ORD-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export function generateOrderNumber(): string {
  const bytes = randomBytes(8);
  let code = 'ATK-ORD-';
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}
