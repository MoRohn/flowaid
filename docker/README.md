# flowaid Docker stack

`docker compose up` from the repository root starts everything a single-host installation
needs. The root `docker-compose.yml` only includes the files in this directory.

## Services (`compose.yml`)

| Service                 | Image                                     | Port (host, loopback by default) | Role                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres`              | `pgvector/pgvector:0.8.6-pg16@sha256:…`   | 5432                             | The only source of truth: run event log, projections, queue (`queue_jobs`), timers, credentials, pgvector. `postgres-init/01-roles.sql` creates the login roles.                                                                                                 |
| `api`                   | `flowaid/api` (`Dockerfile` target `api`) | 3001                             | Fastify 5: HTTP, SSE, webhooks, MCP server endpoint. Applies migrations at start (as the owner), creates the first owner from `FLOWAID_ADMIN_EMAIL/PASSWORD`. Never executes nodes.                                                                              |
| `worker`                | `flowaid/worker` (target `worker`)        | —                                | Orchestrator and node executors for `general,retrieval,browser,high_memory`, the plugin host process (the bundled LangChain package), the scheduler and the export job. The trusted tier: holds the master key file and every provider key.                      |
| `worker-code`           | same image                                | —                                | Sandbox host for the `code` pool: claims code-node executions the worker delegates and runs them in isolated-vm isolates. No `.env`, no `/data`, no master key, restricted database role `flowaid_code`, read-only root, no capabilities, pid and memory limits. |
| `web`                   | `flowaid/web` (target `web`)              | 3000                             | Next.js 16 app (standalone server). Browsers talk only to it; it forwards `/v1`, `/hooks` and `/mcp` to the api at request time. On the `edge` network alone, it reaches nothing but `api`.                                                                      |
| `rustfs`, `rustfs-init` | `rustfs/rustfs:1.0.0@sha256:…`            | 9000 (`--profile s3`)            | Optional S3-compatible artifact store and a one-shot that creates the bucket. See [Object storage](#object-storage-profile-s3).                                                                                                                                  |

The web app is the address people open, http://localhost:3000 (the same port `pnpm start`
uses); the api is published beside it on 3001. Both containers listen on those same ports
inside (the web container on 3000, the api on 3001, reached as `http://api:3001`), so the
published and in-container numbers agree. `WEB_PORT` and `PORT` in `.env` move only the host
side of each mapping; compose pins the api's in-container `PORT` to 3001. Unlike `pnpm start`,
compose does not move to another port when one is taken: `docker compose up` stops with an
"address already in use" error, and you set `WEB_PORT` or `PORT` in `.env`.

Every image is pinned to a release tag **and** its `sha256` digest (`docker/compose.test.ts`
fails on a floating tag); Dependabot proposes bumps.

Health checks gate `depends_on`: `postgres` (pg_isready) → `api` (`GET /v1/health`) →
`worker`, `worker-code` (`node dist/health.js`, exits 0 while the heartbeat is fresh),
`web` (`GET /`).

Code nodes never run in the trusted worker when `worker-code` is up: the worker records the
execution in `delegated_nodes`, queues it on `run:code`, and the sandbox host claims it through
the `flowaid_delegated_claim` / `flowaid_delegated_complete` functions (the only way
`flowaid_code` reaches workflow data) and hands the result back over the queue. A worker whose
`WORKER_POOLS` includes `code` runs code nodes in process instead (the default outside compose).
On the sandbox host code nodes get `fetch` (with `allowNetwork`) but not the tool and state
bridges, which need the trusted tier.

Named volumes: `postgres-data`, `redis-data` (scale profile) and `flowaid-data`, which holds
the generated master key file (`/data/master.key`), the auto-generated JWT key pair
(`/data/keys`), run artifacts and code-export packages (`/data/artifacts`) and installed
plugins (`/data/plugins`), and is mounted by `api` and `worker` only. Back up `flowaid-data`
and `postgres-data`: without the master key stored credentials cannot be decrypted.
[docs/operations/BACKUP_AND_RESTORE.md](../docs/operations/BACKUP_AND_RESTORE.md) gives the
commands and the restore order; [UPGRADES.md](../docs/operations/UPGRADES.md) and the
[RUNBOOK.md](../docs/operations/RUNBOOK.md) cover upgrades and day-to-day operation.

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
   the restricted `flowaid_code` role's, which `worker-code` connects with. Optional: `POSTGRES_APP_PASSWORD` gives `flowaid_app` (api and worker) its own
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
   `POSTGRES_USER`, `POSTGRES_DB`, the host ports (`POSTGRES_PORT`, `REDIS_PORT`, `WEB_PORT`,
   `RUSTFS_PORT`; the api uses `PORT`), `WORKER_CODE_CONCURRENCY`, `WORKER_REPLICAS`,
   `REDIS_PASSWORD`.

