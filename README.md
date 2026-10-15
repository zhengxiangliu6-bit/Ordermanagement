# Order Management System

Internal system of record for orders across multiple Shopify and Etsy stores,
plus manually created orders. Approved decisions live in the separate
`attaky-site-notes/order-management` dev-notes repository; this repository
holds the application source code only.

## Stack (approved)

- TypeScript everywhere
- Frontend: React + Vite (`apps/web`)
- Backend: NestJS (`apps/api`), all authoritative data processing
- Data: PostgreSQL + Prisma
- Background jobs (from M1): pg-boss (PostgreSQL-backed, no Redis)
- API: versioned REST under `/api/v1`, OpenAPI contract exported to
  `apps/api/openapi.json`, typed client generated into `apps/web/src/api-client`
- Styling foundation: Tailwind CSS (Radix Primitives as controls arrive later)
- Auth: **Better Auth** (pinned release) with the Prisma adapter and
  database-backed sessions. Better Auth owns passwords/sessions/revocation;
  NestJS owns roles, the permission model (`packages/shared`), and every
  authorization decision. Public self-registration is disabled; the seed
  creates the first administrator through Better Auth itself.

## Architecture at a glance

Two separately deployed applications share this repository (ADR-002):

```
Internet ──HTTPS──> Relay Worker (public VPS, apps/relay-worker)
                         ▲ pull · lease · acknowledge (machine credential)
Trusted LAN ──HTTP──> Web (apps/web) ──/api──> API (apps/api) ──> PostgreSQL + attachment volume
```

- **Relay Worker** (`apps/relay-worker`): durable transport + platform-adapter
  boundary. Receives platform webhooks (signature-verified), executes platform
  API calls for submitted commands, and hands results to the private system
  over an outbound-only pull/lease/ack protocol defined in
  `packages/relay-contract` (versioned). It holds no business records and no
  staff UI, and must not import `@om/api` or `@om/shared` (enforced by ESLint).
- **Private app** (`apps/web` + `apps/api`): modular monolith on the internal
  network; the only system of record. Plain HTTP on the trusted LAN is an
  accepted posture (ADR-004) — revisit if ever exposed beyond the LAN.
- Deployment topology lives in `deploy/` (one compose file per trust zone).
  Image builds are exercised at the deployment milestone; secrets are supplied
  via env files (`deploy/api.env`, `deploy/relay.env`) that are never committed.

## Layout

```
apps/web             React + Router (Data Mode) + TanStack Query
apps/api             NestJS app; Prisma schema + migrations under apps/api/prisma
apps/relay-worker    Public Relay Worker (Express; transport + adapters only)
packages/shared      Permission scopes/keys shared by API and web
packages/relay-contract  Versioned private<->relay protocol (zod schemas)
deploy/              Per-trust-zone compose files (internal / relay VPS)
```

## Prerequisites

- Node.js >= 20 (corepack/pnpm enabled)
- PostgreSQL 16 (dev instance via Docker)

## Quickstart

```sh
pnpm install

# Dev database (docker compose)...
docker compose up -d postgres
# ...or without the compose plugin:
docker run -d --name om-pg-dev \
  -e POSTGRES_USER=om -e POSTGRES_PASSWORD=om_dev_pw -e POSTGRES_DB=order_management \
  -p 127.0.0.1:5432:5432 postgres:16-alpine

cp apps/api/.env.example apps/api/.env    # adjust DATABASE_URL / admin seed values
pnpm --filter @om/api db:migrate
pnpm db:seed                              # roles + administrator (via Better Auth)

pnpm dev:api                              # http://localhost:3000/api/v1 (binds 0.0.0.0)
pnpm dev:web                              # binds 0.0.0.0; open the printed LAN URL on phones
pnpm dev:relay                            # http://localhost:3100/relay/v1/health (binds 0.0.0.0)
```

The web dev server proxies `/api` to the API server, so session cookies stay
same-origin. Sign in at `http://<lan-ip>:5173` with the seeded administrator.

## Scripts (workspace root)

| Script | Purpose |
|---|---|
| `pnpm dev:api` / `pnpm dev:web` | Run each dev server (LAN-accessible) |
| `pnpm build` / `pnpm typecheck` | Build / strict-typecheck all packages |
| `pnpm lint` | ESLint (typescript-eslint) |
| `pnpm test` | Vitest unit tests (fast, no DB needed) |
| `pnpm generate:api` | Export `openapi.json` + regenerate the typed client |
| `pnpm db:migrate` / `pnpm db:seed` | Prisma migrations / seed roles + admin |

API integration tests that need a live database are opt-in:

```sh
OM_E2E=1 pnpm --filter @om/api test
```

## Conventions

- Source code, commit messages, and all user-facing copy: English only.
- Secrets live in `.env` (gitignored); `.env.example` documents the shape.
- The generated client (`apps/web/src/api-client/schema.d.ts`) is never
  hand-edited; regenerate with `pnpm generate:api`.
- Dev servers bind `0.0.0.0` so phones/tablets on the LAN can be used for
  testing.
