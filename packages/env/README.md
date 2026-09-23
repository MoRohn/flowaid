# @flowaid/env

Typed runtime configuration for flowaid. This is the **only** package that reads
`process.env`; every other package receives configuration as values.

```ts
import { loadEnv } from "@flowaid/env";

const env = loadEnv(); // throws EnvError listing every missing/invalid variable
env.PORT; // number
env.WORKER_POOLS; // ("general" | "code" | ...)[]
env.flags.hasRedis; // boolean
```

## API

| Export | Purpose |
|---|---|
| `EnvSchema` | Zod 4 object schema of every variable (input: raw strings, output: typed values). |
| `loadEnv(source = process.env): Env` | Parses and validates. Empty strings count as unset. Throws `EnvError`. |
| `safeLoadEnv(source): Result<Env, EnvError>` | Same without throwing (`Result` from `@flowaid/shared`). |
| `Env` | `Readonly<EnvVars> & { flags: EnvFlags; secretRefs; toJSON }`, frozen. `JSON.stringify(env)` yields `redactEnv(env)`, so an accidental serialisation never prints a secret. |
| `env.secretRefs` | Values of every `FLOWAID_SECRET_<NAME>` variable, keyed by full name (the `env:` credential store, ARCHITECTURE.md §10.6). |
| `EnvError` | `message` lists every problem on its own line; `issues: EnvIssue[]` is the structured form. Secret values are never echoed. |
| `deriveFlags(vars)` | Computes `EnvFlags` from parsed variables. |
| `redactEnv(env)` | `Record<string, string>` of every set variable in schema order with secret values replaced by `<set>`. Safe to log. |
| `secretEnvValues(env)` | Every secret value (documented secrets, the password part of secret URLs, `secretRefs`) for a `Redactor` to learn. |
| `SECRET_ENV_KEYS`, `ENV_SCHEMA_KEYS`, `ENV_PARSED_VAR_NAMES` | Names of the secret variables; the schema fields in order; the documented names the schema parses. |
| `FEATURE_KEYS`, `EXPORT_MODES`, `PROVIDER_FIXTURE_MODES`, `ADMIN_PASSWORD_DENY_LIST` | Closed value sets used by the schema (`FEATURE_KEYS` mirrors `FeatureKeySchema` in API.md §7). |
| `crossFieldIssues(vars)`, `isLoopbackHost()`, `siteOf()` | The cross-variable and production rules, and the helpers they use, for reuse in the api. |
| `ENV_VAR_DOCS`, `ENV_VAR_NAMES`, `envVarDoc()`, `isDocumentedEnvName()` | The documentation table below, as data. |
| `renderEnvExample()`, `renderReadmeTable()` | Generators used by `pnpm env:example`. |

### Feature flags (`env.flags`)

| Flag | True when |
|---|---|
| `isProduction` / `isDevelopment` / `isTest` | `NODE_ENV` is that value. |
| `hasRedis` | `REDIS_URL` is set → BullMQ queues, Redis event bus, shared rate limits. Otherwise the Postgres queue driver is used. |
| `hasS3` | All of `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` are set. |
| `hasTypeSafe` | `TYPESAFE_API_KEY` is set. |
| `hasOpenAI` / `hasAnthropic` / `hasOllama` | The provider's variable is set. |
| `hasGenerationProvider` | Any of the three above. |
| `hasOtel` | `OTEL_EXPORTER_OTLP_ENDPOINT` is set. |
| `hasPrometheus` | `PROMETHEUS_PORT` is set. |
| `hasJwtKeys` | Both `FLOWAID_JWT_PRIVATE_KEY` and `FLOWAID_JWT_PUBLIC_KEY` are set (otherwise a pair is generated under `FLOWAID_JWT_KEYS_DIR`). |
| `hasMasterKeyInEnv` | `FLOWAID_MASTER_KEY` is set (otherwise the key file is used). |
| `masterKeyAutogenerate` | The file provider may create a missing `FLOWAID_MASTER_KEY_FILE`: always outside production, in production only with `FLOWAID_MASTER_KEY_AUTOGENERATE=true`. |
| `hasAdminBootstrap` | `FLOWAID_ADMIN_EMAIL` and `FLOWAID_ADMIN_PASSWORD` are set. |
| `hasOidc` | `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are set (`features.oidc`). |
| `hasDatabaseAdminUrl` | `DATABASE_ADMIN_URL` is set: migrations use the owner connection. |
| `providerFixturesEnabled` | `FLOWAID_PROVIDER_FIXTURES` is `record` or `replay`. |
| `mcpStdioEnabled` | `MCP_STDIO_ENABLED` is true. |
| `sandboxIsContainer` | `SANDBOX_MODE` is `container`. |

### Cross-variable rules

* `FLOWAID_JWT_PRIVATE_KEY` and `FLOWAID_JWT_PUBLIC_KEY` must be set together.
* `FLOWAID_ADMIN_EMAIL` and `FLOWAID_ADMIN_PASSWORD` must be set together.
* The four `S3_*` connection variables are all-or-nothing.
* `FLOWAID_MASTER_KEY` takes precedence over `FLOWAID_MASTER_KEY_FILE`; both may be set (the compose stack always sets the file path and passes the variable through when present) and the file is then ignored.
* `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are all-or-nothing; `OIDC_ROLE_CLAIM` needs them.
* `PROMETHEUS_PORT` must differ from `PORT`.
* `FLOWAID_ADMIN_PASSWORD` is 12 to 256 characters.

