# Review — design coherence

Scope: every file in `docs/design/` read completely (SPEC, ARCHITECTURE, CONTRACTS.ts, DATABASE, API, UI, IMPLEMENTATION_PLAN, CODE_EXPORT, LANGCHAIN, VERSIONS, TYPESAFE_API), `brand/IDENTITY.md`, `boundaries.json`, `eslint.boundaries.js`, `.env.example`, `docker/compose*.yml`, `README.md`, and the on-disk `packages/ui/src/**/index.ts` + `lib/categories.ts` + `types.ts` + `forms/schema.ts` + `node/nodeUtils.ts` + `node/nodeTypes.tsx` + `canvas/*`.

What is coherent and needs no work: `CONTRACTS.ts` ↔ `packages/workflow-core` (the `contracts-parity.test.ts` suite pins every exported name and the three closed enums; `ErrorCodeSchema`, `DiagnosticCodeSchema`, `NodeCategorySchema`, `RunOriginSchema`, `TimerPurposeSchema`, `UiHintsSchema` all match verbatim). The run/event model, DATABASE projections table, API §4 run flow and ARCHITECTURE §5 agree with each other. The findings below are the places where the documents contradict each other, where the two addenda (CODE_EXPORT, LANGCHAIN) were not propagated into the base documents/configs, where an implementer would have to guess, and where `packages/ui` diverges from UI.md and CONTRACTS.

---

## A. Contradictions between documents and configs

### A1. `boundaries.json` / `eslint.boundaries.js` do not know about the addenda (high)

Evidence:

- ARCHITECTURE §1 / §1.1 list `codegen`, `langchain`, `nodes-langchain`, `apps/docs`; `boundaries.json` has none of them (`packages` keys end at `ui`, `api`, `worker`, `web`).
- LANGCHAIN.md §1/§6 and ARCHITECTURE §1.1 say `langchain`/`@langchain/*` imports are "enforced by the boundaries check" and "fail the build". `grep -i langchain boundaries.json eslint.boundaries.js scripts/check-boundaries.test.ts` returns nothing; the checker only knows `@flowaid/*` edges and Node built-ins (`browserSafe`).
- LANGCHAIN.md §3/§8 say the worker loads `nodes-langchain` as a plugin; `boundaries.json.packages.worker.allow` has no `langchain`/`nodes-langchain`.
- CODE_EXPORT §2/§4: `flowaid workflow run --local` executes the embedded runtime, i.e. the CLI needs `workflow-runtime`, `nodes-core`, `provider-*`, `sandbox`; `boundaries.json.packages.cli.allow` = `["workflow-sdk","workflow-compiler","workflow-core","shared"]`.
- CODE_EXPORT §6: the export job runs somewhere that imports `codegen`; neither `api.allow` nor `worker.allow` contains `codegen`.
- `boundaries.json.packages.worker.allow` also contains `evaluation`, `workflow-compiler`, `node-sdk`, `openapi-tools`, which ARCHITECTURE §1.1's `apps/worker` line omits (the config is right; the doc is stale).

Enhancement: add `codegen`, `langchain`, `nodes-langchain` (and `docs` under `apps/docs`) to `boundaries.json` with the §1.1 edges; add `codegen` to `worker.allow` (export job runs in the worker, see A3); add `workflow-runtime`, `nodes-core`, `provider-typesafe|openai|anthropic|ollama`, `sandbox`, `credentials` to `cli.allow` (needed by `--local`); add `langchain`, `nodes-langchain` to `worker.allow`. Extend the schema with an optional per-package `externalAllow: string[]` (or a top-level `thirdParty: { "langchain|@langchain/*": ["langchain","nodes-langchain","importer","codegen","worker"] }`) and make `eslint.boundaries.js` emit a `no-restricted-imports` pattern for `langchain`, `@langchain/*` in every other package, plus a `check-boundaries.test.ts` case that a `@langchain/*` dependency in any other `package.json` fails. Update ARCHITECTURE §1.1 `apps/worker` line to the actual allow list.

### A2. The FlowAId importer has three names (medium)

- ARCHITECTURE §1 tree: `importer/` (odd spacing), §1.2/§10.9 `@flowaid/importer`, §10.9 heading "FlowAId importer" (FlowAId is _this_ product; it imports _external_ flows).
- `boundaries.json`: `"importer": { "dir": "packages/importer" }`, and `api.allow` lists `importer`.
- LANGCHAIN.md §1/§4, README §LangChain, IMPLEMENTATION_PLAN WP-23: `packages/importer/src/langchain-map.ts`, `@flowaid/importer`.
- SPEC: "FlowAId importer isolated (FlowAIdImporter → CanonicalWorkflowDefinition…)".

Enhancement: one name — `packages/importer` / `@flowaid/importer` (majority). Rename the `boundaries.json` key and `api.allow` entry; fix the tree spacing in ARCHITECTURE §1; retitle §10.9 and D27 "FlowAId importer" and the export `importExternalFlow()`; keep a note in SPEC that "FlowAId importer" in the original text means the FlowAId importer.

