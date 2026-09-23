# Review lens: security and privacy

Scope: what exists on disk (`packages/env`, `docker/`, `packages/workflow-core` FlowExpr, `packages/ui` human components, repo/supply-chain config) and the design (`ARCHITECTURE.md` §3.5, §5.7, §10.2, §10.3, §10.6, §10.7; `API.md` §1, §3.5, §6; `DATABASE.md`; `CODE_EXPORT.md`). Each item names the evidence and a change concrete enough to implement.

Severity legend: critical = exploitable with the default install; high = exploitable by a low-privilege principal or leaves a stated guarantee false; medium = defence gap; low = hygiene.

---

## 1. Build context leaks secrets into image layers (critical, devops, S)

Evidence: no `.dockerignore` exists; all three Dockerfiles run `COPY . .` in the `build` stage (`docker/Dockerfile.api:18`, `Dockerfile.worker:21`, `Dockerfile.web:22`). The repo root today contains `.env.local` (holds `TYPESAFE_API_KEY`), and the runtime default `FLOWAID_MASTER_KEY_FILE=.flowaid/master.key` / `FLOWAID_JWT_KEYS_DIR=.flowaid/keys` put live key material under the build context. `.git`, `node_modules`, `.turbo` also go in. Build-stage layers are cached and pushed by `docker buildx --cache-to`, so this is a real disclosure path, not only bloat.

Fix:

- Add `/.dockerignore` with at least: `.git`, `**/node_modules`, `**/dist`, `**/.next`, `.turbo`, `**/coverage`, `.env`, `.env.*`, `!.env.example`, `.flowaid`, `data`, `docs/review`, `.claude`, `*.log`, `playwright-report`, `test-results`.
- Add `scripts/check-dockerignore.test.ts`: every pattern under the `# env & secrets` and `# local data` sections of `.gitignore` must be present in `.dockerignore` (parse both files; fail with the missing pattern).

## 2. The sandbox host holds the master key and every provider secret (critical, security, M)

Evidence: `docker/compose.yml` `worker-code` gets `env_file: ../.env` (all provider keys, `FLOWAID_MASTER_KEY`), `<<: *service-env` (`FLOWAID_MASTER_KEY_FILE: /data/master.key`) and `flowaid-data:/data:ro`. The comment says the separate container exists "so a sandbox escape cannot reach orchestrator memory", but an escape reaches the master key file and therefore every stored credential. `ARCHITECTURE.md` §10.7 says nothing about what the `code` pool process may hold.

Fix:

- Compose: `worker-code` gets no `env_file`, no `/data` mount, no `FLOWAID_MASTER_KEY*`, no provider keys; only `DATABASE_URL` (for the queue; see §5 for a restricted role), `REDIS_URL`, `WORKER_POOLS=code`, `SANDBOX_MODE`, `LOG_LEVEL`. Add `cap_drop: [ALL]`, `pids_limit: 256`, `mem_limit: 1g` (`deploy.resources.limits.memory`), keep `read_only`, `no-new-privileges`, `tmpfs: /tmp:size=256m`.
- Design (§10.7 + CONTRACTS `CredentialAccess`): the `code` pool never constructs a `MasterKeyProvider`. A `node.exec` job for a code node carries the already-resolved credential values for the node's declared slots only (encrypted to the job with a per-job key from the general worker, or simply included and the job row deleted on completion), and `ctx.credentials.get` in the code pool reads from that bag. Add an assertion in `apps/worker` boot: `WORKER_POOLS` includes `code` ⇒ `FLOWAID_MASTER_KEY*` must be unset (fail fast, `E_CODE_POOL_HAS_MASTER_KEY`).
- Same rule for a future `worker-mcp` container hosting stdio servers (see §20).

## 3. Compose defaults: well-known passwords, everything published on 0.0.0.0, NODE_ENV=production (high, devops, S)

Evidence: `docker/compose.yml` — Postgres `flowaid/flowaid`, MinIO `flowaid/flowaid-secret`, Redis (`compose.scale.yml`) with no `requirepass`; ports `"${POSTGRES_PORT:-5432}:5432"`, `9000`, `9001` (MinIO console with root creds), `6379` bind all interfaces; `NODE_ENV: ${NODE_ENV:-production}`. `worker` (general, holds plugins + all keys) has no `security_opt`/`cap_drop`. Images `minio/minio:latest`, `minio/mc:latest`, `redis:7-alpine`, `pgvector/pgvector:pg16` are floating tags.

Fix:

