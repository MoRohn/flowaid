# flowaid — Implementation plan

> **Sequencing superseded (2026-09-22).** The wave order below is retired: `docs/UPGRADE_PLAN.md` (machine-readable `docs/upgrade-plan.json`) is the authoritative, dependency-ordered phase list for the full system upgrade, and it starts from a fresh Phase 0 rather than resuming any wave. The work-package definitions (files, done criteria, tests) stay authoritative and are referenced by the plan's items; where the plan's item text and a WP paragraph differ, the plan wins.

Dependency-ordered work packages grouped into waves. Everything inside a wave can run in parallel once the previous wave's blocking packages are done ("needs" lists the exact prerequisites). Each package names its owner package/app, the files it produces, what _done_ means, and the tests that must exist before it is called done. Contracts (`CONTRACTS.ts`) are frozen at the end of Wave 0; changes afterwards go through an RFC in `docs/rfcs/` (template `docs/rfcs/0000-template.md`, index `docs/design/RFCS.md`) and a version bump of `@flowaid/workflow-core`.

Team lanes (suggested): **A** core + compiler, **B** runtime + database, **C** providers + nodes, **D** api + sdk + cli, **E** web + ui, **F** integrations (mcp, openapi, credentials, evaluation, observability).

Conventions for every package: TypeScript strict via `@flowaid/config` presets, ESLint boundaries per `ARCHITECTURE.md` §1.1, Vitest unit tests co-located (`*.test.ts`), 90 % line coverage on `workflow-core`, `workflow-compiler`, `workflow-runtime`, `providers`, `provider-typesafe`, `credentials`; `pnpm typecheck && pnpm lint && pnpm test` green in CI on every PR; no `any`, no `TODO` implementations, no placeholder UI.

---

## Wave 0 — foundations (blocks everything)

### WP-00 Repo scaffold and infrastructure

- **Where**: root, `docker/`, `packages/config` (exists), `packages/shared`, `packages/env`.
- **Files**: `pnpm-workspace.yaml` (exists), `turbo.json` (exists), `tsconfig.base.json` (exists), `eslint.boundaries.js` (dependency DAG rules), `vitest.workspace.ts`, `playwright.config.ts`, `docker/compose.yml` (postgres 16 + pgvector, minio, api, worker, worker-code, web), `docker/compose.scale.yml` (redis + worker replicas, `--profile scale`), `docker/Dockerfile.api|worker|web`, `.env.example`, `packages/shared/src/{json,result,ids,hash,time}.ts` (`uuidv7()`, `sha256Json()`, `stableStringify()`, `Result`), `packages/env/src/{schema,load}.ts` (`EnvSchema`, `loadEnv()`; every env var documented).
- **Done**: `pnpm install && pnpm build && pnpm test` green; `docker compose up` starts postgres/minio and the placeholder api/web images build; `eslint` fails on a forbidden import between packages.
- **Tests**: `shared` unit tests (uuidv7 monotonic ordering, stable stringify, sha256 vectors); `env` schema tests (missing/invalid vars fail fast with a readable message).

### WP-01 `@flowaid/workflow-core` — contracts

- **Files**: `src/{json,ids,bindings,expr/{lexer,parser,typer,evaluator,functions},template,manifest,policy,nodes,definition,decision,errors,human,run,events,diagnostics,plan,tools,providers,store,index}.ts` — split of `CONTRACTS.ts` by section headers plus the implementations declared there: `parseRef/formatRef`, `parseExpression/evaluateExpression`, `parseTemplate/renderTemplate`, `isSubschema/projectSchema`, `definitionHash`, `toFlowaidError`, `DecisionResultJsonSchema`.
- **Also**: `packages/ui/src/lib/categories.ts` switched to re-export enums from workflow-core (UI.md §3).
- **Done**: every schema in `CONTRACTS.ts` exported unchanged; `z.toJSONSchema` succeeds for `WorkflowDefinitionSchema`, `NodeManifestSchema`, `ExecutionPlanSchema`, `RunEventSchema`; the example workflow (`ARCHITECTURE.md` §2.9) and the three demos parse; the FlowExpr grammar in §2.3 is implemented exactly (no extra syntax).
- **Tests**: golden JSON fixtures parse/round-trip; expression suite (≥ 200 cases: precedence, lambdas, every function, bounded evaluation, `ExpressionError` paths); template scanner suite (escapes, filters, ranges); `isSubschema` table tests + fast-check properties (reflexive, transitive, `integer ⊆ number`, enum subset, unverified cases); `projectSchema` walks; error classes `toInfo` including `cause`; `definitionHash` ignores layout/metadata and key order.

