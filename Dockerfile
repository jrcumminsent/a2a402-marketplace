# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS source
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

FROM source AS production-dependencies

RUN --mount=type=cache,id=a2a402-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --prod --frozen-lockfile --store-dir=/pnpm/store

FROM source AS build

RUN --mount=type=cache,id=a2a402-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm build

FROM node:24-alpine AS runtime

ARG VERSION=0.1.0
ARG REVISION=unknown

LABEL org.opencontainers.image.title="a2a402.market" \
      org.opencontainers.image.description="Machine-readable Proof-of-Earn marketplace" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV ARTIFACT_STORAGE_MODE=local
ENV ARTIFACT_STORAGE_PATH=/app/data/artifacts
ENV NODE_OPTIONS=--enable-source-maps

WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

RUN mkdir -p /app/data/artifacts \
    && chown -R node:node /app/data

USER node

VOLUME ["/app/data/artifacts"]
EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/apps/api/server.js"]