- Bind infra ports to loopback by default: `"${BIND_ADDRESS:-127.0.0.1}:${POSTGRES_PORT:-5432}:5432"` (same for 9000, 9001, 6379); document `BIND_ADDRESS=0.0.0.0` for remote DB access.
- Two networks: `internal` (`internal: true`: postgres, minio, redis, api, worker, worker-code) and `edge` (api, web). `web` only reaches `api`.
- Require passwords instead of defaulting: `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}`, `S3_SECRET_KEY: ${S3_SECRET_KEY:?...}`; `redis-server --requirepass ${REDIS_PASSWORD:?...}` and `REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379`. Add these compose-only vars to `.env.example` under a generated "Compose stack" block (extend `packages/env/src/docs.ts` with a `composeOnly: true` flag rendered but not parsed by `EnvSchema`).
- Drop the MinIO console port unless `MINIO_CONSOLE_PORT` is set (use a `profiles: [tools]` service or leave it out of `ports`).
- `worker`: `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, `pids_limit: 1024`.
- Pin images by digest (`image: pgvector/pgvector:pg16@sha256:…`) and add `renovate.json` (`docker` + `npm` managers) so pins get PRs.

## 4. Every container receives the whole `.env` (high, devops, S)

Evidence: `web` has `env_file: ../.env`; the Next.js server needs only `FLOWAID_API_INTERNAL_URL` and `NEXT_PUBLIC_*`, yet gets `DATABASE_URL`, `FLOWAID_MASTER_KEY`, `OPENAI_API_KEY`, … A web-side SSR bug (or a dependency compromise in the largest dependency tree of the stack) then exposes everything.

Fix: remove `env_file` from `web` and `worker-code`; keep explicit `environment:` maps. For `api` and `worker`, keep `env_file` but add a `docker/compose.test.ts` that parses the compose file and asserts the allowed variable set per service (web ⊆ {NODE_ENV, HOSTNAME, PORT, FLOWAID_API_INTERNAL_URL, NEXT_PUBLIC_FLOWAID_BASE_URL}; worker-code ∌ FLOWAID_MASTER_KEY*, *_API_KEY, S3_SECRET_KEY).

## 5. RLS as designed is bypassed by the connecting role (high, spec-gap, M)

Evidence: `DATABASE.md` Conventions — policies `USING (workspace_id = current_setting('app.workspace_id')::uuid)`, enabled when `DB_RLS=true` (default `false`, `packages/env/src/docs.ts`). The compose stack connects as `POSTGRES_USER`, which owns the tables; table owners and superusers bypass RLS unless `FORCE ROW LEVEL SECURITY`. `IMPLEMENTATION_PLAN.md` WP-24 says "RLS enabled in the compose default" but the role model makes that a no-op. Tenant isolation therefore rests entirely on `WHERE workspace_id = …` in every repository query.

Fix:

- `0002_rls.sql`: `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;` for every tenant table; policy uses `current_setting('app.workspace_id', true)` and `NULLIF(…, '')::uuid` so an unset GUC yields zero rows (fail closed), plus a `system` bypass via `current_setting('app.bypass_rls', true) = 'on'` for the sweep/reprojection jobs.
- Roles: migrations run as the owner (`DATABASE_ADMIN_URL`, new env var, optional; defaults to `DATABASE_URL`), the api/worker connect as `flowaid_app` (`NOLOGIN` template + `GRANT`s generated in `0002`), created by compose `docker/postgres-init/01-roles.sql` mounted at `/docker-entrypoint-initdb.d`. `worker-code` gets a third role `flowaid_code` with grants on `queue_jobs`, `node_runs`, `run_events`(insert) only.
- `DB_RLS` default `true` in compose; keep `false` only for local dev without the role split.
- Test (WP-03): two workspaces, `SET LOCAL app.workspace_id = A`, `SELECT` on every tenant table returns no B rows; without the GUC returns zero rows.

## 6. `externalRef: env:NAME` credentials read arbitrary worker environment (high, spec-gap, S)

Evidence: `DATABASE.md` `credentials.external_ref` "env:NAME | vault:path#key | aws-sm:arn", `ARCHITECTURE.md` §10.6 "External providers store a reference (`env:NAME` …) resolved at use time". Anyone with `credentials:write` (role `admin` in the workspace, not the operator) can create `externalRef: env:FLOWAID_MASTER_KEY` or `env:DATABASE_URL` and send it through an HTTP node to a host they control. Since the env is process-global, this also crosses workspaces.

Fix:

- The `env` provider resolves only names matching `^FLOWAID_SECRET_[A-Z0-9_]+$` (document in `docs.ts` as a pattern-documented family, add `FLOWAID_SECRET_*` to `turbo.json` `globalPassThroughEnv`) and refuses every schema variable name (`ENV_SCHEMA_KEYS`) explicitly.
- Creating a `provider: 'env' | 'file'` credential requires `admin` (not just `credentials:write`) and emits `credential.create{provider}` with the ref name in `audit_events`.
- `POST /v1/credentials` validates the ref format at write time (`400`), not only at use time.

## 7. `@flowaid/env` has no production guards (high, security, S)

Evidence: `packages/env/src/schema.ts` accepts, with `NODE_ENV=production`: `CORS_ORIGINS=*` (docs say "development only", nothing enforces it; `*` with `credentials: true` is also invalid CORS), no master-key source (silently auto-generates), no JWT keys (dev pair), `FLOWAID_ADMIN_PASSWORD=change-me-please` (the documented example), `FLOWAID_BASE_URL=http://…` on a public host (session cookies cannot be `Secure`). The compose stack defaults `NODE_ENV` to `production`, so these are the paths a first deploy takes.

