# Order Management web image (private network deployment).
# NOTE: image builds are exercised at the deployment milestone.

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @om/web --filter @om/shared

# The generated API client is built from the committed contract snapshot.
COPY packages/shared packages/shared
COPY apps/api/openapi.json apps/api/openapi.json
COPY apps/web apps/web
RUN pnpm --filter @om/shared build \
  && pnpm --filter @om/web generate:client \
  && pnpm --filter @om/web build

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
