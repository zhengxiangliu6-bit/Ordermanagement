import type { Request } from 'express';

/**
 * Converts Node incoming headers to fetch Headers for Better Auth's
 * server-side session lookup (better-auth is ESM-only, so its
 * fromNodeHeaders helper is not used here).
 */
export function toFetchHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}
