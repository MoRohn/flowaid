/**
 * The single table describing every environment variable flowaid reads.
 *
 * `schema.ts` builds the Zod schema from this table (defaults, allowed values and
 * required-ness are taken from here), `scripts/gen-env-example.ts` renders `.env.example`
 * and the README table from it, and `docs.test.ts` proves the three never drift apart.
 */

/** Allowed `NODE_ENV` values. */
export const NODE_ENVS = ["development", "test", "production"] as const;

/** pino log levels plus `silent`. */
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

/** Worker pool names (`WorkerPoolSchema` in CONTRACTS.ts §5). */
export const WORKER_POOLS = [
  "general",
  "code",
  "browser",
  "gpu",
  "retrieval",
  "high_memory",
] as const;

/** Sandbox executors for the `code` pool (ARCHITECTURE.md §10.7). */
export const SANDBOX_MODES = ["isolated-vm", "container"] as const;

/** Dependency modes of exported code (CODE_EXPORT.md §2). */
export const EXPORT_MODES = ["npm", "vendored"] as const;

/** Provider fixture modes for deterministic tests (ARCHITECTURE.md §12.4). */
export const PROVIDER_FIXTURE_MODES = ["off", "record", "replay"] as const;

/**
 * Feature keys of `GET /v1/me.features` (`FeatureKeySchema`, API.md §7). Mirrored here because
 * `FLOWAID_FEATURES_DISABLED` is validated against them; keep the two lists identical.
 */
export const FEATURE_KEYS = [
  "workflows",
  "runs",
  "human_tasks",
  "templates",
  "integrations_mcp",
  "integrations_openapi",
  "integrations_providers",
  "integrations_plugins",
  "knowledge",
  "evaluations",
  "credentials",
  "settings_audit",
  "settings_notifications",
  "agents",
  "ai_builder",
  "advisor",
  "code_export",
  "langchain",
  "oidc",
  "schedules",
  "mcp_exposures",
] as const;

/** A feature key (API.md §7). */
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Documentation groups, in the order they appear in `.env.example` and the README. */
export const ENV_GROUPS = [
  "core",
  "database",
  "queue",
  "security",
  "oidc",
  "execution",
  "storage",
  "providers",
  "observability",
  "compose",
] as const;

/** A documentation group name. */
export type EnvGroup = (typeof ENV_GROUPS)[number];

/** Human-readable titles for {@link ENV_GROUPS}. */
export const ENV_GROUP_TITLES: Readonly<Record<EnvGroup, string>> = {
  core: "Core service settings",
  database: "Database (PostgreSQL 16 + pgvector)",
  queue: "Queue and workers",
  security: "Security and first boot",
  oidc: "Single sign-on (OIDC)",
  execution: "Execution, sandbox and plugins",
  storage: "Object storage (S3-compatible)",
  providers: "AI providers",
  observability: "Observability",
  compose: "Docker Compose stack (read by docker compose, not by the api)",
};

/** Documentation for one environment variable. */
export interface EnvVarDoc {
  /** Documentation group. */
  readonly group: EnvGroup;
  /** One or two sentences: what it configures and what happens when it is absent. */
  readonly description: string;
  /**
   * Raw default as it would be written in a `.env` file. A variable with a default is never
   * required. `undefined` means "no default".
   */
  readonly default?: string;
  /** Whether the variable must be set. Implies no default. */
  readonly required: boolean;
  /** Value written to `.env.example` for required variables and shown as the example. */
  readonly example: string;
  /** Secrets are never echoed back in error messages or logs. */
  readonly secret: boolean;
  /** Closed set of accepted values (enum-like variables and comma lists of enums). */
  readonly values?: readonly string[];
  /**
   * Value written uncommented to `.env.example` for an optional variable that the local
   * quick start needs (for example the first-boot owner). The admin password's quick-start
   * value is rejected in production like its `example`.
   */
  readonly quickstart?: string;
  /**
   * The name is a family (`FLOWAID_SECRET_<NAME>`), not one variable: documented and
   * rendered, but no schema field. `loadEnv` collects the matching variables separately.
   */
  readonly pattern?: boolean;
  /**
   * Read by `docker compose` (interpolation in `docker/compose*.yml`) and by nothing else:
   * documented and rendered into `.env.example`, never a schema field. `loadEnv` ignores it.
   */
  readonly composeOnly?: boolean;
  /**
   * The compose stack refuses to start without it (`${NAME:?...}`), so `.env.example` renders
   * it uncommented and empty for the operator to fill in. Never combined with `default`,
   * `quickstart` or `required` (the api may still treat the variable as optional).
   */
  readonly composeRequired?: boolean;
}