### Who receives what

| Service       | Reads `.env` (`env_file`) | Explicit variables                                                                                                                              |
| ------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`         | yes                       | the shared map above, `HOST`, `PORT`, `CORS_ORIGINS`, `DATABASE_ADMIN_URL`                                                                      |
| `worker`      | yes                       | the shared map above, `WORKER_POOLS`, `WORKER_CONCURRENCY`, `MCP_STDIO_ENABLED`                                                                 |
| `worker-code` | **no**                    | `NODE_ENV`, `LOG_LEVEL`, `DATABASE_URL` (role `flowaid_code`), `DB_RLS`, `REDIS_URL`, `WORKER_POOLS=code`, `WORKER_CONCURRENCY`, `SANDBOX_MODE` |
| `web`         | **no**                    | `NODE_ENV`, `HOSTNAME`, `PORT`, `FLOWAID_API_INTERNAL_URL`, `NEXT_PUBLIC_FLOWAID_BASE_URL`                                                      |

`docker/compose.test.ts` asserts these sets (no `FLOWAID_MASTER_KEY*`, `*_API_KEY` or
`S3_SECRET_KEY` ever reaches `worker-code` or `web`); `scripts/check-compose.test.ts` resolves
the stack with `docker compose config` and feeds every flowaid process's environment to
`loadEnv()`, so compose and the schema cannot drift apart.

### Networks

- `internal` (`internal: true`, no egress): `postgres`, `redis`, `rustfs`, `api`, `worker`,
  `worker-code`. `web` is not on it.
- `edge`: `api`, `web`, `worker`, `worker-code` — the published api/web ports and outbound
  access (providers, webhooks, MCP servers, `allowNetwork` code nodes). Remove `worker-code`
  from `edge` for a sandbox host without egress; `code` nodes then cannot `fetch`.
- `admin`: `postgres`, `redis`, `rustfs` — publishes the databases on `BIND_ADDRESS` for local
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

## Object storage (profile `s3`)

Without S3 settings, artifacts and code-export packages live in `flowaid-data`
(`/data/artifacts`). With `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` all set
in `.env`, the worker writes them to the bucket and the api streams downloads from it (the
bucket need not be reachable from browsers; artifacts written locally before stay readable).
Any S3-compatible store works; the `s3` profile bundles one:

```sh
# .env
S3_ENDPOINT=http://rustfs:9000
S3_BUCKET=flowaid
S3_ACCESS_KEY=flowaid
S3_SECRET_KEY=<openssl rand -hex 16>

docker compose --profile s3 up -d
```

`rustfs` keeps its objects in the `s3-data` volume and publishes the S3 port on
`${BIND_ADDRESS}:${RUSTFS_PORT}` (default `127.0.0.1:9000`); `rustfs-init` creates the bucket
with a signed `PUT` and exits. `rustfs` refuses to start with an empty `S3_SECRET_KEY`.

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

## Published images (`compose.images.yml`)

Every release publishes the three targets for `linux/amd64` and `linux/arm64` as
`ghcr.io/morohn/flowaid-api`, `-worker` and `-web`, tagged with the version, with SBOMs and
signed build provenance ([docs/operations/RELEASING.md](../docs/operations/RELEASING.md)). To run a release instead of
building from source, add the overlay, which changes only where the app images come from:

```sh
# .env
FLOWAID_IMAGE_TAG=0.4.0            # optionally 0.4.0@sha256:<digest>
# FLOWAID_IMAGE_REGISTRY=ghcr.io/morohn

docker compose -f docker/compose.yml -f docker/compose.images.yml up -d
# with the scale profile:
docker compose -f docker/compose.yml -f docker/compose.scale.yml -f docker/compose.images.yml \
  --profile scale up -d
```

`docker/compose.test.ts` checks that the overlay touches nothing but `image` and `pull_policy`.
Upgrading is a new `FLOWAID_IMAGE_TAG` and `up -d`: the api applies pending migrations before
it listens. Back up first and stop the workers; [UPGRADES.md](../docs/operations/UPGRADES.md)
has the steps and the rollback.
