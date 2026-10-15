# Relay Worker image (public VPS deployment).
# NOTE: image builds are exercised at the deployment milestone.

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/relay-contract/package.json packages/relay-contract/
COPY apps/relay-worker/package.json apps/relay-worker/
RUN pnpm install --frozen-lockfile --filter @om/relay-worker --filter @om/relay-contract

COPY packages/relay-contract packages/relay-contract
COPY apps/relay-worker apps/relay-worker
RUN pnpm --filter @om/relay-contract build && pnpm --filter @om/relay-worker build

RUN pnpm --filter @om/relay-worker deploy --prod /out

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
EXPOSE 3100
# TLS terminates at the edge (reverse proxy / Caddy) per the approved
# architecture; the worker itself serves plain HTTP.
CMD ["node", "dist/index.js"]
