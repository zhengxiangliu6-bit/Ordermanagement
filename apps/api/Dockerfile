# Order Management API image (private network deployment).
# NOTE: image builds are exercised at the deployment milestone; the compose
# files under deploy/ document the intended topology.

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable

# Workspace manifests first for layer-cached installs.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/relay-contract/package.json packages/relay-contract/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @om/api --filter @om/shared

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @om/shared build \
  && pnpm --filter @om/api prisma:generate \
  && pnpm --filter @om/api build

# Prune to production dependencies for the api workspace.
RUN pnpm --filter @om/api deploy --prod /out

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
EXPOSE 3000
# Run migrations separately (pnpm db:deploy) before starting; the schema and
# migration files ship with the image under prisma/.
CMD ["node", "dist/main.js"]