const docs = {
  // ── core ────────────────────────────────────────────────────────────────────────
  NODE_ENV: {
    group: "core",
    description:
      "Runtime mode. `production` disables development conveniences such as auto-generated dev keys and verbose errors.",
    default: "development",
    required: false,
    example: "development",
    secret: false,
    values: NODE_ENVS,
  },
  LOG_LEVEL: {
    group: "core",
    description: "Minimum pino log level emitted by the api and worker processes.",
    default: "info",
    required: false,
    example: "info",
    secret: false,
    values: LOG_LEVELS,
  },
  HOST: {
    group: "core",
    description:
      "Interface the api listens on. The default binds loopback only; the api image and the compose stack set `0.0.0.0` so the container port can be published.",
    default: "127.0.0.1",
    required: false,
    example: "0.0.0.0",
    secret: false,
  },
  PORT: {
    group: "core",
    description: "TCP port of the api (HTTP, SSE, webhooks, MCP endpoint).",
    default: "3000",
    required: false,
    example: "3000",
    secret: false,
  },
  FLOWAID_BASE_URL: {
    group: "core",
    description:
      "Public URL of the api as seen by browsers, webhook callers and MCP clients. Used to build external review links, webhook URLs and the OpenAPI `servers` entry. In production it must be `https:` unless the host is loopback or `FLOWAID_ALLOW_INSECURE_HTTP=true`.",
    default: "http://localhost:3000",
    required: false,
    example: "http://localhost:3000",
    secret: false,
  },
  FLOWAID_WEB_URL: {
    group: "core",
    description:
      "Public URL of the web app. Used for deep links in notifications and as the default CORS origin. Same production rule as `FLOWAID_BASE_URL`.",
    default: "http://localhost:3001",
    required: false,
    example: "http://localhost:3001",
    secret: false,
  },
  CORS_ORIGINS: {
    group: "core",
    description:
      "Comma-separated list of browser origins allowed to call the api with credentials. `*` reflects every request origin and is rejected in production, as is an origin cross-site with `FLOWAID_BASE_URL` unless `FLOWAID_ALLOW_CROSS_SITE=true`.",
    default: "http://localhost:3001",
    required: false,
    example: "http://localhost:3001,https://flowaid.example.com",
    secret: false,
  },
  RATE_LIMIT_MAX: {
    group: "core",
    description:
      "Requests per minute allowed per session principal (api keys get double, webhooks half; API.md §1). Stored in Redis when `REDIS_URL` is set, otherwise in memory per api replica.",
    default: "600",
    required: false,
    example: "600",
    secret: false,
  },
  FLOWAID_API_INTERNAL_URL: {
    group: "core",
    description:
      "URL the web app's server side uses to reach the api over the deployment's private network (compose: `http://api:3000`). Unset means `FLOWAID_BASE_URL`.",
    required: false,
    example: "http://api:3000",
    secret: false,
  },
  FLOWAID_TRUST_PROXY: {
    group: "core",
    description:
      "Reverse proxies whose `X-Forwarded-*` headers are trusted (Fastify `trustProxy`): `false` trusts none, `true` trusts every hop (only when the api is not reachable directly), or a comma-separated list of IPs, CIDRs or the names `loopback`, `linklocal`, `uniquelocal`. Client IPs feed rate limits and audit logs.",
    default: "false",
    required: false,
    example: "10.0.0.0/8,loopback",
    secret: false,
  },
  FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL: {
    group: "core",
    description:
      "Maximum concurrent SSE streams (run events, evaluations) one principal may hold open; the next one is refused with 429 `RATE_LIMIT_ERROR`. The per-workspace cap is ten times this value.",
    default: "20",
    required: false,
    example: "20",
    secret: false,
  },
  FLOWAID_FEATURES_DISABLED: {
    group: "core",
    description:
      "Comma-separated feature keys (`FeatureKey`, API.md §7) the operator turns off: `GET /v1/me` reports them as false and the web app hides their navigation. Unset disables nothing.",
    required: false,
    example: "agents,ai_builder",
    secret: false,
    values: FEATURE_KEYS,
  },

  // ── database ────────────────────────────────────────────────────────────────────
  DATABASE_URL: {
    group: "database",
    description:
      "PostgreSQL 16 connection string (postgres.js format). The database must have the `vector` extension available; migrations are applied by the api entrypoint and `flowaid db migrate`.",
    required: true,
    example: "postgres://flowaid:flowaid@localhost:5432/flowaid",
    secret: true,
  },
  DB_RLS: {
    group: "database",
    description:
      "Enable the row-level-security policies on every tenant table (DATABASE.md, migration 0002). The api then runs `SET LOCAL app.workspace_id` per transaction.",
    default: "false",
    required: false,
    example: "true",
    secret: false,
  },
  RUN_EVENTS_PARTITIONED: {
    group: "database",
    description:
      "Convert `run_events` to monthly range partitions (migration 0003) and let the sweep job pre-create partitions. Irreversible once applied.",
    default: "false",
    required: false,
    example: "true",
    secret: false,
  },
  DATABASE_ADMIN_URL: {
    group: "database",
    description:
      "Connection string of the schema owner, used only to run migrations (api entrypoint, `flowaid db migrate`) while `DATABASE_URL` connects as the restricted `flowaid_app` role under `DB_RLS=true`. Unset means migrations run over `DATABASE_URL`.",
    required: false,
    example: "postgres://postgres:postgres@localhost:5432/flowaid",
    secret: true,
  },
  RETENTION_SWEEP_CRON: {
    group: "database",
    description:
      "Five-field cron schedule of the `retention.sweep` maintenance job that applies workspace retention policies, pre-creates `run_events` partitions and garbage-collects draft versions (DATABASE.md, RFC-0001).",
    default: "0 3 * * *",
    required: false,
    example: "0 3 * * *",
    secret: false,
  },

  // ── queue ───────────────────────────────────────────────────────────────────────
  REDIS_URL: {
    group: "queue",
    description:
      "Redis 7 connection string. When set, jobs use BullMQ, the event bus uses Redis pub/sub and rate limits are shared across api replicas. When unset, everything runs over Postgres (`SKIP LOCKED` + `LISTEN/NOTIFY`) with identical semantics (ARCHITECTURE.md D10).",
    required: false,
    example: "redis://localhost:6379",
    secret: true,
  },
  WORKER_POOLS: {
    group: "queue",
    description:
      "Comma-separated worker pools this worker process consumes. A run's orchestration always happens on `general`; nodes declaring another pool are delegated to a worker that serves it.",
    default: "general",
    required: false,
    example: "general,retrieval",
    secret: false,
    values: WORKER_POOLS,
  },
  WORKER_CONCURRENCY: {
    group: "queue",
    description:
      "Maximum number of jobs one worker process executes concurrently across its pools.",
    default: "10",
    required: false,
    example: "10",
    secret: false,
  },
  FLOWAID_QUEUE_UI: {
    group: "queue",
    description:
      "Mount Bull Board at `/admin/queues` (BullMQ driver only) behind session auth with the `admin` scope. Off by default because job payloads show run inputs.",
    default: "false",
    required: false,
    example: "true",
    secret: false,
  },

  // ── security ────────────────────────────────────────────────────────────────────
  FLOWAID_MASTER_KEY: {
    group: "security",
    description:
      "Master key that wraps the credential key-encryption keys (`MasterKeyProvider` `env`): 32 random bytes encoded as base64 (44 characters) or hex (64 characters). Generate with `openssl rand -base64 32`. When both are set it takes precedence over `FLOWAID_MASTER_KEY_FILE`, which is then ignored (the compose stack always sets the file path).",
    required: false,
    example: "<openssl rand -base64 32>",
    secret: true,
  },
  FLOWAID_MASTER_KEY_FILE: {
    group: "security",
    description:
      "Path of the master key file used when `FLOWAID_MASTER_KEY` is not set (`MasterKeyProvider` `file`). Created with mode 0600 on first boot, with a loud warning, when it does not exist; in production only when `FLOWAID_MASTER_KEY_AUTOGENERATE=true`, and production requires either `FLOWAID_MASTER_KEY` or an explicit path here. Back this file up: without it stored credentials cannot be decrypted.",
    default: ".flowaid/master.key",
    required: false,
    example: "/var/lib/flowaid/master.key",
    secret: false,
  },
  FLOWAID_JWT_PRIVATE_KEY: {
    group: "security",
    description:
      "ES256 (P-256) private key in PEM format used to sign session JWTs. Newlines may be written as `\\n`. Must be set together with `FLOWAID_JWT_PUBLIC_KEY`; when both are absent a key pair is generated under `FLOWAID_JWT_KEYS_DIR`, which production accepts only when that directory is set explicitly.",
    required: false,
    example: "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
    secret: true,
  },
  FLOWAID_JWT_PUBLIC_KEY: {
    group: "security",
    description:
      "ES256 public key in PEM format matching `FLOWAID_JWT_PRIVATE_KEY`. Published at `/.well-known/jwks.json` so other services can verify session tokens.",
    required: false,
    example: "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
    secret: false,
  },
  FLOWAID_JWT_KEYS_DIR: {
    group: "security",
    description:
      "Directory where the api stores an auto-generated ES256 key pair (`jwt.key`, `jwt.pub`) when no explicit keys are configured. Every api replica must share it or sessions will not verify across replicas.",
    default: ".flowaid/keys",
    required: false,
    example: "/var/lib/flowaid/keys",
    secret: false,
  },
  FLOWAID_ADMIN_EMAIL: {
    group: "security",
    description:
      "Email of the owner account created on first boot together with the default workspace and the `dev`/`staging`/`prod` environments. Ignored once any user exists. Must be set together with `FLOWAID_ADMIN_PASSWORD`.",
    required: false,
    example: "admin@example.com",
    quickstart: "admin@flowaid.local",
    secret: false,
  },
  FLOWAID_ADMIN_PASSWORD: {
    group: "security",
    description:
      "Password of the first-boot owner account (12 to 256 characters). Change it after the first login. Production rejects the documented values and a short list of common passwords.",
    required: false,
    example: "change-me-please",
    quickstart: "flowaid-local-admin",
    secret: true,
  },
  FLOWAID_ALLOW_INSECURE_HTTP: {
    group: "security",
    description:
      "Allow `http:` values of `FLOWAID_BASE_URL`/`FLOWAID_WEB_URL` on non-loopback hosts in production and drop the `Secure` flag from session cookies. Only for isolated lab deployments without TLS.",
    default: "false",
    required: false,
    example: "true",
    secret: false,
  },
  FLOWAID_ALLOW_CROSS_SITE: {
    group: "security",
    description:
      "Accept `CORS_ORIGINS` entries that are cross-site with `FLOWAID_BASE_URL` in production. Session cookies are `SameSite`, so a cross-site web app cannot log in; enable only for browser clients that authenticate with api keys.",
    default: "false",
    required: false,
    example: "true",
    secret: false,
  },
  FLOWAID_MASTER_KEY_AUTOGENERATE: {
    group: "security",
    description:
      "Let a production api create a missing `FLOWAID_MASTER_KEY_FILE` on first boot (with a loud warning). Outside production the file is always created. Prefer setting `FLOWAID_MASTER_KEY` or pointing `FLOWAID_MASTER_KEY_FILE` at a backed-up key.",
    default: "false",
    required: false,
    example: "true",
    secret: false,
  },
  "FLOWAID_SECRET_<NAME>": {
    group: "security",
    description:
      "Family of variables, not a setting: credentials with `storage: external` and `externalRef` `env:FLOWAID_SECRET_<NAME>` resolve their value from the matching variable at use time (ARCHITECTURE.md §10.6). Every variable whose name matches `FLOWAID_SECRET_[A-Z0-9_]+` is collected into `env.secretRefs`; no other variable is ever resolvable this way.",
    required: false,
    example: "<value>",
    secret: true,
    pattern: true,
  },

  // ── oidc ────────────────────────────────────────────────────────────────────────
  OIDC_ISSUER: {
    group: "oidc",
    description:
      "Issuer URL of the OpenID Connect provider (`/.well-known/openid-configuration` is discovered from it). Setting it enables `features.oidc` and the `/v1/auth/oidc/*` routes; `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are then required. Must be `https:` in production unless `FLOWAID_ALLOW_INSECURE_HTTP=true`.",
    required: false,
    example: "https://login.example.com/realms/flowaid",
    secret: false,
  },
  OIDC_CLIENT_ID: {
    group: "oidc",
    description: "Client id registered with the OIDC provider for the flowaid web app.",
    required: false,
    example: "flowaid",
    secret: false,
  },
  OIDC_CLIENT_SECRET: {
    group: "oidc",
    description:
      "Client secret matching `OIDC_CLIENT_ID`, used for the authorization-code exchange (with PKCE).",
    required: false,
    example: "<client secret>",
    secret: true,
  },
  OIDC_ROLE_CLAIM: {
    group: "oidc",
    description:
      "ID-token claim whose value (`owner`, `admin`, `editor` or `viewer`, or a list containing one) sets the workspace role on every OIDC login. Unset keeps roles managed in flowaid; new SSO users join as `viewer`.",
    required: false,
    example: "flowaid_role",
    secret: false,
  },

  // ── execution ───────────────────────────────────────────────────────────────────
  SANDBOX_MODE: {
    group: "execution",
    description:
      "Executor for the `code` pool: `isolated-vm` runs JavaScript in an in-process isolate; `container` runs each execution in a locked-down container and is the only host for `flowaid.tools.shell` (ARCHITECTURE.md §10.7).",
    default: "isolated-vm",
    required: false,
    example: "container",
    secret: false,
    values: SANDBOX_MODES,
  },
  MCP_STDIO_ENABLED: {
    group: "execution",
    description:
      "Allow MCP servers with the `stdio` transport to be spawned by the worker (after `validateStdioConfig`). Off by default because a stdio server is an arbitrary local process.",
    default: "false",
    required: false,
    example: "true",
    secret: false,
  },
  FLOWAID_PLUGIN_DIR: {
    group: "execution",
    description:
      "Directory where `flowaid plugin add` installs node packages and from which the worker loads enabled plugins at boot.",
    default: ".flowaid/plugins",
    required: false,
    example: "/var/lib/flowaid/plugins",
    secret: false,
  },
  FLOWAID_BUNDLED_PLUGINS: {
    group: "execution",
    description:
      "Comma-separated node packages shipped inside the worker image that are registered as `source: bundled` plugins at boot without an install step (ARCHITECTURE.md §3.5). Turn one off with `FLOWAID_FEATURES_DISABLED` or by disabling its `plugins` row.",
    default: "@flowaid/nodes-langchain",
    required: false,
    example: "@flowaid/nodes-langchain",
    secret: false,
  },
  FLOWAID_PLUGIN_ALLOW_LOCAL: {
    group: "execution",
    description:
      "Accept `source: local` plugin installs (a directory on the worker host) through `flowaid plugin add` and `POST /v1/plugins`. Off by default: local code skips the registry integrity check.",
    default: "false",
    required: false,
    example: "true",
    secret: false,
  },
  FLOWAID_MCP_STDIO_ALLOWED_COMMANDS: {
    group: "execution",
    description:
      "Comma-separated absolute paths of the executables a stdio MCP server may run when `MCP_STDIO_ENABLED=true`, each optionally followed by `=<regex>` that the space-joined arguments must match (a regex may not contain a comma). Unset allows no command.",
    required: false,
    example: "/usr/local/bin/mcp-filesystem=^/srv/data(/|$),/usr/local/bin/mcp-git",
    secret: false,
  },
  FLOWAID_MCP_STDIO_ENV_ALLOWLIST: {
    group: "execution",
    description:
      "Comma-separated names of worker environment variables a stdio MCP server process may inherit; the bound credential's fields are always passed. Unset passes nothing.",
    required: false,
    example: "PATH,HOME,LANG",
    secret: false,
  },
  FLOWAID_EXPORT_MODE: {
    group: "execution",
    description:
      "How exported code depends on the runtime packages (CODE_EXPORT.md §2): `npm` references the published `@flowaid/*` packages; `vendored` ships the `.tgz` files from `FLOWAID_VENDOR_DIR` inside the zip.",
    default: "vendored",
    required: false,
    example: "npm",
    secret: false,
    values: EXPORT_MODES,
  },
  FLOWAID_VENDOR_DIR: {
    group: "execution",
    description:
      "Directory of the packed runtime packages (`*.tgz` and `SHA256SUMS`, built by the `vendor` stage of `docker/Dockerfile`) that vendored exports copy. When it is missing, `features.code_export` is false.",
    default: "/opt/flowaid/vendor",
    required: false,
    example: "/opt/flowaid/vendor",
    secret: false,
  },

  // ── storage ─────────────────────────────────────────────────────────────────────
  S3_ENDPOINT: {
    group: "storage",
    description:
      "S3-compatible endpoint for artifacts and uploads (MinIO in the default compose stack). Set all of `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` to enable object storage; when none are set artifacts are stored inline in Postgres up to the size limit.",
    required: false,
    example: "http://localhost:9000",
    secret: false,
  },
  S3_BUCKET: {
    group: "storage",
    description: "Bucket that holds artifacts, prefixed `ws/<workspaceId>/`.",
    required: false,
    example: "flowaid",
    secret: false,
  },
  S3_ACCESS_KEY: {
    group: "storage",
    description: "Access key id for the S3 endpoint.",
    required: false,
    example: "flowaid",
    secret: true,
  },
  S3_SECRET_KEY: {
    group: "storage",
    description:
      "Secret access key for the S3 endpoint. The compose stack requires it: it is the MinIO root password and has no default. Generate with `openssl rand -hex 16`.",
    required: false,
    example: "<openssl rand -hex 16>",
    secret: true,
    composeRequired: true,
  },
  S3_REGION: {
    group: "storage",
    description: "Region sent with signed requests. MinIO accepts any value.",
    default: "us-east-1",
    required: false,
    example: "eu-central-1",
    secret: false,
  },
  S3_FORCE_PATH_STYLE: {
    group: "storage",
    description:
      "Use path-style bucket addressing (`endpoint/bucket/key`). Required for MinIO; set to `false` for AWS S3.",
    default: "true",
    required: false,
    example: "false",
    secret: false,
  },

  // ── providers ───────────────────────────────────────────────────────────────────
  TYPESAFE_API_KEY: {
    group: "providers",
    description:
      "TypeSafe AI System One API key (https://api.typesafe.ai). Enables the `TypeSafeDecisionProvider`; without it decisions fall back to the LLM adapter over a configured generation provider.",
    required: false,
    example: "ts_...",
    secret: true,
  },
  OPENAI_API_KEY: {
    group: "providers",
    description: "OpenAI API key for generation and embeddings (`@flowaid/provider-openai`).",
    required: false,
    example: "sk-...",
    secret: true,
  },
  ANTHROPIC_API_KEY: {
    group: "providers",
    description: "Anthropic API key for the Messages API (`@flowaid/provider-anthropic`).",
    required: false,
    example: "sk-ant-...",
    secret: true,
  },
  OLLAMA_HOST: {
    group: "providers",
    description:
      "Base URL of a local Ollama server (`@flowaid/provider-ollama`). Unset disables the provider.",
    required: false,
    example: "http://localhost:11434",
    secret: false,
  },
  FLOWAID_PROVIDER_FIXTURES: {
    group: "providers",
    description:
      "Deterministic provider calls for tests: `record` writes every TypeSafe and LLM request and response to `FLOWAID_PROVIDER_FIXTURES_DIR`, keyed by provider, model and the request hash; `replay` serves them and fails on a miss; `off` calls the providers.",
    default: "off",
    required: false,
    example: "replay",
    secret: false,
    values: PROVIDER_FIXTURE_MODES,
  },
  FLOWAID_PROVIDER_FIXTURES_DIR: {
    group: "providers",
    description:
      "Directory of the recorded provider fixtures (`*.json`) read in `replay` mode and written in `record` mode.",
    default: "fixtures/providers",
    required: false,
    example: "fixtures/providers",
    secret: false,
  },

  // ── observability ───────────────────────────────────────────────────────────────
  OTEL_EXPORTER_OTLP_ENDPOINT: {
    group: "observability",
    description:
      "OTLP/HTTP endpoint for traces and metrics. Unset disables the OpenTelemetry exporter (spans are still created for logs).",
    required: false,
    example: "http://localhost:4318",
    secret: false,
  },
  PROMETHEUS_PORT: {
    group: "observability",
    description:
      "Port of the internal Prometheus `/metrics` listener in the api and worker. Unset disables it.",
    required: false,
    example: "9464",
    secret: false,
  },

  // ── compose (docker compose only; never parsed) ─────────────────────────────────
  POSTGRES_USER: {
    group: "compose",
    description:
      "Name of the PostgreSQL superuser that owns the schema (compose `postgres` service). The api runs migrations as it through `DATABASE_ADMIN_URL`; api and worker connect as `flowaid_app`.",
    default: "flowaid",
    required: false,
    example: "flowaid",
    secret: false,
    composeOnly: true,
  },
  POSTGRES_PASSWORD: {
    group: "compose",
    description:
      "Password of `POSTGRES_USER`. Required by the compose stack, which has no default password. Generate with `openssl rand -hex 16`.",
    required: false,
    example: "<openssl rand -hex 16>",
    secret: true,
    composeOnly: true,
    composeRequired: true,
  },
  POSTGRES_DB: {
    group: "compose",
    description: "Name of the database the compose stack creates and connects to.",
    default: "flowaid",
    required: false,
    example: "flowaid",
    secret: false,
    composeOnly: true,
  },
  POSTGRES_APP_PASSWORD: {
    group: "compose",
    description:
      "Password of the `flowaid_app` role that api and worker connect with (created by `docker/postgres-init/01-roles.sql` on the first start). Unset means `POSTGRES_PASSWORD`; set it to keep the owner's password out of the worker.",
    required: false,
    example: "<openssl rand -hex 16>",
    secret: true,
    composeOnly: true,
  },
  POSTGRES_CODE_PASSWORD: {
    group: "compose",
    description:
      "Password of the `flowaid_code` role the sandbox host `worker-code` connects with (queue tables only). Required by the compose stack and must differ from `POSTGRES_PASSWORD`: a sandbox escape must not yield the owner's credentials. Generate with `openssl rand -hex 16`.",
    required: false,
    example: "<openssl rand -hex 16>",
    secret: true,
    composeOnly: true,
    composeRequired: true,
  },
  REDIS_PASSWORD: {
    group: "compose",
    description:
      "Password the compose `redis` service (scale profile) requires (`--requirepass`); the container refuses to start without it. Reference it from `REDIS_URL` as `redis://:${REDIS_PASSWORD}@redis:6379` (compose expands it inside `.env`).",
    required: false,
    example: "<openssl rand -hex 16>",
    secret: true,
    composeOnly: true,
  },
  BIND_ADDRESS: {
    group: "compose",
    description:
      "Host interface the compose stack publishes its ports on (api, web, postgres, minio, redis, minio console). Loopback by default so a laptop does not expose the stack on its network; `0.0.0.0` publishes on every interface (put a TLS reverse proxy in front of api and web).",
    default: "127.0.0.1",
    required: false,
    example: "0.0.0.0",
    secret: false,
    composeOnly: true,
  },
  POSTGRES_PORT: {
    group: "compose",
    description: "Host port of the compose `postgres` service.",
    default: "5432",
    required: false,
    example: "5432",
    secret: false,
    composeOnly: true,
  },
  MINIO_PORT: {
    group: "compose",
    description: "Host port of the compose `minio` S3 endpoint.",
    default: "9000",
    required: false,
    example: "9000",
    secret: false,
    composeOnly: true,
  },
  MINIO_CONSOLE_PORT: {
    group: "compose",
    description:
      "Host port of the MinIO console, published only by `docker compose --profile tools up minio-console`.",
    default: "9001",
    required: false,
    example: "9001",
    secret: false,
    composeOnly: true,
  },
  REDIS_PORT: {
    group: "compose",
    description: "Host port of the compose `redis` service (scale profile).",
    default: "6379",
    required: false,
    example: "6379",
    secret: false,
    composeOnly: true,
  },
  WEB_PORT: {
    group: "compose",
    description: "Host port of the compose `web` service (the api uses `PORT`).",
    default: "3001",
    required: false,
    example: "3001",
    secret: false,
    composeOnly: true,
  },
  WORKER_CODE_CONCURRENCY: {
    group: "compose",
    description: "`WORKER_CONCURRENCY` of the sandbox host `worker-code`.",
    default: "4",
    required: false,
    example: "4",
    secret: false,
    composeOnly: true,
  },
  WORKER_REPLICAS: {
    group: "compose",
    description: "Number of `worker` containers started by the scale profile.",
    default: "1",
    required: false,
    example: "3",
    secret: false,
    composeOnly: true,
  },
} as const satisfies Record<string, EnvVarDoc>;