### Production rules

With `NODE_ENV=production` (the compose default) `loadEnv` additionally refuses, each with
its documented override, so a first deploy cannot run an unsafe configuration by accident:

| Refused | Override |
|---|---|
| `CORS_ORIGINS` containing `*` | none: list the web app's origin |
| `http:` `FLOWAID_BASE_URL`, `FLOWAID_WEB_URL` or `OIDC_ISSUER` on a non-loopback host | `FLOWAID_ALLOW_INSECURE_HTTP=true` |
| `FLOWAID_ADMIN_PASSWORD` equal to its documented example or quick-start value, or in `ADMIN_PASSWORD_DENY_LIST` | none: choose a real password |
| No `FLOWAID_JWT_PRIVATE_KEY`/`FLOWAID_JWT_PUBLIC_KEY` | `FLOWAID_JWT_KEYS_DIR` set explicitly (a persistent directory shared by every api replica) |
| No `FLOWAID_MASTER_KEY` and `FLOWAID_MASTER_KEY_FILE` at its default | `FLOWAID_MASTER_KEY_FILE` set explicitly, or `FLOWAID_MASTER_KEY_AUTOGENERATE=true` to create it on first boot |
| `FLOWAID_MASTER_KEY` or an explicit `FLOWAID_MASTER_KEY_FILE` on a worker with `WORKER_POOLS=code` only (the sandbox host, compose `worker-code`, never holds a master key; it is also exempt from the two key requirements above) | none: give the sandbox host no key |
| A `CORS_ORIGINS` entry cross-site with `FLOWAID_BASE_URL` (different scheme or registrable domain, approximated as the last two host labels) | `FLOWAID_ALLOW_CROSS_SITE=true` |

"Set explicitly" means a value other than the documented default. The rules run on the raw
source as well as on parsed values, so they are reported together with per-variable errors.

### Secrets

Variables marked *Secret* below (`SECRET_ENV_KEYS`) and every `FLOWAID_SECRET_<NAME>` are
never echoed in `EnvError`, are replaced by `<set>` in `redactEnv(env)` / `JSON.stringify(env)`
and are handed to the worker's `Redactor` through `secretEnvValues(env)`. Any variable whose
name starts with `FLOWAID_SECRET_` must match `FLOWAID_SECRET_[A-Z0-9_]+`; it is collected into
`env.secretRefs` and is the only kind of variable an `env:` credential reference may name.

Booleans accept `true/false`, `1/0`, `yes/no`, `on/off` (case-insensitive). Lists are
comma-separated. PEM keys may be written on one line with `\n` for newlines.

## Which file is read where