---

## Wave 1 — parallel foundations (need WP-01)

### WP-02 `@flowaid/workflow-compiler`

- **Files**: `src/{compile,validate,passes/{schema,catalog,structure,bindings,dependency,guards,groups,types,environment,emit},portRules,batching,subset-check-binding,diff,migrate,index}.ts`, `fixtures/**` (one workflow per diagnostic code), `COMPILER_VERSION`.
- **Done**: all passes of `ARCHITECTURE.md` §4.1 with every `DiagnosticCode`; port rules §4.2; guard/exclusive-group algorithm §4.3 (incl. `E_CONTROL_AMBIGUOUS`, `I_CONTROL_AND`, `E_CONDITIONAL_DATA_DEP`); batch groups §4.4; hoisted container deps; race private subgraphs; `dataEdges`; deterministic `planHash`; `diff`, `migrateDefinition`, `checkBinding`; runs in a Web Worker bundle (no Node built-ins).
- **Tests**: fixture-per-diagnostic snapshot tests; plan snapshots for the example + 3 demos; property test "compile is deterministic" (same input ⇒ same planHash); guard-analysis unit tests (merge, AND-after-branch `labels` case, ambiguous fan-in, nested containers); browser bundle smoke test (vitest `environment: 'happy-dom'` importing the built ESM).

### WP-03 `@flowaid/database`

- **Files**: `src/schema.ts` (DATABASE.md verbatim, one file), `migrations/0000_init.sql`…`0003`, `src/{db,migrate,stores/{PgRunStore,PgQueueDriver,PgEventBus,PgArtifactIndex,PgCredentialRepository},repositories/*,projections,reproject,rls}.ts`, `scripts/seed-*.ts`; the shared `RunStore`/`QueueDriver`/`EventBus` contract suite is imported from `@flowaid/workflow-runtime/testing`.
- **Done**: `drizzle-kit generate` produces no diff against the checked-in migrations; `PgRunStore.appendEvents` implements fenced append + projections + `NOTIFY` in one transaction (DATABASE.md §Projections); `PgQueueDriver` (`SKIP LOCKED`, `LISTEN/NOTIFY`, timers polling) and `PgEventBus` pass the shared contract suite; `flowaid db reproject`; retention sweep queries; RLS migration.
- **Tests**: integration tests against a real Postgres (testcontainers or the compose db): fencing (two writers, second fails), projection equivalence (`project(events) ≡ rows`) on golden event logs, timer CAS, queue claim under concurrency (10 consumers, no double delivery), partial indexes, credential uniqueness with null environment.

### WP-04 `@flowaid/node-sdk`

- **Files**: `src/{defineNode,definePackage,toManifest,context,result,testing/{createTestContext,runNode},index}.ts`.
- **Done**: `toManifest` emits `x-ui`, `x-dataClass`, `x-secret` from Zod `.meta()`, port specs from object schemas (`.optional()` ⇒ `required:false`), `IdempotencySpec`, port rules, credential slots; `createTestContext` provides in-memory implementations of every `ctx` service and records events; `runNode` validates input/output like the runtime.
- **Tests**: manifest snapshots for a sample node; harness tests (capability gating throws `ForbiddenError`, events recorded, output validation errors).

### WP-05 `@flowaid/providers`

- **Files**: `src/{types,registry,catalog/{index,*.json},failover,health,rateLimit,accounting,llm-decision,rule-decision,openai-compatible,index}.ts`.
- **Done**: `ProviderRegistry`, `ModelCatalog` (pricing + aliases + snapshots), `FailoverChain` (hop rules §6.2, `PROVIDER_FAILOVER` callbacks, `human` hop signal), `HealthTracker` (windows, circuit breaker), token-bucket rate limiter, `LLMDecisionProvider` (§6.4) over a fake generation provider, `RuleDecisionProvider` (§6.5), OpenAI-compatible streaming client with SSE parsing and tool-call assembly.
- **Tests**: failover matrix (retryable vs non-retryable, unhealthy skip, human fallback); health/circuit timing with fake clocks; LLM adapter renormalisation, fuzzy-match rules, boolean/score math; SSE parser fixtures (chunked `data:` frames, `[DONE]`, usage chunk); pricing snapshot math.

### WP-06 `@flowaid/credentials`