Fix (all in `crossFieldIssues`, with tests in `schema.test.ts`):

- production ⇒ `CORS_ORIGINS` must not contain `*`.
- production ⇒ `FLOWAID_BASE_URL` and `FLOWAID_WEB_URL` must be `https:` unless host is `localhost`/`127.0.0.1`/`::1` or `FLOWAID_ALLOW_INSECURE_HTTP=true` (new boolean, default `false`, group `security`).
- `FLOWAID_ADMIN_PASSWORD` must not equal its documented `example` and must not be in a 20-entry deny-list (`password`, `changeme`, …); keep min 12, add max 256 (argon2 input bound).
- production ⇒ `FLOWAID_JWT_PRIVATE_KEY`/`PUBLIC_KEY` required unless `FLOWAID_JWT_KEYS_DIR` is explicitly set (i.e. the operator chose persistent generated keys); the api logs a `warn` once per boot when running on generated keys.
- production ⇒ master key auto-generation only with `FLOWAID_MASTER_KEY_AUTOGENERATE=true` (see §17).
- Non-production `CORS_ORIGINS=*` ⇒ the api reflects the request origin (never the literal `*`) so credentials keep working.

## 8. Secrets in logs: no redacted view of `Env`, no pino redact paths, env-sourced secrets unknown to the `Redactor` (medium, security, S)