* `docker compose` (from the repository root) reads **`.env`** next to `docker-compose.yml`:
  it interpolates `${...}` references in `docker/compose*.yml` (including the compose-only
  variables of the last table: passwords, `BIND_ADDRESS`, host ports) and hands the whole file
  to `api` and `worker` through `env_file`. `web` and the sandbox host `worker-code` receive
  only the explicit variables listed in `docker/compose.yml`. Values pinned per service there
  (`DATABASE_URL`, `S3_ENDPOINT`, the `/data` paths, `HOST`) override the file.
* Local development (`pnpm dev`, `node --env-file=.env ...`) reads the same **`.env`** without
  interpolation: reference the compose Postgres as
  `DATABASE_URL=postgres://flowaid:<POSTGRES_PASSWORD>@localhost:5432/flowaid` (or a local
  database) and, to use the compose MinIO, set all four `S3_*` variables (`S3_SECRET_KEY` is the
  MinIO root password). Compose-only variables are ignored by `loadEnv`.
* **`.env.example`** is generated and checked in; it is the only `.env*` file that reaches the
  Docker build context (`.dockerignore`). **`.env.local`** and every other `.env.*` file are
  read by nothing and never leave the machine.
* Inside the images `loadEnv()` reads the container environment; nothing reads a file.

## Variables

The table below and the repository's `.env.example` are generated from
`src/docs.ts` by `pnpm env:example`; `src/docs.test.ts` fails when they are stale. Variables
whose *Required* column says `compose` have no default in the compose stack: `.env.example`
lists them empty for you to generate (`openssl rand -hex 16`).

<!-- env-table:start -->

### Core service settings

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | no | `development` | Runtime mode. `production` disables development conveniences such as auto-generated dev keys and verbose errors. Values: `development`, `test`, `production`. |
| `LOG_LEVEL` | no | `info` | Minimum pino log level emitted by the api and worker processes. Values: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `HOST` | no | `127.0.0.1` | Interface the api listens on. The default binds loopback only; the api image and the compose stack set `0.0.0.0` so the container port can be published. |
| `PORT` | no | `3000` | TCP port of the api (HTTP, SSE, webhooks, MCP endpoint). |
| `FLOWAID_BASE_URL` | no | `http://localhost:3000` | Public URL of the api as seen by browsers, webhook callers and MCP clients. Used to build external review links, webhook URLs and the OpenAPI `servers` entry. In production it must be `https:` unless the host is loopback or `FLOWAID_ALLOW_INSECURE_HTTP=true`. |
| `FLOWAID_WEB_URL` | no | `http://localhost:3001` | Public URL of the web app. Used for deep links in notifications and as the default CORS origin. Same production rule as `FLOWAID_BASE_URL`. |
| `CORS_ORIGINS` | no | `http://localhost:3001` | Comma-separated list of browser origins allowed to call the api with credentials. `*` reflects every request origin and is rejected in production, as is an origin cross-site with `FLOWAID_BASE_URL` unless `FLOWAID_ALLOW_CROSS_SITE=true`. |
| `RATE_LIMIT_MAX` | no | `600` | Requests per minute allowed per session principal (api keys get double, webhooks half; API.md §1). Stored in Redis when `REDIS_URL` is set, otherwise in memory per api replica. |
| `FLOWAID_API_INTERNAL_URL` | no | — | URL the web app's server side uses to reach the api over the deployment's private network (compose: `http://api:3000`). Unset means `FLOWAID_BASE_URL`. Example: `http://api:3000`. |
| `FLOWAID_TRUST_PROXY` | no | `false` | Reverse proxies whose `X-Forwarded-*` headers are trusted (Fastify `trustProxy`): `false` trusts none, `true` trusts every hop (only when the api is not reachable directly), or a comma-separated list of IPs, CIDRs or the names `loopback`, `linklocal`, `uniquelocal`. Client IPs feed rate limits and audit logs. |
| `FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL` | no | `20` | Maximum concurrent SSE streams (run events, evaluations) one principal may hold open; the next one is refused with 429 `RATE_LIMIT_ERROR`. The per-workspace cap is ten times this value. |
| `FLOWAID_FEATURES_DISABLED` | no | — | Comma-separated feature keys (`FeatureKey`, API.md §7) the operator turns off: `GET /v1/me` reports them as false and the web app hides their navigation. Unset disables nothing. Values: `workflows`, `runs`, `human_tasks`, `templates`, `integrations_mcp`, `integrations_openapi`, `integrations_providers`, `integrations_plugins`, `knowledge`, `evaluations`, `credentials`, `settings_audit`, `settings_notifications`, `agents`, `ai_builder`, `advisor`, `code_export`, `langchain`, `oidc`, `schedules`, `mcp_exposures`. Example: `agents,ai_builder`. |

