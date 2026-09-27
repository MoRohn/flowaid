# flowaid Docker stack

`docker compose up` from the repository root starts everything a single-host installation
needs. The root `docker-compose.yml` only includes the files in this directory.

## Services (`compose.yml`)

| Service    | Image                                     | Port (host, loopback by default) | Role                                                                                                                                                                                                     |
| ---------- | ----------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `pgvector/pgvector:0.8.6-pg16@sha256:…`   | 5432                             | The only source of truth: run event log, projections, queue (`queue_jobs`), timers, credentials, pgvector. `postgres-init/01-roles.sql` creates the login roles.                                         |
| `api`      | `flowaid/api` (`Dockerfile` target `api`) | 3000                             | Fastify 5: HTTP, SSE, webhooks, MCP server endpoint. Applies migrations at start (as the owner), creates the first owner from `FLOWAID_ADMIN_EMAIL/PASSWORD`. Never executes nodes.                      |
| `worker`   | `flowaid/worker` (target `worker`)        | —                                | Orchestrator and node executors, code nodes in isolated-vm isolates, the bundled LangChain plugin, the scheduler and the export job. The trusted tier: holds the master key file and every provider key. |
| `web`      | `flowaid/web` (target `web`)              | 3001                             | Next.js 16 app (standalone server). Browsers talk only to it; it forwards `/v1`, `/hooks` and `/mcp` to the api at request time. On the `edge` network alone, it reaches nothing but `api`.              |

Every image is pinned to a release tag **and** its `sha256` digest (`docker/compose.test.ts`
fails on a floating tag); renovate proposes bumps.

Health checks gate `depends_on`: `postgres` (pg_isready) → `api` (`GET /v1/health`) →
`worker` (`node dist/health.js`, exits 0 while the heartbeat is fresh), `web` (`GET /`).

Named volumes: `postgres-data`, `redis-data` (scale profile) and `flowaid-data`, which holds
the generated master key file (`/data/master.key`), the auto-generated JWT key pair
(`/data/keys`), run artifacts and code-export packages (`/data/artifacts`) and installed
plugins (`/data/plugins`), and is mounted by `api` and `worker` only. Back up `flowaid-data`
and `postgres-data`: without the master key stored credentials cannot be decrypted.

## Configuration

1. `cp .env.example .env` at the repository root and edit it (every variable is documented
   in `packages/env/README.md`, including which file is read where).
2. Generate the passwords the stack refuses to start without — they have no defaults:

   ```sh
   for v in POSTGRES_PASSWORD POSTGRES_CODE_PASSWORD; do
     sed -i.bak "s/^$v=$/$v=$(openssl rand -hex 16)/" .env
   done
   ```

   `POSTGRES_PASSWORD` is the owner's (`POSTGRES_USER`) password and `POSTGRES_CODE_PASSWORD`
   the restricted `flowaid_code` role's (created for the sandboxed code pool; migrations grant
   to it). Optional: `POSTGRES_APP_PASSWORD` gives `flowaid_app` (api and worker) its own
   password.

3. Values that must differ inside the compose network are pinned per service in
   `compose.yml` and override `.env`: `DATABASE_URL` (role `flowaid_app`, host `postgres`),
   `DATABASE_ADMIN_URL` (api only, the owner), `DB_RLS=true`, `FLOWAID_MASTER_KEY_FILE`,
   `FLOWAID_JWT_KEYS_DIR`,
   `FLOWAID_PLUGIN_DIR`, `FLOWAID_VENDOR_DIR`, `HOST`, `PORT`. `FLOWAID_MASTER_KEY` from `.env`
   is passed through and takes precedence over the key file when set.
4. Compose-only variables (documented in the last section of `packages/env/README.md`):
   `BIND_ADDRESS` (host interface of every published port, `127.0.0.1` by default;
   `0.0.0.0` publishes on every interface, which you want only behind a TLS reverse proxy),
   `POSTGRES_USER`, `POSTGRES_DB`, the host ports (`POSTGRES_PORT`, `REDIS_PORT`, `WEB_PORT`;
   the api uses `PORT`), `WORKER_REPLICAS`, `REDIS_PASSWORD`.

### Who receives what