- **Files**: `src/{cipher,masterKey/{env,file,awsKms,vault},service,redactor,types/{catalog,*.ts},index}.ts`.
- **Done**: AES-256-GCM envelope with AAD, KEK versions, rotate/re-wrap, `MasterKeyProvider` implementations, `CredentialService` over the injected `CredentialRepository`, `Redactor` (learned secret values + variants, pointer rules, data-class modes), credential type catalog (`typesafe.api_key`, `openai.api_key`, `anthropic.api_key`, `ollama.host`, `http.bearer`, `http.basic`, `http.api_key`, `http.header`, `oauth2.client_credentials`, `mcp.headers`, `github.token`, `aws.iam`, `postgres.dsn`) with `test()` probes.
- **Tests**: crypto vectors and tamper detection; rotation keeps ciphertext readable; redactor scrubs secrets in nested JSON, base64 and url-encoded forms; pointer/data-class rules; catalog schema validation.

### WP-07 `@flowaid/observability`

- **Files**: `src/{logger,tracer,metrics,timeline,traceReviewer,index}.ts`.
- **Done**: pino logger with redaction hook, OTel tracer/meter wiring, `METRICS` names §10.5, `buildTimeline()` (Span model UI.md §7.1), `TraceReviewer` (deterministic short-circuits + decision chain call).
- **Tests**: timeline builder on golden node-run sets (nested scopes, retries, reused); reviewer short-circuit table; metric name registry snapshot.

### WP-08 `@flowaid/ui` primitives, forms, decision visuals

- **Files**: `src/primitives/*`, `src/forms/{SchemaForm,widgets/*}`, `src/decision/{ProbabilityRuler,ConfidenceChip,DistributionPopover,CalibrationChart,ConfusionMatrix}`, `src/data/{DataTable,JsonViewer,DiffView}`, galleries per group.
- **Done**: every widget in UI.md §5 implemented against JSON Schema + `x-ui`; decision components render real `DecisionResult`s; light and dark verified in the gallery.
- **Tests**: Testing Library tests per widget (rendering from schema, validation, `showWhen`, bindable toggle); Playwright screenshots of galleries in both themes.

---

## Wave 2 — runtime, providers, core nodes (need WP-02…WP-06)

### WP-09 `@flowaid/workflow-runtime` — reducer, scheduler, orchestrator

- **Files**: `src/{state,reduce,ready,step,effects,orchestrator,recover,checkpoints,kinds/{task,input,output,branch,join,loop,foreach,subflow,wait,human},bindings/{resolve,render},batching,replay,timers,cancel,accounting,redaction,queue/{BullMqQueueDriver,RedisEventBus},testing/{MemoryRunStore,MemoryQueueDriver,MemoryEventBus,harness},index}.ts`.
- **Done**: `ARCHITECTURE.md` §5 in full: pure `initialState/reduce/ready/step`, effects performed after commit and idempotent, fenced appends through `RunStore`, checkpoints every 200 events / on release / before terminal, lease renew + reaper + `WORKER_LOST` handling by idempotency, exclusive-group readiness and eager pruning, all ten kinds, batch execution, durable retry timers, cancellation via flag + control channel + control job, human suspension/resume, task `suspend`/`resume`, recorded replay/restart/fork/retry-node, run-drain completion + `earlyExit`, bounds, redaction before persistence, artifact spill at 64 KiB, BullMQ driver + Redis bus.
- **Tests**: reducer property tests (replay determinism: any prefix of a golden log reduces to the same state; checkpoint+tail ≡ full reduce); golden traces per construct (branch/merge, AND-after-branch, ambiguous fan-in rejected at compile, join all/any/count/race with private subgraphs, loop with carry/exitWhen/exhausted, foreach with each failure policy and concurrency > 1 with two suspended iterations, subflow, wait delay/event/timeout, human approve/reject/edit/expire/escalate, task suspend/resume, retries with timers, cancellation while running and while waiting, early exit, no-output failure); crash-injection tests (kill between commit and effect; kill mid-node for safe/keyed/none); recorded replay reuse; both queue drivers pass the shared contract suite; memory stores mirror Pg behaviour (shared test suite).

### WP-10 `@flowaid/provider-typesafe`

- **Files**: `src/{client,schemas,mapping,provider,index}.ts`, `fixtures/*.json` (recorded responses from the verified API).
- **Done**: exact mapping §6.3 (`noul`/`choice`/`score`, `model = response.model`, `requestId`, pricing), client-side token guard, error mapping (401/422/429/529/5xx/network), batching, `GET /v1/models` discovery.
- **Tests**: contract tests against recorded fixtures for every question kind and error; live smoke test behind `TYPESAFE_API_KEY` (CI secret) asserting the response schema still matches; boolean confidence/probabilities math; state size guard.