### Database (PostgreSQL 16 + pgvector)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL 16 connection string (postgres.js format). The database must have the `vector` extension available; migrations are applied by the api entrypoint and `flowaid db migrate`. Example: `postgres://flowaid:flowaid@localhost:5432/flowaid`. Secret. |
| `DB_RLS` | no | `false` | Enable the row-level-security policies on every tenant table (DATABASE.md, migration 0002). The api then runs `SET LOCAL app.workspace_id` per transaction. |
| `RUN_EVENTS_PARTITIONED` | no | `false` | Convert `run_events` to monthly range partitions (migration 0003) and let the sweep job pre-create partitions. Irreversible once applied. |
| `DATABASE_ADMIN_URL` | no | — | Connection string of the schema owner, used only to run migrations (api entrypoint, `flowaid db migrate`) while `DATABASE_URL` connects as the restricted `flowaid_app` role under `DB_RLS=true`. Unset means migrations run over `DATABASE_URL`. Example: `postgres://postgres:postgres@localhost:5432/flowaid`. Secret. |
| `RETENTION_SWEEP_CRON` | no | `0 3 * * *` | Five-field cron schedule of the `retention.sweep` maintenance job that applies workspace retention policies, pre-creates `run_events` partitions and garbage-collects draft versions (DATABASE.md, RFC-0001). |

### Queue and workers

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | no | — | Redis 7 connection string. When set, jobs use BullMQ, the event bus uses Redis pub/sub and rate limits are shared across api replicas. When unset, everything runs over Postgres (`SKIP LOCKED` + `LISTEN/NOTIFY`) with identical semantics (ARCHITECTURE.md D10). Example: `redis://localhost:6379`. Secret. |
| `WORKER_POOLS` | no | `general` | Comma-separated worker pools this worker process consumes. A run's orchestration always happens on `general`; nodes declaring another pool are delegated to a worker that serves it. Values: `general`, `code`, `browser`, `gpu`, `retrieval`, `high_memory`. |
| `WORKER_CONCURRENCY` | no | `10` | Maximum number of jobs one worker process executes concurrently across its pools. |
| `FLOWAID_QUEUE_UI` | no | `false` | Mount Bull Board at `/admin/queues` (BullMQ driver only) behind session auth with the `admin` scope. Off by default because job payloads show run inputs. |

### Security and first boot