### A3. Code export needs a jobs/artifact model that does not exist (high)

- API.md §9 / CODE_EXPORT §4: `POST …/export/package → 202 { job_id }`, `GET /v1/jobs/:id → { status, artifact_id?, error? }`, `GET /v1/artifacts/:id/download`.
- DATABASE.md has no `jobs` table; `queue_jobs` is "PgQueueDriver only", its `id` is a deterministic string and it does not exist under BullMQ. CONTRACTS §17 `Job` union has no export variant and `QueueName` has no queue for it. `artifacts.kind` enum is `['output_overflow','file','upload','log']` (no export). API §3.9 gives `GET /v1/artifacts/:id/download` scope `runs:read`; API §9 says "owner scope"; the export itself is `workflows:read`. API §7 DTO list has no `Job`.
- `POST /v1/workflows/:id/versions/:versionId/export/package` is absent from the §3 route catalogue (only in the §9 addendum table).

Enhancement: add to DATABASE.md `jobs(id uuid v7 pk, workspace_id, kind text 'export.package'|…, status queued|running|completed|failed, payload jsonb, artifact_id uuid null, error jsonb ErrorInfo null, created_by text, created_at, started_at, ended_at, expires_at)` with `jobs_ws_created_idx`; add `Job` variant `{ type: 'export.package'; jobId; workspaceId; workflowId; versionId: string | 'draft'; mode; includeSampleFromRunId?; includeRecordedRunId?; requestedBy }` and `QueueName 'jobs'` to CONTRACTS §17 (RFC per Wave-0 freeze rule); add `'export'` to `artifacts.kind`; specify download authorisation as: `artifacts.run_id` set ⇒ `runs:read`, `kind='export'` ⇒ `workflows:read` on `details.workflowId` (store `workflow_id` on the artifact row); add the `Job` DTO to API §7 and the two routes to §3.3; add `jobs` to the retention table (7 d, artifact cascades). Worker consumes `jobs` (A1 adds `codegen` to `worker.allow`).

### A4. Two export routes, two version-addressing styles, a non-uuid `versionId` (medium)

- API §3.3: `GET /v1/workflows/:id/export?versionId&format=json|yaml`.
- API §9 + CODE_EXPORT §4: `GET /v1/workflows/:id/versions/:versionId/export?format=json|yaml|ts` and `POST /v1/workflows/:id/versions/:versionId/export/package`, with `versionId = 'draft'`.
- Everywhere else versions are top-level: `/v1/workflow-versions/:versionId[/diff|/restore-draft|/run]`; `:versionId` params are `z.uuid()`.
- Import likewise exists twice: `POST /v1/workflows { import?|external? }` and `POST /v1/workflows/import { definition|yaml|external }`.

Enhancement: delete the §3.3 export row and the §9/CODE_EXPORT nested form; specify `GET /v1/workflow-versions/:versionId/export?format=json|yaml|ts`, `POST /v1/workflow-versions/:versionId/export/package`, plus `GET /v1/workflows/:id/draft/export?format=` and `POST /v1/workflows/:id/draft/export/package` for the draft (compiles first; 422 with diagnostics). Keep `:versionId` strictly uuid. Keep `POST /v1/workflows/import` and drop the `import?|external?` fields from `CreateWorkflowRequest` (or vice versa). Update CLI `--version n|draft` mapping accordingly.

### A5. The SDK builder surface is named four different ways and is incomplete for codegen's totality guarantee (medium)

- ARCHITECTURE §1.2: `defineWorkflow()`, `ref()`; API §8 example uses `node(...)`, `obj(...)`, `ref('start','message')`; CODE_EXPORT §1: `defineWorkflow()/ref()/obj()/tpl()`; IMPLEMENTATION_PLAN WP-17: `defineWorkflow()/ref()/obj()/tpl()`.
- CODE_EXPORT §3 requires "every node kind, binding kind, policy, container, control edge, secret and variable is representable; the generator is total over `WorkflowDefinitionSchema`" — there is no builder named for `branch`, `join`, `loop`, `foreach`, `subflow`, `wait`, `human`, `output`, `note`, `expr`, `lit`, `arr`, control edges, triggers or layout.

Enhancement: add an "SDK builders" subsection to API.md §8 (and mirror in ARCHITECTURE §1.2) that fixes the list: `defineWorkflow`, `input`, `output`, `task`, `branch`, `join`, `loop`, `foreach`, `subflow`, `wait`, `human`, `note`, `edge`, `ref`, `lit`, `tpl`, `expr`, `obj`, `arr`, `secret`, `variable`, `trigger`; every builder returns the CONTRACTS node/binding shape unchanged (no extra normalisation), so `definitionHash(defineWorkflow(...)) === definitionHash(json)` is testable; codegen imports the same list.