| Service  | Reads `.env` (`env_file`) | Explicit variables                                                                         |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| `api`    | yes                       | the shared map above, `HOST`, `PORT`, `CORS_ORIGINS`, `DATABASE_ADMIN_URL`                 |
| `worker` | yes                       | the shared map above, `WORKER_POOLS`, `WORKER_CONCURRENCY`, `MCP_STDIO_ENABLED`            |
| `web`    | **no**                    | `NODE_ENV`, `HOSTNAME`, `PORT`, `FLOWAID_API_INTERNAL_URL`, `NEXT_PUBLIC_FLOWAID_BASE_URL` |

`docker/compose.test.ts` asserts these sets (no `FLOWAID_MASTER_KEY*`, `*_API_KEY` or
`S3_SECRET_KEY` ever reaches `web`); `scripts/check-compose.test.ts` resolves
the stack with `docker compose config` and feeds every flowaid process's environment to
`loadEnv()`, so compose and the schema cannot drift apart.

### Networks

- `internal` (`internal: true`, no egress): `postgres`, `redis`, `api`, `worker`. `web` is not
  on it.
- `edge`: `api`, `web`, `worker` — the published api/web ports and outbound access (providers,
  webhooks, MCP servers, `allowNetwork` code nodes).
- `admin`: `postgres`, `redis` — publishes the databases on `BIND_ADDRESS` for local
  development and administration (published ports do not work on an internal-only network).

## Scaling (`compose.scale.yml`, profile `scale`)

```sh
# .env
REDIS_PASSWORD=<openssl rand -hex 16>
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
WORKER_REPLICAS=3

docker compose --profile scale up -d
```

Adds Redis 7 (`--requirepass`; the container refuses to start without `REDIS_PASSWORD`) and
runs `WORKER_REPLICAS` workers. With `REDIS_URL` set the api and workers switch to the BullMQ
queue driver and Redis pub/sub event bus; timers stay authoritative in Postgres, so semantics
are identical with and without Redis (ARCHITECTURE.md §5.11). Without the profile the file is
inert (`WORKER_REPLICAS` defaults to 1, `REDIS_URL` empty, `REDIS_PASSWORD` unused).

## Images (`Dockerfile`)

One multi-stage `node:24-alpine` Dockerfile (pinned by digest, `ARG NODE_IMAGE`) with three
targets; compose selects them with `build.target`:

1. `base`: `npm install -g pnpm@${PNPM_VERSION}` (`ARG PNPM_VERSION=12.5.1`).
2. `deps`: `pnpm fetch` from the lockfile alone (cached until it changes).
3. `build`: `pnpm install --offline`, `turbo run build` for the three apps. Workspace packages
   export their compiled `dist` by default, so the pruned trees run with plain `node`.
4. `deploy-api` / `deploy-worker`: `pnpm deploy --prod` (pruned production trees).
5. `vendor`: `pnpm --filter @flowaid/<package> pack` for every runtime package plus
   `SHA256SUMS`, copied into the api image at `/opt/flowaid/vendor` (`FLOWAID_VENDOR_DIR`) for
   vendored code export (CODE_EXPORT.md §2). The build fails when a listed package is missing.
6. `api`, `worker`, `web`: non-root `flowaid` user, `tini` as PID 1, health check, no build
   tools, OCI labels from the build args `GIT_SHA`, `VERSION`, `BUILD_DATE`, `SOURCE_URL`.

The worker image compiles the native `isolated-vm` and `argon2` modules (allowed in
`pnpm-workspace.yaml` `allowBuilds`). The api image carries no sandbox dependency.

`.dockerignore` keeps `.git`, `node_modules`, build output, `docs/` and every `.env*` file
except `.env.example` out of the build context; `scripts/check-dockerignore.test.ts` fails when
a secret pattern from `.gitignore` is missing and `scripts/check-compose.test.ts` exports the
context to prove it.

Build explicitly with `docker compose build`, or one target at a time:

```sh
docker build -f docker/Dockerfile --target api -t flowaid/api:local \
  --build-arg GIT_SHA=$(git rev-parse HEAD) --build-arg VERSION=0.1.0 .
```

The three images are built from `apps/api`, `apps/worker` and `apps/web`: `dist/main.js`
(api, worker), `dist/health.js` (worker) and Next's `output: "standalone"` server (web). The
release gate (`.github/workflows/e2e.yml`) drives the acceptance journey against the same
production builds.