| Variable | Required | Default | Description |
|---|---|---|---|
| `FLOWAID_MASTER_KEY` | no | — | Master key that wraps the credential key-encryption keys (`MasterKeyProvider` `env`): 32 random bytes encoded as base64 (44 characters) or hex (64 characters). Generate with `openssl rand -base64 32`. When both are set it takes precedence over `FLOWAID_MASTER_KEY_FILE`, which is then ignored (the compose stack always sets the file path). Example: `<openssl rand -base64 32>`. Secret. |
| `FLOWAID_MASTER_KEY_FILE` | no | `.flowaid/master.key` | Path of the master key file used when `FLOWAID_MASTER_KEY` is not set (`MasterKeyProvider` `file`). Created with mode 0600 on first boot, with a loud warning, when it does not exist; in production only when `FLOWAID_MASTER_KEY_AUTOGENERATE=true`, and production requires either `FLOWAID_MASTER_KEY` or an explicit path here. Back this file up: without it stored credentials cannot be decrypted. |
| `FLOWAID_JWT_PRIVATE_KEY` | no | — | ES256 (P-256) private key in PEM format used to sign session JWTs. Newlines may be written as `\n`. Must be set together with `FLOWAID_JWT_PUBLIC_KEY`; when both are absent a key pair is generated under `FLOWAID_JWT_KEYS_DIR`, which production accepts only when that directory is set explicitly. Example: `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----`. Secret. |
| `FLOWAID_JWT_PUBLIC_KEY` | no | — | ES256 public key in PEM format matching `FLOWAID_JWT_PRIVATE_KEY`. Published at `/.well-known/jwks.json` so other services can verify session tokens. Example: `-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----`. |
| `FLOWAID_JWT_KEYS_DIR` | no | `.flowaid/keys` | Directory where the api stores an auto-generated ES256 key pair (`jwt.key`, `jwt.pub`) when no explicit keys are configured. Every api replica must share it or sessions will not verify across replicas. |
| `FLOWAID_ADMIN_EMAIL` | no | — | Email of the owner account created on first boot together with the default workspace and the `dev`/`staging`/`prod` environments. Ignored once any user exists. Must be set together with `FLOWAID_ADMIN_PASSWORD`. Example: `admin@example.com`. Quick start: `admin@flowaid.local`. |
| `FLOWAID_ADMIN_PASSWORD` | no | — | Password of the first-boot owner account (12 to 256 characters). Change it after the first login. Production rejects the documented values and a short list of common passwords. Example: `change-me-please`. Quick start: `flowaid-local-admin`. Secret. |
| `FLOWAID_ALLOW_INSECURE_HTTP` | no | `false` | Allow `http:` values of `FLOWAID_BASE_URL`/`FLOWAID_WEB_URL` on non-loopback hosts in production and drop the `Secure` flag from session cookies. Only for isolated lab deployments without TLS. |
| `FLOWAID_ALLOW_CROSS_SITE` | no | `false` | Accept `CORS_ORIGINS` entries that are cross-site with `FLOWAID_BASE_URL` in production. Session cookies are `SameSite`, so a cross-site web app cannot log in; enable only for browser clients that authenticate with api keys. |
| `FLOWAID_MASTER_KEY_AUTOGENERATE` | no | `false` | Let a production api create a missing `FLOWAID_MASTER_KEY_FILE` on first boot (with a loud warning). Outside production the file is always created. Prefer setting `FLOWAID_MASTER_KEY` or pointing `FLOWAID_MASTER_KEY_FILE` at a backed-up key. |
| `FLOWAID_SECRET_<NAME>` | no | — | Family of variables, not a setting: credentials with `storage: external` and `externalRef` `env:FLOWAID_SECRET_<NAME>` resolve their value from the matching variable at use time (ARCHITECTURE.md §10.6). Every variable whose name matches `FLOWAID_SECRET_[A-Z0-9_]+` is collected into `env.secretRefs`; no other variable is ever resolvable this way. Example: `<value>`. Secret. A family of variables, not a setting. |

### Single sign-on (OIDC)

| Variable | Required | Default | Description |
|---|---|---|---|
| `OIDC_ISSUER` | no | — | Issuer URL of the OpenID Connect provider (`/.well-known/openid-configuration` is discovered from it). Setting it enables `features.oidc` and the `/v1/auth/oidc/*` routes; `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are then required. Must be `https:` in production unless `FLOWAID_ALLOW_INSECURE_HTTP=true`. Example: `https://login.example.com/realms/flowaid`. |
| `OIDC_CLIENT_ID` | no | — | Client id registered with the OIDC provider for the flowaid web app. Example: `flowaid`. |
| `OIDC_CLIENT_SECRET` | no | — | Client secret matching `OIDC_CLIENT_ID`, used for the authorization-code exchange (with PKCE). Example: `<client secret>`. Secret. |
| `OIDC_ROLE_CLAIM` | no | — | ID-token claim whose value (`owner`, `admin`, `editor` or `viewer`, or a list containing one) sets the workspace role on every OIDC login. Unset keeps roles managed in flowaid; new SSO users join as `viewer`. Example: `flowaid_role`. |

### Execution, sandbox and plugins