### A6. `runLocally` in `workflow-runtime` contradicts the dependency DAG (high)

- CODE_EXPORT §2: `runLocally` in `@flowaid/workflow-runtime` "builds a registry from the plan's model refs + env credentials", "code nodes use IsolatedVmSandbox when @flowaid/sandbox is installed", executes every pool in-process.
- ARCHITECTURE §1.1 + `boundaries.json`: `workflow-runtime → workflow-core, workflow-compiler, node-sdk, providers, credentials, observability, shared, env` — no `nodes-core`, no `provider-*`, no `sandbox`, no `mcp`. The runtime cannot resolve executors or concrete providers by itself.

Enhancement: keep the runtime free of node/provider packages. Define `runLocally(planOrDefinition, opts: LocalRunOptions & { nodes: NodePackage[]; providers: ProviderRegistry; sandbox?: SandboxExecutor })` with **no defaults** for `nodes`/`providers`; the generated `src/run.ts` / `src/serve.ts` (codegen templates) and the CLI `--local` command do the wiring (`corePackage`, `provider-*` factories, `IsolatedVmSandbox` when present). Update CODE_EXPORT §2, the `LocalRunOptions` interface, and `cli.allow` (A1).

### A7. `nodes-langchain` "loads as a plugin" but the plugin model only knows npm/local installs (medium)

- LANGCHAIN.md §3: built with `definePackage` "exactly like a third-party plugin… worker loads it as a plugin"; node ids `@flowaid/nodes-langchain.langchain.chat` (valid under `NodeTypeIdSchema`).
- ARCHITECTURE §3.5: plugins arrive via `flowaid plugin add <pkg>` into `FLOWAID_PLUGIN_DIR`, manifests stored in `plugins.manifest`; DATABASE.md: `plugins.source` enum `['npm','local']`, column named `manifests`; `apps/api` serves `GET /v1/nodes` from core manifests + `plugins` rows. Nothing registers a workspace package that is already in the monorepo/image, so the API never sees the LangChain manifests and `E_UNKNOWN_NODE_TYPE` fires for the RAG template.
- `ProviderAvailability`/`GET /v1/providers` are fed from `ProviderRegistry`; `NodePackage.providers` (the `langchain:<vendor>` factories) need to reach both.

Enhancement: add `'bundled'` to `plugins.source`; env `FLOWAID_BUNDLED_PLUGINS` (default `@flowaid/nodes-langchain`, documented in `packages/env/src/docs.ts`); worker boot resolves each bundled package, runs `toManifest`, upserts a global `plugins` row (`workspace_id NULL`, `status='enabled'`, `integrity` = package version) so the API serves its manifests and provider descriptors; `plugins` rows of `source='bundled'` are read-only in the API (`PATCH` may only toggle `status`). Rename `plugins.manifest` → `manifests` in ARCHITECTURE §3.5. State in `GET /v1/providers` that plugin-registered provider ids (`langchain:openai`, …) are included and that their `credentialType` maps to the existing catalog types.

### A8. Audit actor and principal enums disagree (low)

- API §1 `Principal.type`: `user|api_key|review_token|mcp_token|system`; `AuthMode` includes `webhook`.
- DATABASE.md `audit_events.actor_type`: `['user','api_key','review_token','system']` — no `mcp_token`; nothing says what actor a webhook-created run is audited as.

Enhancement: add `mcp_token` and `webhook` to `audit_events.actor_type` and `webhook` to `Principal.type` (`id` = webhook row id, scopes = `{runs:create}` pinned to that workflow/environment).

### A9. `credentials.provider` mixes master-key providers with secret stores (low)

- DATABASE.md: `credentials.provider enum ['db','env','file','aws','azure','gcp','vault']`.
- ARCHITECTURE §10.6: master key providers are `env | file | aws-kms | vault-transit` (stored in `encryption_keys.master_provider`); external secret references are `env:NAME | vault:path#key | aws-sm:arn`. `file` is a master-key provider, not a place a credential value lives.
- ARCHITECTURE §7 mentions a `kv` table "for tool token caches" that DATABASE.md does not define and the entity list omits.

Enhancement: replace `credentials.provider` with `storage: 'db' | 'external'` and define `external_ref` prefixes `env:`, `vault:`, `aws-sm:`, `azure-kv:`, `gcp-sm:`; delete the `kv` mention (MCP OAuth tokens are credentials per §10.2; `state_entries` covers everything else).

### A10. Session JWT pins a workspace, yet workspace is also selected per request (medium)

- API §1: JWT claims `sub, ws, role, sid`; "Multi-workspace users select with `X-Workspace: <slug>`"; web routes are `(app)/[ws]/…`.
  If `ws`/`role` are in a 15-minute token, switching workspace in the UI requires a re-login or a refresh; the header and the claim can disagree.