/** The name of a documented environment variable. */
export type EnvVarName = keyof typeof docs;

/**
 * Every variable, keyed by name, in documentation order. Add a variable here first; the
 * schema and the generated files follow.
 */
export const ENV_VAR_DOCS: { readonly [K in EnvVarName]: EnvVarDoc } = docs;

/** All documented names in documentation order, including pattern entries. */
export const ENV_VAR_NAMES: readonly EnvVarName[] = Object.keys(ENV_VAR_DOCS).filter(
  (name): name is EnvVarName => name in ENV_VAR_DOCS,
);

/**
 * Names of the variables the schema parses: {@link ENV_VAR_NAMES} without pattern entries and
 * without the compose-only variables.
 */
export const ENV_PARSED_VAR_NAMES: readonly EnvVarName[] = ENV_VAR_NAMES.filter(
  (name) => ENV_VAR_DOCS[name].pattern !== true && ENV_VAR_DOCS[name].composeOnly !== true,
);

/** Names read by `docker compose` only (documented, rendered, never parsed). */
export const ENV_COMPOSE_ONLY_VAR_NAMES: readonly EnvVarName[] = ENV_VAR_NAMES.filter(
  (name) => ENV_VAR_DOCS[name].composeOnly === true,
);

/** Names the compose stack refuses to start without (`${NAME:?...}` in docker/compose*.yml). */
export const ENV_COMPOSE_REQUIRED_VAR_NAMES: readonly EnvVarName[] = ENV_VAR_NAMES.filter(
  (name) => ENV_VAR_DOCS[name].composeRequired === true,
);

/** Names of the parsed variables whose values are secrets (never echoed, logged or serialised). */
export const SECRET_ENV_KEYS: readonly EnvVarName[] = ENV_PARSED_VAR_NAMES.filter(
  (name) => ENV_VAR_DOCS[name].secret,
);

/** Prefix of the `FLOWAID_SECRET_<NAME>` family. */
export const SECRET_REF_PREFIX = "FLOWAID_SECRET_";

/** Full-name test for the `FLOWAID_SECRET_<NAME>` family (ARCHITECTURE.md §10.6). */
export const SECRET_REF_NAME_RE = /^FLOWAID_SECRET_[A-Z0-9_]+$/;

/**
 * Whether `name` is a documented variable: a parsed variable, or a member of a documented
 * family such as `FLOWAID_SECRET_<NAME>`.
 */
export function isDocumentedEnvName(name: string): boolean {
  if (Object.prototype.hasOwnProperty.call(ENV_VAR_DOCS, name)) {
    return true;
  }
  return name.startsWith(SECRET_REF_PREFIX);
}

/** Looks up the documentation of a variable. */
export function envVarDoc(name: EnvVarName): EnvVarDoc {
  return ENV_VAR_DOCS[name];
}