| Variable | Required | Default | Description |
|---|---|---|---|
| `SANDBOX_MODE` | no | `isolated-vm` | Executor for the `code` pool: `isolated-vm` runs JavaScript in an in-process isolate; `container` runs each execution in a locked-down container and is the only host for `flowaid.tools.shell` (ARCHITECTURE.md §10.7). Values: `isolated-vm`, `container`. |
| `MCP_STDIO_ENABLED` | no | `false` | Allow MCP servers with the `stdio` transport to be spawned by the worker (after `validateStdioConfig`). Off by default because a stdio server is an arbitrary local process. |
| `FLOWAID_PLUGIN_DIR` | no | `.flowaid/plugins` | Directory where `flowaid plugin add` installs node packages and from which the worker loads enabled plugins at boot. |
| `FLOWAID_BUNDLED_PLUGINS` | no | `@flowaid/nodes-langchain` | Comma-separated node packages shipped inside the worker image that are registered as `source: bundled` plugins at boot without an install step (ARCHITECTURE.md §3.5). Turn one off with `FLOWAID_FEATURES_DISABLED` or by disabling its `plugins` row. |
| `FLOWAID_PLUGIN_ALLOW_LOCAL` | no | `false` | Accept `source: local` plugin installs (a directory on the worker host) through `flowaid plugin add` and `POST /v1/plugins`. Off by default: local code skips the registry integrity check. |
| `FLOWAID_MCP_STDIO_ALLOWED_COMMANDS` | no | — | Comma-separated absolute paths of the executables a stdio MCP server may run when `MCP_STDIO_ENABLED=true`, each optionally followed by `=<regex>` that the space-joined arguments must match (a regex may not contain a comma). Unset allows no command. Example: `/usr/local/bin/mcp-filesystem=^/srv/data(/\|$),/usr/local/bin/mcp-git`. |
| `FLOWAID_MCP_STDIO_ENV_ALLOWLIST` | no | — | Comma-separated names of worker environment variables a stdio MCP server process may inherit; the bound credential's fields are always passed. Unset passes nothing. Example: `PATH,HOME,LANG`. |
| `FLOWAID_EXPORT_MODE` | no | `vendored` | How exported code depends on the runtime packages (CODE_EXPORT.md §2): `npm` references the published `@flowaid/*` packages; `vendored` ships the `.tgz` files from `FLOWAID_VENDOR_DIR` inside the zip. Values: `npm`, `vendored`. |
| `FLOWAID_VENDOR_DIR` | no | `/opt/flowaid/vendor` | Directory of the packed runtime packages (`*.tgz` and `SHA256SUMS`, built by the `vendor` stage of `docker/Dockerfile`) that vendored exports copy. When it is missing, `features.code_export` is false. |

### Object storage (S3-compatible)

| Variable | Required | Default | Description |
|---|---|---|---|
| `S3_ENDPOINT` | no | — | S3-compatible endpoint for artifacts and uploads (MinIO in the default compose stack). Set all of `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` to enable object storage; when none are set artifacts are stored inline in Postgres up to the size limit. Example: `http://localhost:9000`. |
| `S3_BUCKET` | no | — | Bucket that holds artifacts, prefixed `ws/<workspaceId>/`. Example: `flowaid`. |
| `S3_ACCESS_KEY` | no | — | Access key id for the S3 endpoint. Example: `flowaid`. Secret. |
| `S3_SECRET_KEY` | compose | — | Secret access key for the S3 endpoint. The compose stack requires it: it is the MinIO root password and has no default. Generate with `openssl rand -hex 16`. Example: `<openssl rand -hex 16>`. Secret. |
| `S3_REGION` | no | `us-east-1` | Region sent with signed requests. MinIO accepts any value. |
| `S3_FORCE_PATH_STYLE` | no | `true` | Use path-style bucket addressing (`endpoint/bucket/key`). Required for MinIO; set to `false` for AWS S3. |

### AI providers

