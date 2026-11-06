# Etsy OAuth MVP (private API, manual callback transfer)

This branch adds a first-stage **backend-only** Etsy OAuth 2.0 + PKCE implementation.
It does not yet provide an Etsy connection UI, refresh-token rotation, shop
identity verification, listings/orders sync, or production Relay Worker callback
delivery. It does not modify the existing Shopify integration.

## Why manual transfer?

The internal Ordermanagement API is LAN-only, while the already approved Etsy
Seller App uses exactly `https://etsyapi.beartechworkshop.com` as its redirect.
The public Nginx location displays a plain text message and keeps the callback
`code` and `state` in the browser address bar. These are sensitive and must
only be transferred securely to the private order management operator.

The present Relay Worker uses an **in-memory queue**, not a persistent callback
store; do not route OAuth one-time codes through it without persistence work.

## Setup

1. Deploy the Prisma migration and regenerate the client:
   `pnpm --filter @om/api db:migrate` (dev) or
   `pnpm --filter @om/api db:deploy` (deployment), then
   `pnpm --filter @om/api prisma:generate`.
2. In `apps/api/.env`, add:
   - `ETSY_KEYSTRING` — Etsy Seller App keystring
   - `ETSY_REDIRECT_URI=https://etsyapi.beartechworkshop.com`
   - `ETSY_TOKEN_ENCRYPTION_KEY` — 32 random bytes encoded with base64
     (`openssl rand -base64 32`).
   - `ETSY_SHARED_SECRET` is reserved for later Etsy data API calls; OAuth
     PKCE exchange does not need it.
3. Restart the private NestJS API. Keep all keys off the frontend and out of
   source control. Preserve the encryption key; losing it makes stored
   credentials undecryptable.

## Authenticated endpoints

The NestJS API uses the existing Better Auth session and store permissions.

1. Register an Etsy store with `POST /api/v1/stores` using
   `{"platform":"etsy","displayName":"Your Shop"}`.
2. `POST /api/v1/stores/{storeId}/etsy-oauth/start` (stores:connect)
   returns `authorizationUrl` and `expiresAt`.
3. Give the URL to the actual Etsy shop owner to authorize. The authorization
   link and callback URL are sensitive. Never paste them into logs or public
   chat. Complete promptly (pending authorization expires after 10 minutes).
4. After Etsy redirects to the Nginx root page, securely bring the **full
   callback URL** back to an operator on the LAN.
5. Call `POST /api/v1/stores/{storeId}/etsy-oauth/complete` with
   `{"callbackUrl":"https://etsyapi.beartechworkshop.com/?code=...&state=..."}`.
6. `GET /api/v1/stores/{storeId}/etsy-oauth/status` (stores:read) returns
   only authorization status, scopes, and expiry, never tokens.

Security: the backend hashes state, encrypts PKCE verifiers and credentials
with AES-256-GCM, atomically claims state, and does not store tokens in
`Store.settings`. Callback URLs must never be logged.

## Testing

- `pnpm --filter @om/api test`
- `pnpm --filter @om/api typecheck`
- `pnpm --filter @om/api build`
- `pnpm generate:api` to refresh OpenAPI + generated web client when adding UI.

Real Etsy owner authorization and backend reachability to
`https://api.etsy.com/v3/public/oauth/token` must be tested separately.
This branch is **not production-complete**: add token refresh, shop verification,
UI and actual Etsy API adapters before setting the store to connected.