### WP-11 `@flowaid/provider-openai`, `provider-anthropic`, `provider-ollama`

- **Done**: streaming, tools, structured output, embeddings (openai/ollama), error mapping, cache tokens, cost via catalog; presets for OpenAI-compatible vendors.
- **Tests**: recorded stream fixtures per provider; error mapping table; structured-output fallback paths.

### WP-12 `@flowaid/nodes-core` slice 1

- **Files**: `src/decision/{boolean,choice,score,batch,confidence_gate,router,consensus,validator}.ts`, `src/ai/{generate,structured_generate,embeddings}.ts`, `src/tools/http.ts`, `src/data/{transform,template,json,schema_validate,merge,filter,map,split,extract}.ts`, `src/dev/{log,assert,mock,metric}.ts`, `src/state/{get,set}.ts`, `src/safety/{guard,moderation,pii_detector}.ts`, `src/index.ts` (`corePackage`), `scripts/build-manifest.ts` → `dist/manifest.json`, `templates/{support-triage,github-issue-triage,research-agent}.json`.
- **Done**: every node declares idempotency, capabilities, credential slots, port rules as specified; decision nodes use `ctx.providers.decision(chain)` with the node's hop config and expose `decision`/`answers` ports typed by `DecisionResultJsonSchema`; HTTP node `idempotency.byConfig('/method')`; manifest build reproducible; the three templates compile with zero errors.
- **Tests**: harness tests per node (happy path, error mapping, routing ports, suspension for the `human` failover hop); manifest snapshot; template compile test.

### WP-13 `@flowaid/mcp` and `@flowaid/openapi-tools` + `nodes-core` slice 2 (`tools/mcp`, `tools/openapi`)

- **Done**: session pool, discovery + sanitisation + stdio policy (ported validators with attribution), workflow-as-tool builder; OpenAPI parse/derive/execute with arg coercion; tool signatures served for the compiler's `resolveTool`.
- **Tests**: MCP over an in-process test server (streamable HTTP), stdio policy table, sanitiser fixtures; OpenAPI fixtures (petstore 3.0 + a 3.1 doc with auth schemes), coercion table, executor request building and error mapping.

### WP-14 `@flowaid/sandbox` + `nodes-core` `tools/code`

- **Done**: `IsolatedVmSandbox` with limits and bridges; `ContainerSandbox` interface + docker implementation for `shell`; code node with `inputSchemaFromConfig`/`outputSchemaFromConfig` rules.
- **Tests**: memory/CPU limit enforcement, no host escape (`process`, `require` undefined), fetch gated by allow-list, output schema validation.

---

### WP-13b `@flowaid/langchain` and WP-13c `@flowaid/nodes-langchain` (see `LANGCHAIN.md`)

- **Needs**: WP-04, WP-05 (13b); WP-12, WP-13b (13c).
- **Done**: adapters in both directions with the callback handler feeding run events and accounting; the node package loads as a plugin in the worker; the "Knowledge assistant (LangChain RAG)" template compiles and runs in the golden-trace suite with fake models; boundaries check rejects `@langchain/*` imports outside the allowed set.
- **Tests**: adapter unit tests with fake `BaseChatModel`/`StructuredTool`; recorded `@langchain/openai` and `@langchain/anthropic` stream fixtures; harness tests per node; manifest snapshot; boundary violation test.

## Wave 3 — services (need WP-09, WP-10, WP-12, WP-03, WP-06)

### WP-15 `apps/api`

- **Files**: `src/{server,plugins/{auth,rbac,errors,rateLimit,audit,openapi},routes/{auth,workspaces,environments,apiKeys,nodes,tools,providers,models,workflows,versions,deployments,secrets,runs,stream,humanTasks,review,credentials,mcp,mcpServer,evaluations,knowledge,agents,templates,webhooks,hooks,schedules,plugins,audit,metrics,artifacts,health},services/*,dto/*}.ts`.
- **Done**: every route in `API.md` with Zod schemas and auth; run creation flow §4; SSE §5; human task respond (CAS + enqueue); cancel flag + control job; publish with evaluation gate; draft versions for builder runs; webhook ingress/callbacks; MCP server endpoint; OpenAPI 3.1 document generated and validated in CI; default-deny startup assertion.
- **Tests**: route tests with `fastify.inject` against a real Postgres and the memory queue (auth matrix per route, error envelope shape, pagination, If-Match, idempotency key, run sync/async outcomes, SSE replay with `Last-Event-ID`, human respond CAS 409, publish 422 with diagnostics/report); OpenAPI document snapshot + validation with `@readme/openapi-parser`.