Evidence: `loadEnv()` returns a frozen object holding raw `DATABASE_URL`, `*_API_KEY`, `FLOWAID_MASTER_KEY`; one `logger.info({ env })` or a serialised error carrying it prints everything. `ARCHITECTURE.md` §10.6 says the `Redactor` "learns every decrypted secret value", which excludes secrets that never pass through `CredentialAccess` (provider keys from env, `S3_SECRET_KEY`, `REDIS_URL` password, the review token in `?t=`, `Authorization`/`Cookie` headers logged by Fastify's request serializer).

Fix:

- `packages/env`: export `SECRET_ENV_KEYS` (names with `secret: true`), `redactEnv(env): Record<string, string>` (secret values replaced by `<set>`), and `secretEnvValues(env): string[]`. Add a `toJSON` on the frozen `Env` that returns `redactEnv(env)` so accidental serialisation is safe. Tests: `JSON.stringify(loadEnv(...))` contains no secret value.
- `apps/api`/`apps/worker` boot: `redactor.learn(secretEnvValues(env))`; pino options `redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-webhook-token"]', 'req.headers["x-signature"]', 'req.query.t', 'res.headers["set-cookie"]'], censor: '[REDACTED]' }`.
- WP-24 "grep test over captured logs" should seed every secret with a unique canary and grep for the canaries.

## 9. "Only `@flowaid/env` reads `process.env`" is not enforced (low, scaffold, S)

Evidence: `packages/env/src/index.ts` states the rule; `eslint.boundaries.js` only configures `no-restricted-imports`. Nothing stops `apps/api` or a node from reading `process.env.OPENAI_API_KEY` (which would also bypass §6/§8).

Fix: in `packages/config/eslint.base.js` add `no-restricted-syntax` with selector `MemberExpression[object.type='Identifier'][object.name='process'][property.name='env']` (message: use `@flowaid/env`), and an override in `packages/env/eslint.config.js` that disables it. Extend `scripts/check-boundaries.test.ts` to assert the rule is present.

## 10. Supply chain: `minimumReleaseAge` never set, no CI audit, floating base images (high, devops, S)

Evidence: `pnpm-workspace.yaml` has a `minimumReleaseAgeExclude` list "pnpm's supply-chain policy refuses very new releases" but no `minimumReleaseAge` key; `pnpm config get minimumReleaseAge` → `undefined`, so the policy is off and the exclusions are dead. There is no `.github/` (no CI), no `pnpm audit` gate (it passes today: "No known vulnerabilities found"). `allowBuilds` correctly restricts postinstall scripts. `pnpm-lock.yaml` is present and Dockerfiles use `--frozen-lockfile` (good).

Fix:

- `pnpm-workspace.yaml`: `minimumReleaseAge: 4320` (3 days) above the exclude list; re-verify the exclusions are still needed at that age and drop the ones that are not.
- `.github/workflows/ci.yml`: `pnpm install --frozen-lockfile`, `pnpm audit --prod --audit-level=high`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm boundaries`, `pnpm env:check`, plus the docker-ignore and compose tests from §1/§4. Add `dependency-review` on PRs.
- `renovate.json` with `minimumReleaseAge: '3 days'`, digest pinning for Docker (§3), grouped `@fastify/*`, `@langchain/*`.
- Docker `deps` stages: `corepack prepare pnpm@12.5.1` downloads pnpm at build time unpinned by hash; pin via `COREPACK_INTEGRITY_KEYS` default (keep) and prefer `npm i -g pnpm@12.5.1 --integrity=…` or the official `pnpm/action-setup` in CI.

## 11. Session lifecycle: fixation, rotation reuse, revocation, role freshness, login throttling (high, spec-gap, M)

Evidence: `API.md` §1 defines `fa_session` (15 min JWT with `sub, ws, role, sid`, `SameSite=Lax`) and `fa_refresh` (30 d, rotated, hashed in `refresh_tokens`). Missing: `Secure` attribute and `__Host-` prefix; what login does with a pre-existing `fa_refresh` (fixation: an attacker-planted cookie must be revoked and a fresh `sid` issued); reuse detection on rotation (`refresh_tokens.replaced_by_id` exists but no family id and no "revoke the family on replay"); any way to invalidate a 15-min JWT (logout, password change, member removal, role change — `role` is baked into the JWT so a demotion takes effect only at refresh); `POST /v1/auth/login` and `/refresh` are `public`, and rate limits are "per principal", so there is no per-IP / per-account throttle for password guessing; `users` has no `password_changed_at` / token version.

Fix (API.md §1, DATABASE.md, WP-15 auth plugin):

- Cookies: `__Host-fa_session` (`Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`), `fa_refresh` (`Path=/v1/auth/refresh`, `Secure`, `HttpOnly`, `SameSite=Strict`); `Secure` omitted only when `FLOWAID_ALLOW_INSECURE_HTTP` (§7).
- Login: revoke any presented refresh token, mint a new family (`refresh_tokens.family_id uuid`), new `sid = family_id`. Refresh: if the presented token is already `revoked_at`/`replaced_by_id` ⇒ revoke the whole family, audit `auth.refresh_reuse_detected`, 401.
- `users.token_version int default 0`; JWT claim `tv`; the auth plugin compares against a 60 s in-process cache of `(userId → token_version, membershipRole)`; password change / `POST /v1/auth/logout-all` / member removal / role change bump `token_version`. Drop `role` from the JWT (derive from membership per request, cached) or keep it only as a hint.
- `X-Requested-With: flowaid` is required on `/v1/auth/refresh` and `/v1/auth/logout` too (they are state-changing and cookie-authenticated).
- Throttles on `/v1/auth/login`: 20/min per IP, 10 per 15 min per lower-cased email (Redis or `kv`), constant-time path on unknown email (run argon2 against a fixed dummy hash), audit `auth.login_failed { emailHash }`.
- `refresh_tokens.ip/user_agent` already exist: expose `GET /v1/me/sessions` + `DELETE /v1/me/sessions/:id` (owner of the session or workspace admin).
- Deployment note: web and api must be same-site (same registrable domain) for `SameSite=Lax` cookies; document, and make the api reject `CORS_ORIGINS` entries that are cross-site with `FLOWAID_BASE_URL` unless `FLOWAID_ALLOW_CROSS_SITE=true`.

## 12. API keys: no rotation, no checksum, scopes frozen at creation, per-key limit has no column (medium, spec-gap, S)

Evidence: `API.md` §1/§3.1 — `fa_live_<40 base62>`, "scopes ⊆ creator's at creation", only `DELETE /v1/api-keys/:id`; "override per key" rate limit but `DATABASE.md` `api_keys` has no rate column; `expiresAt` optional with no default; `lastUsedAt` implies a write per request.

Fix:

- Format `fa_<live|test>_<32 base62 random>_<6 base62 crc32>` documented in API.md so secret scanners can verify offline; `test` keys can only be pinned to non-protected environments.
- `POST /v1/api-keys/:id/rotate { graceMinutes?: 0..1440 }` → new key once, old key `expires_at = now()+grace`; audit `api_key.rotate`.
- `api_keys.rate_limit_per_min int null`, `expires_at` default 365 d at creation (UI shows it), `last_used_at` updated at most once per minute per key.
- Non-service-account keys: at request time intersect stored scopes with the creator's _current_ role scopes (creator demoted or removed ⇒ key loses scopes; creator removed ⇒ key revoked). Service accounts (`is_service_account`) keep stored scopes and require `admin` to create.

## 13. Review tokens: query-string transport, undefined single-use, one hash per task, and the UI leaks run internals to external reviewers (high, spec-gap, M)

Evidence: `API.md` §1 "`Authorization: Bearer <token>` or `?t=`", "single-use, hashed in `human_tasks.review_token_hash`"; `DATABASE.md` `human_tasks.review_token_hash` (one column ⇒ re-minting overwrites, no revocation, no record of which link responded); `GET /v1/review/:token` returns `{ request, expiresAt }` where `HumanRequest` includes `assignees` (user ids/emails) and `origin`; `ARCHITECTURE.md` §5.7 "the review page shows only `request`"; but `packages/ui/src/human/ReviewPage.tsx` (documented as "Shell-free review page for the external approval link") accepts and renders `nodeRuns` ("Run so far": node names, types, decisions, routes), `runId` and an "Open run" button. `UI.md` line 24 says the internal task page reuses the component "plus run context", so the external route will receive the same props unless the type forbids it. `?t=` tokens land in access logs, browser history and `Referer`.

Fix:

- New table `human_task_review_tokens (id, task_id, token_hash unique, expires_at, created_by, used_at, revoked_at)`; `POST …/review-link` inserts (many links per task), `DELETE …/review-link/:id` revokes; `respond` marks `used_at` in the same CAS transaction as `human_tasks open → responded` (single-use = one successful respond; `GET` does not consume). Token = 32 random bytes base64url, sha256 hash; `expires_at ≤ min(task.expires_at, 7 d)`.
- Transport: the web route `review/[token]` receives the token in the URL **fragment** (`/review#t=…`), reads it client-side and sends `Authorization: Bearer`; the API rejects `?t=`; responses carry `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; `/v1/review/*` limited to 60/min per IP; 404 and 410 collapse to 404 (no existence oracle).
- `GET /v1/review/:token` returns `ExternalReviewView { title, mode, context, expiresAt, workflowName }` — never `assignees`, `origin`, ids.
- `@flowaid/ui`: split `ExternalReviewPage` (props: `card`, `brand`; no `nodeRuns`/`runId`/`onOpenRun`) from the internal `TaskPage`; keep `ReviewPage` as the internal component. Test: rendering `ExternalReviewPage` with a full `HumanTaskDetail` fixture shows no node names or run id.
- Audit `human_task.respond { actor_type: 'review_token', tokenId }`.

## 14. Webhook ingress: replay protection optional, `none` signature = public run trigger, token compare unspecified (medium, spec-gap, S)

Evidence: `API.md` §6 "replay window `X-Timestamp` ± 5 min with a nonce cache **when the header is present**" — an attacker replaying a captured request simply omits the header; `signature: 'none'` allowed in non-protected environments with a user-chosen `path` ⇒ unauthenticated, guessable run triggers (cost and queue exhaustion at 300/min); `timingSafeEqual` is stated for HMAC only.

Fix: `webhooks.require_timestamp boolean not null default true` (HMAC mode rejects requests without a valid `X-Timestamp`; UI toggle for providers that do not send one); `none` mode ⇒ server generates `path = <slug>-<22 base62 chars>` (≥128 bits) and the row's per-webhook limit defaults to 60/min; `token` mode compares with `timingSafeEqual` over equal-length buffers; nonce cache = `kv` (or Redis) key `webhook:<id>:<sha256(signature)>` TTL 10 min; reject bodies > 2 MiB before reading; audit `webhook.rejected { reason }` sampled.

## 15. Audit coverage: missing actor types and auth events (medium, spec-gap, S)

Evidence: `DATABASE.md` `audit_events.actor_type` enum `['user','api_key','review_token','system']` — `Principal.type` also has `mcp_token`; webhook-originated runs have no actor type; no auth events are listed anywhere (`action` examples are all resource mutations); nothing says `details` passes through the `Redactor`.

Fix: enum += `mcp_token`, `webhook`; define `auth.login`, `auth.login_failed` (email hash only), `auth.logout`, `auth.logout_all`, `auth.refresh_reuse_detected`, `auth.password_changed`, `api_key.used_from_new_ip` (first use per key/IP per day), `credential.use { credentialId, runId, nodeId }` (already implied), `plugin.install`, `mcp_server.stdio_spawn`; `details` is passed through `Redactor.redact()` before insert; WP-24's route-registration test asserts every route whose method ∉ {GET, HEAD, OPTIONS} declares `config.audit = { action, resourceType }`.

## 16. Master key: silent first-boot generation, no key check value, no master rotation (medium, security, S)

Evidence: `packages/env/src/docs.ts` `FLOWAID_MASTER_KEY_FILE` "Created with mode 0600 on first boot, with a loud warning"; `DATABASE.md` `encryption_keys` has no fingerprint of the master that wrapped a KEK, so a wrong `FLOWAID_MASTER_KEY` (or a fresh file after a lost volume) fails at the first credential decrypt, not at boot; `ARCHITECTURE.md` §10.6 "`rotate` re-wraps DEKs only" — no way to change the master key.

Fix: `encryption_keys.master_kcv text` = base64 of the first 8 bytes of `HMAC-SHA256(master, 'flowaid/master-kcv/v1')`; boot verifies the active KEK's KCV and exits with `E_MASTER_KEY_MISMATCH` and the file path/provider name; generation uses `open(O_CREAT|O_EXCL, 0600)` inside `pg_advisory_xact_lock(hashtext('flowaid.master_key'))` so replicas cannot each create a key; in production generation requires `FLOWAID_MASTER_KEY_AUTOGENERATE=true` (new env var) else exit with instructions; `flowaid keys rotate-master --new-key-file …` re-wraps every `encryption_keys.wrapped_kek` in one transaction and updates `master_kcv`, audited as `system`.

## 17. Plugin isolation: `worker_threads` is not a security boundary (high, design, M)

Evidence: `ARCHITECTURE.md` §3.5 and D21: plugins load "into a `worker_threads` Worker per package with a message-port `ctx` proxy … so a plugin cannot touch orchestrator memory or the database". A worker thread shares the process: it can `require('postgres')` and read `process.env.DATABASE_URL`/`FLOWAID_MASTER_KEY`, open sockets, spawn `child_process`, call `process.exit`, and exhaust the heap. `plugins.integrity` exists in the schema but no check is specified; `source: 'local'` is unrestricted; `POST /v1/plugins` installs npm packages (lifecycle scripts!) on the worker host.

Fix:

- Rewrite §3.5/D21: plugins run in a **separate plugin host process** per package (`child_process.fork` of `apps/worker/dist/plugin-host.js` with `execArgv: ['--disallow-code-generation-from-strings', '--permission', '--allow-fs-read=<pluginDir>/<pkg>', '--allow-child-process=false']` on Node 24's permission model), environment scrubbed to `{ NODE_ENV, LOG_LEVEL }`, same JSON-only message-port `ctx` proxy; `resourceLimits`/`--max-old-space-size=512`; the host is restarted on crash and the node fails with `PLUGIN_HOST_CRASHED`. State plainly in the docs that this is a process boundary, not a sandbox, and that plugins are admin-trusted code.
- Install: `pnpm add --ignore-scripts --config.minimumReleaseAge=4320 <pkg>@<exact>` into `FLOWAID_PLUGIN_DIR`; record the tarball `integrity` from the registry manifest in `plugins.integrity`; on load, hash the installed package (`pnpm`'s `.pnpm` store integrity or a recursive sha512 of the package dir) and refuse with `E_PLUGIN_INTEGRITY` on mismatch. `source: 'local'` only when `FLOWAID_PLUGIN_ALLOW_LOCAL=true`. Audit `plugin.install { packageName, version, integrity }`.
- Plugin credentials: the host receives only the slots the executing node declared (same bag design as §2).

## 18. `IsolatedVmSandbox` limits are incomplete (medium, design, M)

Evidence: `ARCHITECTURE.md` §10.7 lists 128 MiB, CPU timeout, no `require`, bridges `fetch/log/tools.call/state.get/set`. Missing: a wall-clock bound (CPU timeout does not cover time spent awaiting a bridged `fetch`/`tools.call`), a cap on the size of values crossing the bridge (a 100 MB string returned from the isolate is copied into the host), which tools `tools.call` may reach (any tool bound to the node, including irreversible ones, with no `approval` path inside the sandbox), `state` namespace (must be `run:<id>` only), `inspector: false`, the esbuild transpile cache bound, and a statement that `isolated-vm` is in maintenance mode and its author recommends an outer container for untrusted code.

Fix: per execution `deadline = min(node timeout, 120 s)` enforced with `AbortSignal.timeout` around the whole `run()` plus `isolate.dispose()` on expiry; `maxBridgeBytes = 4 MiB` per value and per `log` line 8 KiB; `tools.call` restricted to `config.tools[]` names with `approval !== 'never'` ⇒ `SandboxToolNeedsApproval` error (no suspension from inside the isolate); `state` keys prefixed by the runtime, not the code; `new ivm.Isolate({ memoryLimit: 128, inspector: false })`; transpile cache LRU 200 entries; docs recommend `SANDBOX_MODE=container` for multi-tenant production and keep `isolated-vm` as the single-tenant/dev default; the `worker-code` container limits from §2.

## 19. MCP stdio policy is a blocklist and runs beside every secret (medium, design, S)

Evidence: `ARCHITECTURE.md` §10.2 "`validateStdioConfig` — metachar rejection, per-command dangerous-flag blocklist, env allow-list"; `mcp_servers.command/args/env` are set by workspace `mcp:write` (admin). `npx -y <anything>`, `node -e`, `python -c`, `sh -c` are all plain commands with benign-looking flags, so a blocklist does not prevent arbitrary code on the general worker, which holds all provider keys and the master key (compose).

Fix: replace the blocklist with an operator allow-list: `FLOWAID_MCP_STDIO_ALLOWED_COMMANDS` (comma list of absolute paths; empty = none) and an optional per-command args regex; `env` passed to the child = `FLOWAID_MCP_STDIO_ENV_ALLOWLIST` ∩ request + the bound credential's fields; spawn with `shell: false`, `cwd` = fresh temp dir, `detached: true` and kill the process group on timeout/cancel, `stdio: ['pipe','pipe','pipe']` with a 1 MiB stderr cap; cap discovered tool description length (1 KiB) and strip control characters before storing/prompting (the `W_MCP_TOOL_SUSPICIOUS` flag stays). Recommend a dedicated `worker-mcp` container (`WORKER_POOLS=general` is wrong for it — add pool `mcp_stdio`) that, like `worker-code`, holds no master key.

## 20. OpenAPI import: external `$ref` bypasses SafeFetch; server URLs unchecked at import (medium, design, S)

Evidence: `ARCHITECTURE.md` §10.3 "`parseOpenApi({ url } | { text, format })` dereferences 3.0/3.1 documents (`@readme/openapi-parser`, SSRF-guarded fetch, 5 MiB cap)". The parser resolves external `$ref`s (`http://169.254.169.254/…`, `file:///…`) with its own resolver, not `SafeFetch`; nothing bounds the number of operations or schema depth; `serverUrl`/`servers[]` are only checked at execution.

Fix: call the parser with `resolve: { external: false, file: false }` and pre-resolve external refs through `SafeFetch` (max 10 documents, 3 hops, 5 MiB each) or reject them with `E_OPENAPI_EXTERNAL_REF`; reject `servers[]`/`serverUrl` that resolve to private ranges at import time (`E_TOOL_SERVER_PRIVATE`) and re-check at execution (SafeFetch); YAML via `yaml` with `schema: 'core'` (no custom tags); caps: 500 operations, schema depth 32, 2 MiB text; `executeOperation` refuses args that set `Host`, `Content-Length`, `Authorization` (unless the operation declares that header) and any header value containing CR/LF.

## 21. FlowExpr regex: ReDoS from workflow and data-controlled patterns (high, workflow-core, S)

Evidence: `packages/workflow-core/src/expr/evaluator.ts:179-191` `compileRegex` builds `new RegExp(source, flags)` from any string; `matches` (line 393) and `regex_test`/`regex_match` (576-579) accept patterns from refs, so a run _input_ can carry the pattern; the 10 000-step budget (line 25) bounds AST steps, not the backtracking inside one `.test()`; there is no subject-length cap; `evaluator.test.ts` has size tests but no catastrophic-backtracking test. Expressions evaluate in the orchestrator's general worker (and in the browser during compile), so `(a+)+$` against `'a'.repeat(40)+'!'` pins a worker CPU for minutes and blocks every run it orchestrates.

Fix:

- Compile time (`typer`/compiler): the pattern operand of `matches`, `regex_test`, `regex_match` must be a string literal (`E_EXPR_REGEX_DYNAMIC` otherwise) and is vetted with a linear-time safety check (`recheck` or an AST check via `regexpp` rejecting nested quantifiers over overlapping sets and backreferences ⇒ `E_EXPR_REGEX_UNSAFE`).
- Runtime (`evaluator.ts`): pattern length ≤ 1 024, subject length ≤ 65 536 (`ExpressionError('LIMIT')`), compiled-regex LRU (256 entries); when the optional `re2` package is present in the worker, use it.
- Tests: the `(a+)+$` case must fail fast (< 50 ms) with the new error; a literal-safe pattern still works; dynamic pattern yields the compile diagnostic.

## 22. Code export: recorded runs and sample inputs are not stated as redacted; vendored tarballs have no integrity (medium, design, S)

Evidence: `CODE_EXPORT.md` §1 guarantees "secret NAMES only" for `workflow.json`, but `includeSampleFromRunId`/`includeRecordedRunId` copy run input, node outputs and recorded provider responses into `inputs/example.json` and `tests/workflow.test.ts` with no mention of the write-time redaction classes (`pii`, `sensitive`, `doNotPersist`) or of `environments.variables`; vendored mode points `package.json` at `file:./vendor/*.tgz` with no checksums, and `Dockerfile.api` has no vendor build step yet; `GET /v1/artifacts/:id/download` for the export zip is described as "owner scope".

Fix: export reads only the persisted (already redacted) `node_runs`/`run_events`; fields with `x-dataClass: pii|sensitive` and any `{"$redacted": true}` stub are replaced by schema-generated placeholders and the README lists them; `environments.variables` are never exported (only `WorkflowDefinition.variables` defaults); `vendor/SHA256SUMS` + a `pnpm-lock.yaml` with `integrity` for every `file:` dependency, generated at image build (`docker/Dockerfile.api` `RUN pnpm -r pack --pack-destination /opt/flowaid/vendor && sha256sum …`), and `tests/vendor-integrity.test.ts` in the package; export artifacts get `kind: 'export'`, `expires_at = 24 h`, and download requires `workflows:read` on the source workflow; audit already present.

## 23. SSE streams and rate limiting per principal (medium, spec-gap, S)

Evidence: `API.md` §1/§5 — rate limits count requests; a stream with `?until=never` is one request held open indefinitely and outlives the 15-min session JWT (no re-validation is described); no cap on concurrent streams per principal or workspace; `x-request-id` and IP-keyed limits are only meaningful with a trusted proxy configuration, which no env var expresses (`X-Forwarded-For` spoofing bypasses IP limits behind a reverse proxy without `trustProxy`; enabling it blindly lets clients spoof).

Fix: per-principal concurrent stream cap (`FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL=20`, per workspace 200) returning 429; re-check the principal on every 15 s heartbeat (JWT `exp`/`token_version`, api key `revoked_at`) and end with `event: END {"reason":"unauthorized"}`; add `FLOWAID_TRUST_PROXY` (`false | true | <cidr list>`) to `packages/env` and wire it to Fastify `trustProxy`; rate-limit keys: session → `sid`, api key → key id, review token → token id, public routes → client IP; `POST /v1/auth/*` per §11.

## 24. Bull Board at `/admin/queues` sits outside the per-route auth contract (low, spec-gap, S)

Evidence: `ARCHITECTURE.md` §5.11 "Bull Board at `/admin/queues` (admin only)"; `API.md` says a route without `config.auth` fails to register, but Bull Board is a mounted third-party UI outside `/v1`, and its job views show `run.start` payloads (run inputs, possibly PII, before write-time redaction has any bearing).

Fix: mount only when `FLOWAID_QUEUE_UI=true` (new env, default `false`), behind the session auth hook with scope `admin` and a system-workspace check, `helmet` CSP relaxed only for that prefix; or drop it in favour of `GET /v1/admin/queues` JSON (depth, oldest job age) rendered by the existing dashboard.

## 25. Artifact download and upload safety (low, spec-gap, S)

Evidence: `API.md` §3.9 `POST /v1/artifacts/upload-url` (presigned PUT), `GET /v1/artifacts/:id/download` ("signed redirect"); `artifacts.mime_type` is caller-supplied, `storage: 'local'` exists. An uploaded `text/html` artifact served inline from the api origin (local mode) is stored XSS with the session cookie in scope; nothing pins `Content-Type`/size into the presigned PUT.

Fix: downloads always `Content-Disposition: attachment` (`response-content-disposition` on the presigned GET), `X-Content-Type-Options: nosniff`; inline preview only for `image/png|jpeg|gif|webp`, `text/plain`, `application/json`; `storage_key` is server-generated `ws/<workspaceId>/<artifactId>` (never derived from `name`); presigned PUT signs `Content-Type` and `Content-Length` (max from workspace settings, default 100 MiB), and the row stays `pending` until a `POST /v1/artifacts/:id/complete` verifies size and sha256.

## 26. Auth flows that the schema implies but the API omits: invite acceptance, password reset, OIDC state/nonce/PKCE, MFA (medium, spec-gap, M)

Evidence: `DATABASE.md` `users.status` default `invited`, `users.mfa_secret_enc`; `API.md` `POST /v1/workspaces/:id/members { email, role }` creates members but no route lets an invited user set a password; no password reset; `GET /v1/auth/oidc/:provider/start|callback` with no `state`, `nonce` or PKCE mentioned; no MFA routes.

Fix: `user_tokens (id, user_id, kind: 'invite'|'password_reset'|'email_verify', token_hash unique, expires_at, used_at)` with 32-byte tokens delivered through the `notifications` email channel; `POST /v1/auth/invite/accept { token, name, password }`, `POST /v1/auth/password/reset-request { email }` (always 202), `POST /v1/auth/password/reset { token, password }` (bumps `token_version`); OIDC `start` stores `{ state, nonce, codeVerifier }` in a 10-min httpOnly `fa_oidc` cookie, `callback` verifies all three and links identities only for `email_verified` claims; MFA: either specify TOTP enrol/verify (`POST /v1/me/mfa/totp/enrol|verify|disable`, login returns `mfa_required` with a 5-min pre-auth cookie) in WP-27 or remove `mfa_secret_enc` from the first-slice schema so the column does not imply a feature.

## 27. `SECURITY.md` names variables that do not exist and gives no contact (low, docs, S)

Evidence: `SECURITY.md` "Set a strong `FLOWAID_ENCRYPTION_KEY` and `FLOWAID_JWT_SECRET`" — the real variables are `FLOWAID_MASTER_KEY`, `FLOWAID_JWT_PRIVATE_KEY`/`PUBLIC_KEY`; "Email the maintainers (see package.json `author`)" but `package.json` has no `author`; no `security.txt`.

Fix: rewrite the "Operating securely" section as a production checklist (https base URLs, `CORS_ORIGINS`, `DB_RLS` with the app role, master key backup, loopback-bound infra ports, `SANDBOX_MODE=container`, `MCP_STDIO_ENABLED=false`, `FLOWAID_TRUST_PROXY`), add a real contact (a `security@` address or the GitHub advisory URL) and `.well-known/security.txt` served by the web app; add a `docs.test.ts` assertion that every `FLOWAID_*` name mentioned in `SECURITY.md`/`README.md` exists in `ENV_VAR_NAMES`.

---

## Verified as sound (no finding)

- `packages/env`: secret values are never echoed in `EnvError` (`load.ts` `received` only when `doc.secret === false`, tested in `load.test.ts:87-89`); master key format is validated; `FLOWAID_MASTER_KEY` + non-default `_FILE` conflict is rejected; JWT keys must come in pairs.
- Dockerfiles: multi-stage, non-root `flowaid` user, `tini`, `--frozen-lockfile`, no build tools in runtime, api image without the sandbox dependency.
- `worker-code`: `read_only`, `no-new-privileges`, tmpfs `/tmp` (but see §2).
- `pnpm` build scripts restricted via `allowBuilds`; `pnpm audit --prod` clean on 2026-09-22.
- FlowExpr: no `eval`/`Function`; property access is own-property only (`hasOwnProperty`, `evaluator.ts:89,334`), so `__proto__`/`constructor` lookups return `undefined`/`null`; AST step and result-size budgets exist.
- `@flowaid/shared` ids use `crypto.getRandomValues`; hashes use `node:crypto` SHA-256.
- `.env*` files are git-ignored and none are staged.
- Design: envelope encryption with AAD, write-time redaction, SSRF guard with DNS pinning and redirect handling, raw-body HMAC with `timingSafeEqual`, argon2id, ES256, `api_keys` hashed lookups, credential values never returned by the API, retention by data class.