Enhancement: JWT carries `sub` and `sid` only; the workspace is resolved per request from `X-Workspace` (or the `[ws]` route segment forwarded by the web app), defaulting to the user's most recent workspace; role from `memberships` per request (cache 60 s per `sid`). `SessionResponse.workspaces[]` already lists the options.

### A11. MCP exposure tokens are per exposure but the MCP endpoint is per workspace (medium)

- DATABASE.md `mcp_exposures` has `token_hash` per row; API §3.7 `/mcp/:workspaceSlug` serves `tools/list` for _all_ exposed workflows under the `mcp_token` principal. A client holding exposure A's token would list/call B, or the server must filter — unspecified.

Enhancement: token belongs to the principal, not the exposure: mint MCP tokens as `api_keys` rows with `is_service_account=true`, scope `mcp:serve`, `workflow_ids` pinned to the exposed workflows; `tools/list` returns only exposures whose `workflow_id ∈ principal.workflowIds`; drop `mcp_exposures.token_hash` (keep `enabled`, `tool_name`, `description`). Update `POST /v1/mcp/exposures` to return the key once, like `ApiKeyCreated`.

### A12. Confidence-gate semantics differ between ARCHITECTURE and the UI package (medium)

- ARCHITECTURE §6.3: `flowaid.decision.confidence_gate` config `threshold` (bindable), `requireValue?`, `reviewBand?`; control-outs `pass | review | fail`.
- `packages/ui/src/types.ts` `ConfidenceThresholds { review, auto }`, `gateOutcome → 'auto' | 'review' | 'human'`; `node/ConfidenceGateNodeCard` `DEFAULT_GATE_THRESHOLDS`; `decision/gate.ts` `GATE_ORDER`, `validateThresholds`.