### WP-16 `apps/worker`

- **Files**: `src/{main,pools,orchestratorHost,executors/{inProcess,pluginThread,delegated},pluginLoader,optionRunner,jobs/{schedule,ingest,evaluation,traceReview,retention},health}.ts`, `worker-code` entrypoint.
- **Done**: pools consumption per `WORKER_POOLS`, `worker_threads` plugin host with the JSON ctx proxy, delegated `node.exec`, reaper/timers/sweeps, option-provider runner, both queue drivers selectable by `REDIS_URL`, graceful shutdown (release leases).
- **Tests**: end-to-end run of the example workflow with fake providers through api → queue → worker on both drivers; plugin isolation test (plugin cannot access `process.env` or the DB); crash/restart test (SIGKILL mid-run, second worker recovers).

### WP-17 `@flowaid/workflow-sdk` and `@flowaid/cli`

- **Done**: generated types from `/v1/openapi.json`, `Flowaid` client, `RunHandle.stream()/wait()/cancel()` with `Last-Event-ID` resume (API.md §8.2 transport), the full builder set of API.md §8.1 emitting `WorkflowDefinition` (total over `WorkflowDefinitionSchema`); CLI generated from the `x-cli` extension per API.md §8.3 with `--json` output.
- **Tests**: SDK against `fastify.inject`-backed mock server (stream resume after disconnect, typed narrowing); builder emits definitions that compile; CLI snapshot tests.

---

### WP-17b `@flowaid/codegen` + code export (see `CODE_EXPORT.md`)

