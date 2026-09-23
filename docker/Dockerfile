# syntax=docker/dockerfile:1.7
# flowaid images: one file, three targets (compose sets `build.target`):
#
#   docker build -f docker/Dockerfile --target api    -t flowaid/api:local    .
#   docker build -f docker/Dockerfile --target worker -t flowaid/worker:local .
#   docker build -f docker/Dockerfile --target web    -t flowaid/web:local    .
#
# Stages: base (node + pnpm) → deps (pnpm fetch from the lockfile) → build (offline install,
# turbo build of the three apps) → deploy-api / deploy-worker (pruned production trees),
# vendor (packed runtime packages for vendored code export, CODE_EXPORT.md §2) → runtime-base
# (tini, non-root user, OCI labels) → api / worker / web.
#
# The build context is the repository root; .dockerignore keeps `.git`, `node_modules`, build
# output and every `.env*` file except `.env.example` out of it.

ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ARG PNPM_VERSION=12.5.1

# ── base: node + pnpm ─────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV CI=true
RUN npm install -g "pnpm@${PNPM_VERSION}" \
  && pnpm config set store-dir /pnpm/store
WORKDIR /repo

# ── deps: resolve and fetch the whole workspace once (cached by the lockfile) ─────────────
FROM base AS deps
# isolated-vm and argon2 are native modules: build tools are needed for pnpm's allowed builds.
RUN apk add --no-cache python3 make g++
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile

# ── build: install offline from the fetched store, build every app ────────────────────────
FROM deps AS build
# Public URL of the api, inlined into the web client bundle at build time.
ARG NEXT_PUBLIC_FLOWAID_BASE_URL=http://localhost:3000
ENV NEXT_PUBLIC_FLOWAID_BASE_URL=${NEXT_PUBLIC_FLOWAID_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile
# apps/web/next.config.ts sets `output: "standalone"`; api and worker emit dist/main.js.
RUN pnpm turbo run build \
      --filter=@flowaid/api... \
      --filter=@flowaid/worker... \
      --filter=@flowaid/web...

# ── deploy-*: prune to one app's production dependency graph (workspace packages included) ─
FROM build AS deploy-api
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@flowaid/api --prod --legacy deploy /out/api

FROM build AS deploy-worker
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@flowaid/worker --prod --legacy deploy /out/worker

# ── vendor: pack the runtime packages for vendored code export (CODE_EXPORT.md §2) ────────
# The api copies these tarballs into exported zips (FLOWAID_EXPORT_MODE=vendored) and the
# export's tests/vendor-integrity.test.ts checks them against SHA256SUMS. `pnpm pack` needs each
# package's `dist` (built here), and the build fails when a listed package is missing so the
# vendor set can never silently shrink.
FROM build AS vendor
ARG VENDOR_PACKAGES="shared env workflow-core workflow-compiler workflow-runtime node-sdk nodes-core providers provider-typesafe provider-openai provider-anthropic provider-ollama credentials observability mcp openapi-tools sandbox workflow-sdk langchain nodes-langchain"
RUN set -eu; \
    filters=""; for p in ${VENDOR_PACKAGES}; do filters="${filters} --filter=@flowaid/${p}..."; done; \
    pnpm turbo run build ${filters}
RUN set -eu; mkdir -p /out/vendor; \
    for p in ${VENDOR_PACKAGES}; do \
      pnpm --filter "@flowaid/${p}" pack --pack-destination /out/vendor; \
      ls /out/vendor/flowaid-${p}-*.tgz >/dev/null 2>&1 || { echo "vendor: @flowaid/${p} was not packed" >&2; exit 1; }; \
    done; \
    cd /out/vendor && sha256sum *.tgz > SHA256SUMS && cat SHA256SUMS

# ── runtime-base: tini, non-root user, labels; no build tools ─────────────────────────────
FROM ${NODE_IMAGE} AS runtime-base
ARG GIT_SHA=unknown
ARG VERSION=0.0.0-dev
ARG BUILD_DATE=1970-01-01T00:00:00Z
ARG SOURCE_URL=https://github.com/flowaid/flowaid
LABEL org.opencontainers.image.title="flowaid" \
      org.opencontainers.image.description="Open-source, backend-first AI agent and workflow platform" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production
RUN apk add --no-cache tini \
  && addgroup -S flowaid && adduser -S -G flowaid flowaid
ENTRYPOINT ["/sbin/tini", "--"]

# ── api ───────────────────────────────────────────────────────────────────────────────────
FROM runtime-base AS api
ENV HOST=0.0.0.0
ENV PORT=3000
ENV FLOWAID_VENDOR_DIR=/opt/flowaid/vendor
RUN mkdir -p /data && chown flowaid:flowaid /data
WORKDIR /app
COPY --from=deploy-api --chown=flowaid:flowaid /out/api ./
COPY --from=vendor --chown=flowaid:flowaid /out/vendor /opt/flowaid/vendor
USER flowaid
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/v1/health || exit 1
# The api entrypoint applies pending migrations (fail-fast) before it listens.
CMD ["node", "dist/main.js"]

# ── worker: queue consumer, orchestrator, node executors, plugin host ──────────────────────
# The same image serves every pool; WORKER_POOLS selects what a container consumes (compose
# runs one container for the general pools and one, locked down, for `code`).
FROM runtime-base AS worker
ENV WORKER_POOLS=general
RUN apk add --no-cache libstdc++ \
  && mkdir -p /data && chown flowaid:flowaid /data
WORKDIR /app
COPY --from=deploy-worker --chown=flowaid:flowaid /out/worker ./
USER flowaid
VOLUME ["/data"]
# apps/worker/src/health.ts exits 0 while the worker's heartbeat is fresh.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node dist/health.js || exit 1
CMD ["node", "dist/main.js"]

# ── web: Next.js standalone server ────────────────────────────────────────────────────────
FROM runtime-base AS web
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=flowaid:flowaid /repo/apps/web/.next/standalone ./
COPY --from=build --chown=flowaid:flowaid /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=flowaid:flowaid /repo/apps/web/public ./apps/web/public
USER flowaid
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1
CMD ["node", "apps/web/server.js"]