Enhancement: define once (ARCHITECTURE §6.3, copied into the node's `configSchema` description): `confidence ≥ threshold ⇒ pass`; `threshold − reviewBand ≤ confidence < threshold ⇒ review`; otherwise `fail`; `requireValue: true` additionally routes `fail` when a boolean decision's `value` is false. UI adapts: `auto := threshold`, `review := threshold − reviewBand`, outcome names `pass|review|fail` (rename `GateOutcome`, labels stay human-readable).

### A13. Triggers exist twice: in the definition and as tables, with no materialisation rule (medium)

- CONTRACTS `WorkflowDefinition.triggers[]` (webhook path, schedule cron, mcp toolName, event) is versioned with the definition; DATABASE.md has `webhooks`, `schedules`, `mcp_exposures` rows keyed by `(workflow_id, environment_id)` with extra fields (`secret_credential_id`, `callback_url`, `enabled`). API §3.9 has full CRUD on those tables; UI.md §1 workflow settings edits "triggers"; `E_TRIGGER_CONFLICT` exists but is not assigned to a pass. `Trigger.type='event'` has no route that starts a run from an event (`POST /v1/runs/:id/events/:eventName` only resolves a `wait`).

Enhancement: write the rule in ARCHITECTURE §8: on `PUT …/deployments/:environmentId` the API materialises `plan.triggers` into rows for that environment (upsert by `(workflow_id, environment_id, path|cron|tool_name)`), disables rows whose trigger disappeared, and raises `E_TRIGGER_CONFLICT` (422) when a webhook `path` or `tool_name` collides with another workflow in the workspace; the CRUD routes only edit environment-specific fields (`secretCredentialId`, `callbackUrl`, `allowedHeaders`, `enabled`) and refuse `path`/`cron`/`toolName` changes (409). Either add `POST /v1/events/:eventName { payload }` (starts runs of every deployed workflow with an `event` trigger of that name, scope `runs:create`) or remove `event` from `TriggerSchema` for v1.

### A14. The two addenda changed the first-slice release gate silently (medium)

- IMPLEMENTATION_PLAN: WP-16 (`apps/worker`) "needs 09,12,13,13c,14" — 13c is `nodes-langchain`; the critical-path diagram makes LangChain a prerequisite of the worker, and WP-20's acceptance gate now includes "Download code" (CODE_EXPORT §5). SPEC "First vertical slice" lists neither; ARCHITECTURE §12.5 ("deliberately not in the first slice") does not mention LangChain either way.

Enhancement: state the decision in ARCHITECTURE §12.5 and the plan: WP-16 depends on WP-13 only; WP-13b/13c move to Wave 5 (worker loads bundled plugins optionally, A7); keep WP-17b in Wave 4 as an owner requirement and list it in §12.4 explicitly. Renumber the diagram.

### A15. Small doc drifts worth a single sweep (low)

- DATABASE.md header: "`packages/database/src/schema/*.ts` split by section"; code comment and WP-03: `src/schema.ts`.
- ARCHITECTURE §3.5 `plugins.manifest` vs DATABASE `manifests` (fixed by A7).
- `HumanApprovalRequired.httpStatus = 202` is an _error_ class with a success status; API §4 says a suspended sync run returns `RunAccepted`, so the class is never on the wire. Document it as the internal signal the sync waiter converts, or drop `httpStatus`.
- Event `seq` numbering: `runs.last_seq default 0`, `EventBase.seq min(0)`, ephemeral events "seq 0" — state that durable `seq` starts at 1 (`RUN_CREATED` = 1) and 0 is reserved for ephemeral events; `?after` default 0.
- `NodeRunSchema.kind: z.string()` vs `PlanNodeSchema.kind` enum — use the enum.
- IMPLEMENTATION_PLAN says contract changes go through `docs/rfcs/`; the directory does not exist (create it with a template, since A3 needs an RFC).
- `GET /v1/nodes/:typeId` — scoped ids contain `/` (`@community/slack.post_message`); require `encodeURIComponent` in the docs/SDK or use `?id=`.

---

## B. Under-specified areas an implementer must guess

### B1. First boot, default workspace, slugs (high)

- ARCHITECTURE §12.4: first boot creates the owner from `FLOWAID_ADMIN_EMAIL/PASSWORD`; `.env.example` ships both **commented out**, so the SPEC acceptance path (`cp .env.example .env; docker compose up` → login) has no user to log in as.
- Workspace slug is the routing key for `X-Workspace`, `/mcp/:workspaceSlug`, `/hooks/:workspaceSlug/:path`, `(app)/[ws]/`; the default workspace's slug, a slug regex, and `workflows.slug` generation (used in `flowaid-<workflow-slug>-v<n>.zip`) are all unspecified; `PatchWorkflowRequest` cannot change `slug`.

Enhancement: `SlugSchema = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/` in API §7; default workspace `{ name: 'Default', slug: 'default' }`; `workflows.slug = slugify(name)` with `-2`, `-3` suffix on collision, changeable via `PATCH { slug }` (409 when a webhook/exposure references the old one); first boot with no users and no `FLOWAID_ADMIN_*`: create `owner@flowaid.local` with a generated password printed once to the api log and `users.status='invited'` forcing a password change on first login. Uncomment `FLOWAID_ADMIN_EMAIL/PASSWORD` in `.env.example` with working values.

### B2. Auth flows beyond login/refresh (medium)

Missing from API §3.1: invitation acceptance (`MemberRequest { email, role }` creates `status='invited'` users with no way to set a password), password reset, MFA (column `users.mfa_secret_enc` exists, no route), `GET /.well-known/jwks.json` (mentioned only in env docs), OIDC configuration (no env vars; `identities` table exists; ARCHITECTURE §12.5 says OIDC is _not_ first slice but UI.md §1 routes `(auth)/oidc/callback` and the login page has an OIDC button).

Enhancement: add routes `POST /v1/auth/invitations/:token/accept { name, password }`, `POST /v1/auth/password/forgot { email }` + `/reset { token, password }` (tokens hashed, 1 h, single use, in a small `auth_tokens` table), `GET /.well-known/jwks.json` (public); mark MFA as Wave 6 and drop the column from `0001_init`; add `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` to `packages/env` behind `features.oidc` (B3) so the login button and callback route render only when configured.

### B3. Feature flags are referenced everywhere and defined nowhere (medium)

`MeResponse.features: Record<string, boolean>` (API §3.1), "Navigation entries render only when `features[<key>]` is true" (UI.md §1), "derived from what the API has enabled" (ARCHITECTURE §9). No key list, no derivation rule.

Enhancement: define `FeatureKey` enum in API §7: `workflows, runs, human_tasks, templates, integrations_mcp, integrations_openapi, integrations_providers, integrations_plugins, knowledge, evaluations, credentials, settings_audit, settings_notifications, agents, ai_builder, code_export, langchain, oidc, schedules`; derivation = release constant (`FEATURES_SHIPPED`) ∧ env toggles (`FLOWAID_FEATURES_DISABLED=` list) ∧ runtime conditions (`oidc` iff configured, `langchain` iff the bundled plugin is enabled, `code_export` iff `FLOWAID_EXPORT_MODE` resolvable). Add `FLOWAID_EXPORT_MODE` and `FLOWAID_FEATURES_DISABLED` to `packages/env/src/docs.ts` and `.env.example`.

### B4. Pagination and list conventions (low)

API §2 says keyset cursors; the cursor encoding and sort keys are undefined; several list routes return bare arrays (`/v1/nodes`, `/v1/credentials`, `/v1/providers`, `/v1/workflows/:id/deployments`, `/v1/mcp/servers/:id/tools`) while others return `{ items, next_cursor }`; the DTO section does not say which is which.

Enhancement: `cursor = base64url(JSON.stringify([sortValue, id]))`, opaque to clients, valid indefinitely; sort keys per route (runs: `created_at desc, id desc`; workflows: `updated_at desc`; human-tasks: `created_at desc`; audit: `at desc`; evaluation cases: `ordinal asc`); enumerate the paginated routes; every other list is a bare array capped at 1 000 items.

### B5. Rate limits: per-key override has no storage (low)

API §1 "api key 1 200/min (override per key)"; `api_keys` has no rate-limit column; `CreateApiKeyRequest` has no field; `.env.example` `RATE_LIMIT_MAX=600` with "api keys get double, webhooks half". SSE connections and `/mcp` are not covered.

Enhancement: `api_keys.rate_limit_per_min integer null` + DTO field; SSE streams do not count against the request bucket but are capped at 20 concurrent per principal (429 `RATE_LIMIT_ERROR`); `/mcp/:slug` uses the api-key bucket; `/v1/review/*` 60/min per token.

### B6. SSE reconnection edge cases (medium)

API §5 defines `Last-Event-ID` replay but not: (a) what happens when the client's last id predates retention/partition drop; (b) how a client recovers streamed text after a reconnect (deltas are ephemeral, output persists only on completion); (c) client backoff; (d) `?until=never` termination; (e) that `seq` 0 is reserved (A15).

Enhancement: add API §5.1 "Reconnection": server sends `retry: 2000`; client backoff 1 s → 30 s with jitter (`useRunStream`, `RunHandle.stream()`); if `Last-Event-ID` < the run's oldest retained seq the server replies 404 `NOT_FOUND{ details.reason: 'expired' }`; `GENERATION_DELTA.index` is the cumulative character offset so a client can detect a gap, and on reconnect the UI re-reads `GET /v1/runs/:id/node-runs?nodeId=` and shows "stream resumed, partial text unavailable" for nodes still `running`; `?until=never` ends only on client close or run purge.

### B7. `Idempotency-Key` TTL vs the permanent unique index (low)

API §2/§4: 24-hour idempotency per workspace; DATABASE.md `runs_idem_uq` is unique on `(workspace_id, idempotency_key)` with no time bound, so a key reused after 24 h hits the unique constraint instead of creating a new run.

Enhancement: nightly sweep sets `idempotency_key = NULL` where `created_at < now() - 24h` (add a row to the retention table) — or replace the index with `(workspace_id, idempotency_key, created_at::date)`. Document the chosen behaviour in API §4.

---

## C. `packages/ui` versus UI.md and CONTRACTS.ts

### C1. UI enums are still local copies and disagree with `workflow-core` (high)

UI.md §3 and IMPLEMENTATION_PLAN WP-01 "Also" say `packages/ui/src/lib/categories.ts` re-exports `NodeCategorySchema.options`, `RunStatusSchema.options`, `NodeRunStatusSchema.options`. On disk:

- `lib/categories.ts:53-62` `NODE_RUN_STATUSES = pending|running|retrying|waiting_for_human|completed|failed|skipped|cancelled`; CONTRACTS `NodeRunStatusSchema = pending|running|waiting|retry_wait|completed|failed|skipped|cancelled|reused`. `retry_wait`, `waiting`, `reused` render as unknown.
- `types.ts:170-194` `RunEventType` contains `RUN_QUEUED`, `GENERATION_CHUNK`, `CHECKPOINT_SAVED`, `LOOP_ITERATION` (none exist) and lacks ~25 real types (`RUN_CREATED`, `GENERATION_DELTA`, `CHECKPOINT_CREATED`, `LOOP_ITERATION_STARTED/COMPLETED`, `JOIN_ARRIVED`, `NODE_WAITING`, `DECISION_REQUESTED`, …). `trace/summarizeEvent.ts` families are built on it.
- `types.ts` `RunView.trigger = api|manual|webhook|schedule|replay|evaluation` vs `RunOriginSchema` (`ui`, `mcp`, `subflow`, `restart`, `fork` missing; `manual` does not exist); `data/FilterBar.tsx:42` `RUN_TRIGGERS` likewise.
- `types.ts` `RunView.environment = development|staging|production`, `shell/EnvironmentSwitcher.tsx:7-11` `ENVIRONMENTS`, `data/FilterBar.tsx:41` `RUN_ENVIRONMENTS` — DATABASE.md seeds `dev|staging|prod` and environments are user-extensible rows.
- `packages/ui/package.json` has no `@flowaid/workflow-core` dependency, so `scripts/check-boundaries.test.ts` passes trivially while `boundaries.json` allows the edge.

Enhancement: add `@flowaid/workflow-core` as a dependency of `@flowaid/ui`; `lib/categories.ts` becomes `export const NODE_CATEGORIES = NodeCategorySchema.options` (same for run/node-run statuses and `RunOriginSchema.options`), keeping only the label maps; `type RunEventType = RunEvent['type']`; environments are data (`EnvironmentSwitcher` and `FilterBar` take `environments: { id, name, protected }[]` props; `EnvironmentId = string`). Add a test that every `STATUS_LABEL`/`TRIGGER_LABEL` map covers the schema options.

### C2. Inspector form hints use `x-flowaid` and a different widget vocabulary (high)

- CONTRACTS §1 `UiHintsSchema` lives under `'x-ui'` with widgets `text, textarea, template, code, json, number, slider, switch, select, combobox, model, criteria, levels, questions, keyvalue, list, schema, cron, binding, hidden` and fields `showWhen`, `optionsProvider`, `bindable`, `collapsed`, `min/max/step`, `help`, `group`, `order`; UI.md §5 widget table is written against `x-ui`.
- `packages/ui/src/forms/schema.ts:40` reads `schema["x-flowaid"]`; `types.ts:275-300` `FieldHints` widgets `text, textarea, number, slider, switch, select, radio, expression, credential, model, code, json, secret, keyvalue, threshold, criteria`, fields `advanced`, `credentialType`, `modelKind`; no `showWhen`, `optionsProvider`, `bindable`.

Enhancement: `forms/schema.ts` reads `'x-ui'` typed as `UiHints` from workflow-core; delete `FieldHints`; register widgets for `template` (CodeMirror with `{{ }}` regions — `ExpressionTextarea` already has `findExpressionRegions`), `combobox` (async via `optionsProvider` → `POST /v1/nodes/:type/options/:name` callback prop), `levels`, `questions`, `list`, `schema` (editable `SchemaTree`), `cron`, `binding` (`BindingField`: literal ⇄ ref/template/expr), `hidden`; map `advanced` → `collapsed`; keep `threshold`, `radio`, `secret`, `credential` only as _registered extensions_ used by non-manifest forms (credential dialogs), not as `x-ui.widget` values; implement `showWhen` and `bindable` in `SchemaForm`. Credential slots are not config fields: render `NodeManifest.credentials[]` as `SecretSlotPicker` above the form (new component, distinct from `CredentialPicker`).

### C3. View-model types diverge from CONTRACTS where the docs say components take the real shapes (medium)

- `DecisionResultView` (`types.ts`): `confidence` documented as "boolean → P(yes)" (CONTRACTS: `max(pYes, 1−pYes)`, plus `pYes`), `legend` instead of `levels/levelLabel/level/normalized`, `usage.costUsd` instead of top-level `costUsd`, `failover:{from,reason}` instead of `attempts[]`, no `requestId`. WP-08 done-criterion: "decision components render real `DecisionResult`s".
- `ApprovalKind = approve_reject|select|edit_output|provide_text|form`, `ApprovalResponse` kinds incl. `provide_text`, `escalate.to: string` vs CONTRACTS `HumanRequest.mode.type = approval|review|form|choice`, `HumanResponse.action = approve|reject|choose|submit|escalate` (`to: string[]`).
- `WorkflowVersionView.status = draft|published|production|archived` vs `workflow_versions.kind = published|draft` + deployments.
- `WorkflowNodeView.type` documented as `"decision.choice"`; real ids are `flowaid.decision.choice`.
- Trace: UI.md §7.1 `Span` from `buildTimeline()`; `trace/traceRows.ts` builds rows from `NodeRunView[]`.

Enhancement: components accept CONTRACTS types directly where the shape is pure JSON (`DecisionResult`, `HumanRequest`, `HumanResponse`, `Span`, `RunEvent`, `Diagnostic`); keep thin view types only for joins the API does not return (`RunView.workflowName`); ship `lib/adapters.ts` (`toDecisionView` deleted; `spanToTraceRow`, `humanTaskToApproval`) with unit tests; README "Mapping runtime types" section reduced to the joins.

### C4. Two diff engines and two command palettes in the UI package (medium)

- `inspector/diff.ts` (`summarizeWorkflowDiff`, `changedPaths`, `diffTextLines`) and `builder/versionDiff.ts` (`summarizeVersionDiff`, `diffLines`) both diff workflow definitions; ARCHITECTURE §4.7 makes `diff(a,b): WorkflowDiff` a compiler export and API §3.3 serves it (`GET /v1/workflow-versions/:id/diff/:other`).
- `primitives/CommandPalette` and `shell/CommandMenu` are two ⌘K implementations; UI.md §3 lists one `CommandPalette` under `builder`.

Enhancement: `VersionCompare`/`WorkflowDiffSummary`/`SideBySideDiff` take `WorkflowDiff` (type from workflow-core) as props; delete `summarizeWorkflowDiff`/`summarizeVersionDiff`/`changedPaths` (keep the text-diff helpers for JSON views). Keep `shell/CommandMenu` (pages, recents) and delete `primitives/CommandPalette`.

### C5. Canvas projection contract not implemented as specified (medium)

- UI.md §3/§4.2: XYFlow `nodeTypes = { flowaid: NodeCard, container, note }`, `edgeTypes = { control: ControlEdge, data: DataEdge }`, handle ids exactly `out:<port>`, `in:<port>`, `ctl:<port>`, `ctl-in`.
- On disk: `node/nodeTypes.tsx:85-104` registers 18 card kinds keyed by `NodeKind = start|end|decision|generation|tool|http|human|branch|router|gate|loop|subflow|code|agent|safety|state|retrieval|default` (`nodeUtils.ts:8-28`) — these are card _variants_ derived from type ids (`nodeKindFor`), not CONTRACTS `NodeKind = input|output|task|branch|join|loop|foreach|subflow|wait|human|note`; there is no `join`, `foreach`/`ContainerFrame`, `wait` or `note` card; `canvas/WeightedEdge.tsx:104` `edgeTypes = { weighted }`; `canvas/types.ts:57` `portKey = "<node>:<port>"`; sample edges use `sourceHandle: "out"`, `targetHandle: "in"`.

Enhancement: rename `NodeKind`→`NodeCardVariant` and `nodeKindFor`→`cardVariantFor(node: WorkflowNode, manifest?)` (kind first, then `manifest.decision.kind`/category); add `JoinNodeCard`, `WaitNodeCard`, `NoteCard`, `ContainerFrame` (group node with `NodeResizer`, header with bounds/iteration badge); export `nodeTypes = { flowaid, container, note }` where `flowaid` dispatches on the variant; add `ControlEdge` (dashed, arrowhead, label, fired/pruned tint) and `DataEdge` (solid; dotted when `via !== 'ref'`) and `edgeTypes = { control, data }` (keep `WeightedEdge` as the decision-router styling of `ControlEdge`); handle ids per UI.md §4.2 (`handleId('out', port)` helpers, `portKey` removed).

### C6. UI.md §3 component inventory does not match the package (high)

Present under another name/group (rename or fix the doc): `Chip`→`StatusChip`; `Toast`→`Toaster`/`toast`; `ConfidenceChip`→`ConfidenceMeter`+`GateBadge`/`DecisionBadge`; `DistributionPopover`→`DistributionList` (no popover); `Timeline`→`TraceTimeline`; `EventList`→`EventLog`; `LeftNav`→`SideNav`; `JsonViewer`→`JsonView` (in `inspector`, doc says `data`); `DiffView` in `inspector` (doc: `data`); `StatTile`→`MetricTile`; `TaskCard`→`ApprovalCard`; `ExternalReviewPage`→`ReviewPage`+`shell/ReviewLayout`; `PaletteSheet`→`canvas/NodePaletteMenu`; `ProblemsOverlay`→`canvas/DiagnosticsBar`+`node/NodeDiagnosticsMarker`; `PortHandle`→`TypedHandle`; `CriteriaTable`→`CriteriaEditor`; `BottomPanel` in `shell` (doc: `builder`); `EmptyState` in `primitives` (doc: `shell`); `DecisionCard` in `decision` (doc: `trace`); `CommandPalette` in `primitives` (doc: `builder`).

Absent entirely (WP-18 scope): `ConfusionMatrix`, `CostBreakdown`, `PublishDialog`, `ConflictDialog`, `ExportDialog`, `ContainerFrame`, `NoteCard`, `NodeRunDetail`, `GenerationCard`, `RefPicker`, `PortRow`, `DependencyPanel`, `BindingField`, `TemplateEditor` (as a named widget), `LevelsList`, `QuestionsEditor`, `JsonSchemaEditor`, `SecretSlotPicker`, `ReviewForm` (per-mode; `ManualChoice`/`ProposedOutputEditor` cover two modes), `ControlEdge`/`DataEdge`, `SpanRow`/`SpanBar` (internal to `TraceTimeline` if at all).

Present but not in UI.md (and outside the first slice per ARCHITECTURE §12.5): `AIBuilderPanel`, `WorkflowCriticPanel`, `CostOptimizerPanel`, `ImportDialog`, `TemplateGallery`, `VersionCompare`, `EvaluationReport`, `MiniGraph`, `ThresholdMeter`, `ReviewQueue`, `ApprovalsTable`, `CredentialsTable`, `WorkflowsTable/Browser`, `RunsTable`, `DashboardFilters`, `ProviderHealthCard`, `Heatmap`, the chart set.

Enhancement: regenerate UI.md §3 from the fourteen `index.ts` files (a script `scripts/ui-inventory.ts` that emits the table and fails CI when the doc and the exports diverge), rename the handful where the doc's name is better (`SideNav`→`LeftNav` is not worth it; keep code names, fix the doc), move the misplaced components (`DiffView`, `JsonView` → `data`; `BottomPanel` → `builder`), list the absent components as WP-18 line items, and mark the Wave-6 panels (AI builder, critic, cost optimizer) as "exists in the library; not mounted until `features.ai_builder`".

---

## D. Suggested order

1. A1 + A2 (config fixes, unblock everything else) → 2. A3 + A4 + A6 + A5 (export/runtime model, one RFC) → 3. C1 + C2 + C5 (UI package aligned with contracts before WP-19 starts) → 4. B1 + B3 + A10 (first boot/auth/workspace, needed by WP-15) → 5. A7 + A14 (plugin loading, wave gating) → 6. the rest.
