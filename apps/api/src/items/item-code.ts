import { randomBytes } from 'node:crypto';

/**
 * Item Codes are permanent, unique, system-generated identities for Item
 * Variants (functional design §4, §26.5). Format: `ATK-` + 8 characters
 * from an unambiguous alphabet (no 0/O/1/I/L).
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const ITEM_CODE_PATTERN = /^ATK-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export function generateItemCode(): string {
  const bytes = randomBytes(8);
  let code = 'ATK-';
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}