| Variable | Required | Default | Description |
|---|---|---|---|
| `TYPESAFE_API_KEY` | no | — | TypeSafe AI System One API key (https://api.typesafe.ai). Enables the `TypeSafeDecisionProvider`; without it decisions fall back to the LLM adapter over a configured generation provider. Example: `ts_...`. Secret. |
| `OPENAI_API_KEY` | no | — | OpenAI API key for generation and embeddings (`@flowaid/provider-openai`). Example: `sk-...`. Secret. |
| `ANTHROPIC_API_KEY` | no | — | Anthropic API key for the Messages API (`@flowaid/provider-anthropic`). Example: `sk-ant-...`. Secret. |
| `OLLAMA_HOST` | no | — | Base URL of a local Ollama server (`@flowaid/provider-ollama`). Unset disables the provider. Example: `http://localhost:11434`. |
| `FLOWAID_PROVIDER_FIXTURES` | no | `off` | Deterministic provider calls for tests: `record` writes every TypeSafe and LLM request and response to `FLOWAID_PROVIDER_FIXTURES_DIR`, keyed by provider, model and the request hash; `replay` serves them and fails on a miss; `off` calls the providers. Values: `off`, `record`, `replay`. |
| `FLOWAID_PROVIDER_FIXTURES_DIR` | no | `fixtures/providers` | Directory of the recorded provider fixtures (`*.json`) read in `replay` mode and written in `record` mode. |

### Observability

| Variable | Required | Default | Description |
|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | OTLP/HTTP endpoint for traces and metrics. Unset disables the OpenTelemetry exporter (spans are still created for logs). Example: `http://localhost:4318`. |
| `PROMETHEUS_PORT` | no | — | Port of the internal Prometheus `/metrics` listener in the api and worker. Unset disables it. Example: `9464`. |

### Docker Compose stack (read by docker compose, not by the api)

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | no | `flowaid` | Name of the PostgreSQL superuser that owns the schema (compose `postgres` service). The api runs migrations as it through `DATABASE_ADMIN_URL`; api and worker connect as `flowaid_app`. Compose only: not read by the api. |
| `POSTGRES_PASSWORD` | compose | — | Password of `POSTGRES_USER`. Required by the compose stack, which has no default password. Generate with `openssl rand -hex 16`. Example: `<openssl rand -hex 16>`. Secret. Compose only: not read by the api. |
| `POSTGRES_DB` | no | `flowaid` | Name of the database the compose stack creates and connects to. Compose only: not read by the api. |
| `POSTGRES_APP_PASSWORD` | no | — | Password of the `flowaid_app` role that api and worker connect with (created by `docker/postgres-init/01-roles.sql` on the first start). Unset means `POSTGRES_PASSWORD`; set it to keep the owner's password out of the worker. Example: `<openssl rand -hex 16>`. Secret. Compose only: not read by the api. |
| `POSTGRES_CODE_PASSWORD` | compose | — | Password of the `flowaid_code` role the sandbox host `worker-code` connects with (queue tables only). Required by the compose stack and must differ from `POSTGRES_PASSWORD`: a sandbox escape must not yield the owner's credentials. Generate with `openssl rand -hex 16`. Example: `<openssl rand -hex 16>`. Secret. Compose only: not read by the api. |
| `REDIS_PASSWORD` | no | — | Password the compose `redis` service (scale profile) requires (`--requirepass`); the container refuses to start without it. Reference it from `REDIS_URL` as `redis://:${REDIS_PASSWORD}@redis:6379` (compose expands it inside `.env`). Example: `<openssl rand -hex 16>`. Secret. Compose only: not read by the api. |
| `BIND_ADDRESS` | no | `127.0.0.1` | Host interface the compose stack publishes its ports on (api, web, postgres, minio, redis, minio console). Loopback by default so a laptop does not expose the stack on its network; `0.0.0.0` publishes on every interface (put a TLS reverse proxy in front of api and web). Compose only: not read by the api. |
| `POSTGRES_PORT` | no | `5432` | Host port of the compose `postgres` service. Compose only: not read by the api. |
| `MINIO_PORT` | no | `9000` | Host port of the compose `minio` S3 endpoint. Compose only: not read by the api. |
| `MINIO_CONSOLE_PORT` | no | `9001` | Host port of the MinIO console, published only by `docker compose --profile tools up minio-console`. Compose only: not read by the api. |
| `REDIS_PORT` | no | `6379` | Host port of the compose `redis` service (scale profile). Compose only: not read by the api. |
| `WEB_PORT` | no | `3001` | Host port of the compose `web` service (the api uses `PORT`). Compose only: not read by the api. |
| `WORKER_CODE_CONCURRENCY` | no | `4` | `WORKER_CONCURRENCY` of the sandbox host `worker-code`. Compose only: not read by the api. |
| `WORKER_REPLICAS` | no | `1` | Number of `worker` containers started by the scale profile. Compose only: not read by the api. |

<!-- env-table:end -->