- **Needs**: WP-09, WP-12, WP-15, WP-17.
- **Files**: `packages/codegen/src/{generateWorkflowTs,generateRunner,generateServe,generateClient,generateReadme,generateEnvExample,generateExampleInput,generateTests,generateDockerfile,generatePackageJson,bundle,zip,index}.ts`; `packages/workflow-runtime/src/local.ts` (`runLocally`); API route + job + artifact download; CLI `workflow export|package`, `workflow run --local`; `@flowaid/ui/builder/ExportDialog`; `docker/Dockerfile.api` vendor tarball stage.
- **Done**: round-trip (`definitionHash` equal) on the example + 3 demo templates; an exported vendored package for the support-triage template installs offline and passes `pnpm validate && pnpm test`, and `pnpm flow` with real keys produces the same output shape as the server run.
- **Tests**: generator golden files; round-trip property on random valid definitions (fast-check over the fixtures' node kinds); API route + job flow; CLI snapshot; Playwright: Download code from the versions page.

## Wave 4 — product surfaces (need WP-15, WP-16, WP-08, WP-02)

### WP-18 `@flowaid/ui` node, canvas, inspector, builder, trace, human, shell groups

- **Done**: all components in UI.md §3 with galleries; `NodeCard` anatomy §6; container frames; edges; `SchemaForm` integration; `Timeline`/`SpanRow`/`NodeRunDetail`; `ReviewForm` per mode; shell.
- **Tests**: component tests + gallery screenshots (light/dark).

### WP-19 `apps/web` — auth, shell, workflows list, builder

- **Done**: routes UI.md §1 (auth, shell, workflows, builder with store UI.md §4, Web Worker compile, palette, inspector, bottom panel with run + live SSE overlay, publish dialog with diff/warnings/report, conflict dialog, save/If-Match), templates/new.
- **Tests**: store unit tests (patch history, projection selectors, `onConnect` → binding, `setParent` clears crossing edges); Playwright: build the acceptance workflow on the canvas from scratch, save, publish.

### WP-20 `apps/web` — runs, trace viewer, human tasks, credentials, versions, deployments, settings, integrations

- **Done**: runs list (live), trace viewer with all tabs and actions (UI.md §7), human task inbox + task page + external review page, credentials UI, versions/compare/deployments/promote/rollback, settings (workspace, members, api keys, environments, notifications, retention, audit), integrations (MCP, OpenAPI, providers/models, plugins), dashboard.
- **Tests**: Playwright acceptance journey end to end against `docker compose up` (ARCHITECTURE.md §12.4) — this is the release gate for the first vertical slice.

---

## Wave 5 — product loop and hardening (need WP-19/20)

### WP-21 `@flowaid/evaluation` + API + UI

- **Sequencing**: on the acceptance path (ARCHITECTURE.md §12.4 ends with the regression report) — the package and API/worker parts build with the services phase and the UI with the web phase (upgrade plan Phases 4–6), not after the release gate.
- **Done**: expectation schema, runner job with human auto-resolution, scorers (output matchers incl. judge), summary + calibration (ECE bins), `compare()`, `RegressionReport`, publish gate, `add-to-evaluation`, evaluation UI (sets, cases, runs, report, compare), publish dialog integration.
- **Tests**: scorer unit tests; runner integration on the support-triage template with fake providers; ECE math on synthetic distributions; gate 422 path.

### WP-22 Observability surfaces

- **Done**: `/v1/metrics/*` SQL aggregates, dashboard page, Prometheus listener, OTel export, TraceReviewer job + `runs.review` + notifications, alert channels.
- **Tests**: metrics queries on seeded data; reviewer integration with a fake decision provider.

### WP-23 Templates, importer, docs, compose hardening

- **Done**: three demo templates seeded and runnable end to end with fake or real providers; `@flowaid/importer` with marketplace fixtures and `E_IMPORT_UNSUPPORTED` placeholders; `apps/docs` (Fumadocs) with generated OpenAPI reference and node catalog pages; production images (non-root, healthchecks), `.env.example` complete, first-boot admin creation, retention sweep scheduled.
- **Tests**: importer golden fixtures; compose smoke test in CI (`docker compose up`, wait for `/v1/ready`, run the example via API).

### WP-24 Security hardening

- **Done**: RLS enabled in the compose default, SSRF guard test-suite, webhook replay protection, helmet/CORS config review, secrets never in logs (grep test over captured logs during the e2e run), KEK rotation command, audit coverage check (every mutating route emits an audit event — enforced by a route-registration test).

---

## Wave 6 — beyond the first slice (need Wave 5)

- **WP-25** Knowledge/RAG: ingestion jobs, chunker, pgvector adapter + hybrid search, retrieval nodes, knowledge UI; adapters for Qdrant/Pinecone/Weaviate/Milvus/Chroma/Elasticsearch/OpenSearch behind `VectorIndexAdapter`.
- **WP-26** Agent node (`flowaid.ai.agent`): tool loop with `NodeResult.suspend` for approvals, agent presets, bounds (`maxToolCalls`, tokens, cost), agent-as-tool via `ctx.tools.call({ kind: 'workflow' })`.
- **WP-27** Schedules UI, MCP exposure UI, OIDC, KMS providers (AWS/Azure/GCP/Vault), plugin marketplace commands, AI builder/critic (`POST /v1/workflows/:id/ai/generate|critique` wrapping the compiler diagnostics), cost optimizer / smart routing from `HealthTracker` + catalog pricing + evaluation results.

---

## Critical path and parallelism summary

```
Phase 0  fix what exists (boundaries, dist exports, browser SHA-256, CI, workflow-core + ui fixes, compose/env hardening, docs)
Phase 1  WP-02 ∥ WP-03 ∥ WP-04 ∥ WP-05 ∥ WP-06 ∥ WP-07 ∥ WP-08 closure
Phase 2  WP-09 (02,04,05,06; 03 for the Pg suite) ∥ WP-10 (05) ∥ WP-11 (05) ∥ WP-12 (04,05,10) ∥ WP-13 (04) ∥ WP-14 (04)
Phase 3  WP-15 (09,10,12,03,06,07,13) ∥ WP-16 (09,12,13,14) ∥ WP-21-core (09,12) ∥ WP-13b (04,05) → WP-13c (12,13b)   ← LangChain off the critical path
Phase 4  WP-17 (15) ∥ WP-17b (09,12,15,17) ∥ WP-18 (08) ∥ WP-12b/13c templates ∥ scheduler/webhook/notifications routes
Phase 5  WP-19 (15,17,18,02) → WP-20 (19) + WP-21-UI                                                  ← acceptance test (incl. evaluations and Download code)
Phase 6  WP-22 ∥ WP-23 ∥ WP-24 ∥ advisor/AI builder/knowledge/agents/OIDC/MFA/KMS (WP-25…27), each behind its FeatureKey
```

Exact items, gates and finding coverage: `docs/UPGRADE_PLAN.md`. The first vertical slice (spec §First vertical slice) is complete when WP-20's Playwright acceptance journey — including the evaluation report and the Download code step — passes from a clean clone with `docker compose up`.
