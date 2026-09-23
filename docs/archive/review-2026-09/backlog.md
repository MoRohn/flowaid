# Review lens: build backlog (first vertical slice)

Date: 2026-09-22. Scope: what must be built, in dependency order, to reach the first vertical slice
and the acceptance test in `ARCHITECTURE.md` §12.4 plus the "Download code" step in `CODE_EXPORT.md`
§5. Source of truth for the work packages: `docs/design/IMPLEMENTATION_PLAN.md` (WP-00 … WP-27).

## 1. What exists on disk (verified 2026-09-22)

| Package / area           | State                                                                            | Evidence                                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config`        | done (tsconfig base/library/node/react, eslint base, prettier)                   | `packages/config/package.json` exports                                                                                                                                                                                                             |
| `packages/shared`        | done, 76 tests green                                                             | `packages/shared/src/index.ts` exports `uuidv7`, `sha256Json`, `stableStringify`, `Result`, `assertNever`, `nowIso`, `pLimit`, `withTimeout`                                                                                                       |
| `packages/env`           | done, 24 tests green                                                             | `packages/env/src/schema.ts` lines 341–387: every var in `.env.example`, `loadEnv`, `renderEnvExample`, README table injection                                                                                                                     |
| `packages/workflow-core` | done, 1856 tests green; contracts parity test against `docs/design/CONTRACTS.ts` | `src/index.ts` re-exports 22 modules; `fixtures/` holds 50 event fixtures, 5 manifests, 4 definitions, 1 hand-written plan                                                                                                                         |
| `packages/ui`            | 12 groups, 618 tests green, Vite playground                                      | `packages/ui/src/*`; **no dependency on `@flowaid/workflow-core`** (0 imports; `package.json` has no `@flowaid/workflow-core`) — it ships its own view-model types in `src/types.ts` and its own category/status arrays in `src/lib/categories.ts` |
| root boundaries          | `boundaries.json` + `eslint.boundaries.js` + `scripts/check-boundaries.test.ts`  | **1 of 13 root tests fails**: `ARCHITECTURE.md lists "importer" but boundaries.json does not` (boundaries.json names it `importer`; it also lacks `codegen`, `langchain`, `nodes-langchain`)                                                       |
| docker                   | `docker/compose.yml`, `compose.scale.yml`, three Dockerfiles, `docker/README.md` | images reference `apps/api dist/main.js`, `apps/worker dist/main.js` + `dist/health.js`, Next standalone — none exist yet; `docker/README.md` says so                                                                                              |
| `apps/`                  | empty directory                                                                  | `ls apps`                                                                                                                                                                                                                                          |
| `.env.example`           | generated from `packages/env` (`pnpm env:check`)                                 |                                                                                                                                                                                                                                                    |

Nothing is committed to git (all files staged `A`).

### Defects in the existing foundation that gate later work

1. **Root boundaries test fails** (`scripts/check-boundaries.test.ts:208`). `boundaries.json` uses `importer`
   while `ARCHITECTURE.md` §1.1 and `IMPLEMENTATION_PLAN.md` say `importer`; the DAG also lists `codegen`,
   `langchain`, `nodes-langchain`, which `boundaries.json` omits. The test iterates every DAG line, so after
   renaming `importer` it will fail on those three. `apps/api` allow-list must also gain `codegen` (export route)
   and `apps/worker` must gain `langchain`/`nodes-langchain` (plugin loading) per `LANGCHAIN.md` §6.
2. **No LangChain boundary rule.** `grep -ci langchain eslint.boundaries.js boundaries.json` → 0/0.
   `LANGCHAIN.md` §1/§6 require the build to fail on `langchain`/`@langchain/*` imports outside
   `packages/langchain`, `packages/nodes-langchain`, `packages/importer/src/langchain-map.ts`, `packages/codegen`
   templates and the worker plugin loader.
3. **`@flowaid/shared` hashes with `node:crypto`** (`packages/shared/src/hash.ts:9`) and is marked
   `browserSafe: false`, yet `workflow-core` (browser-safe) calls `sha256Json` from `definitionHash`
   (`packages/workflow-core/src/definition.ts:140`). The compiler's `planHash` and the Web Worker bundle
   (WP-02 "runs in a Web Worker bundle (no Node built-ins)") cannot work until `shared` has a pure-JS /
   WebCrypto SHA-256. `packages/workflow-core/README.md` already flags this.
4. **Package `exports` point at TypeScript sources** (`"." → "./src/index.ts"` in `shared`, `env`,
   `workflow-core`, `ui`; `build` emits `dist/` that nothing references). `Dockerfile.api|worker` run
   `pnpm deploy --prod` then `node dist/main.js`; Node cannot load `@flowaid/workflow-core/src/index.ts`. Vendored
   export tarballs (`pnpm pack`, CODE_EXPORT.md §1) have the same problem. Fix before WP-15/16/17b: conditional
   exports (`types` → `dist/*.d.ts`, `development` → `src`, `default` → `dist/*.js`) or bundle apps with tsup
   (`VERSIONS.md` pins tsup 8.5.1) with `noExternal: [/^@flowaid\//]`.
5. **No `playwright.config.ts`** at the root (WP-00 file list) and `@playwright/test` is not installed; WP-08's
   gallery screenshots, WP-19/20's acceptance journey and WP-17b's "Download code" Playwright step all need it.
6. **WP-01's "Also" item is not done**: `packages/ui/src/lib/categories.ts` keeps local `NODE_CATEGORIES`,
   `RUN_STATUSES`, `NODE_RUN_STATUSES` arrays instead of re-exporting `NodeCategorySchema.options`,
   `RunStatusSchema.options`, `NodeRunStatusSchema.options` (UI.md §3, IMPLEMENTATION_PLAN WP-01).

## 2. Prerequisite verification: what the next packages can import today

Verified by reading `packages/workflow-core/src/*.ts` export lists.

**Compiler (WP-02) needs — all present in `@flowaid/workflow-core`:**
`WorkflowDefinitionSchema`, `canonicalDefinition`, `definitionHash` (definition.ts); `NodeCatalog`, `NodeManifestSchema`,
`PortRuleSchema` (manifest.ts); `CompileOptions`, `CompileResult`, `ExecutionPlanSchema`, `PlanNode`, `PlanOp`,
`PlanScope`, `BatchGroup`, `CompiledBinding`, `DataDependency`, `ControlDependency`, `Guard`, `RedactionRule`,
`ResolvedNodePolicy`, `ToolSignature`, `SubflowSignature`, `ProviderAvailability` (plan.ts:18–300);
`DiagnosticCodeSchema` (94 codes) + `Diagnostic` (diagnostics.ts); `parseRef`/`formatRef`, `Binding`, `ExprAst`,
`CompiledTemplate` (bindings.ts); `parseExpression`, `printAst`, `collectRefs`, `collectTemplateRefs`,
`inferExprType`, `inferExprSchema`, `typeFromSchema`, `schemaFromType`, `isBooleanType` (expr/); `parseTemplate`,
`TEMPLATE_HOLE_FILTERS` (template.ts); `isSubschema`, `projectSchema`, pointer helpers (schema/); `RESERVED_IDS`
(ids.ts); `DecisionResultJsonSchema` (decision.ts); `NodePolicySchema`, `ExecutionPolicySchema`, `ProviderHopSchema`
(policy.ts). Missing: nothing in-package; the external gaps are the SHA-256 browser path (§1.3) and `ajv` for
config validation (npm, browser-safe). A hand-written expected plan for the example workflow already exists
(`fixtures/plans/example-support-reply.plan.json`, validated by `src/plan.test.ts`) — WP-02's first golden test.

**Runtime (WP-09) needs:** `RunStore`, `QueueDriver`, `EventBus`, `ArtifactStore`, `Job`, `QueueName`, `HumanTask`,
`RunTimer`, `LeaseInfo`, `AppendOptions` (store.ts — complete, matches ARCHITECTURE §5.11); `RunEventSchema`
(50 types), `TERMINAL_EVENT_TYPES`, `DurableRunEvent`/`EphemeralRunEvent`, `WaitReason`, `TimerPurpose` (events.ts);
`Run`, `NodeRun`, `RunStatus`, `NodeRunStatus`, `TERMINAL_RUN_STATUSES` (run.ts); `evaluateExpression`,
`createEvalScope`, `getPointer`, `projectValue`, `renderTemplate`, `applyTemplateFilter`; `HumanRequest/Response/Decision`;
every error class + `toFlowaidError` (errors.ts). Node-facing types (`ExecutionContext`, `NodeResult`,
`NodeDefinition`, `NodePackage`, `CredentialTypeDefinition`, `ResumeInfo`, `SuspendRequest`, `OptionProvider`) are
**not** in workflow-core by design (contracts-parity test excludes §16); WP-04 must define them from
`docs/design/CONTRACTS.ts` lines 1829–1996. `SchedulerState`/`Trigger`/`Effect`/`StepResult` are only in
`ARCHITECTURE.md` §5.3–5.4 prose: WP-09 owns those types.

**Database (WP-03) needs:** the store interfaces above plus `DATABASE.md` (41 `pgTable` definitions, projection
table in §Projections, migration set §Migration set). `drizzle-orm 0.45.3`, `drizzle-kit 0.31.11`, `postgres 3.4.9`
per `VERSIONS.md`.

**Providers (WP-05) needs:** `DecisionProvider`, `GenerationProvider`, `EmbeddingProvider`, `ProviderFactory`,
`ModelCatalog`, `ModelInfo`, `ProviderHealth`, `DecisionQuestion`, `DecisionState`, `DecisionCallContext`,
`GenerationRequest/Result/Chunk`, `SafeFetch` (providers.ts); `DecisionResultSchema`, `ProviderAttemptSchema`,
`PriceSnapshotSchema`, `TokenUsageSchema` (decision.ts); `ProviderHop`, `ModelRef` (policy.ts); error classes.
All present.

**UI (WP-18/19) needs:** `NodeManifest`, `Diagnostic`, `RunEvent`, `DecisionResult`, `ExecutionPlan.dataEdges`,
`isSubschema` (for `isValidConnection`), `HumanRequest/Response`. All exported; `packages/ui` does not consume
them yet (§1.6 above and WP-18 below).

## 3. Ordered backlog to the acceptance test

Waves are strict; inside a wave everything runs in parallel once its listed prerequisites are done. Effort:
S ≤ 1 day, M 2–4 days, L 1–2 weeks, XL 2–4 weeks (one engineer).

### Wave 0 (serial, both S)

**WP-00 closure** — fix the six defects in §1 (boundaries rename + three new packages + LangChain rule +
browser SHA-256 + dist exports + playwright config). Gate: `pnpm boundaries` 13/13 green; a test file in
`scripts/` that imports `@langchain/core` from `packages/shared` is rejected by ESLint; `pnpm -r build` emits
`dist/` for every package and `node -e "import('@flowaid/workflow-core')"` resolves from a `pnpm deploy` tree;
`vitest` `happy-dom` project can import `definitionHash` and hash the example fixture.

**WP-01 closure** — `packages/ui/src/lib/categories.ts` re-exports from workflow-core; `packages/ui/package.json`
gains `@flowaid/workflow-core`. Gate: existing 618 ui tests + a test that `NODE_CATEGORIES` deep-equals
`NodeCategorySchema.options`.

### Wave 1 (parallel; need WP-00/01 closure)

WP-02 compiler (XL) · WP-03 database (L) · WP-04 node-sdk (M) · WP-05 providers (L) · WP-06 credentials (M) ·
WP-07 observability (M) · WP-08 ui closure (M). Details per finding in the structured output; key points:

- **WP-02**: passes 1–8 of ARCHITECTURE §4.1, every one of the 94 `DiagnosticCode`s with a fixture, port rules
  §4.2, guard DNF §4.3, batch groups §4.4, `dataEdges`, deterministic `planHash`, `diff`, `migrateDefinition`,
  `checkBinding`, `COMPILER_VERSION`. First gate: `compile(example-support-reply.json)` equals
  `fixtures/plans/example-support-reply.plan.json` byte-for-byte after canonicalisation; the three demo fixtures
  (`support-triage.json`, `github-issue-triage.json`, `research-agent.json`) compile with zero errors against the
  5 fixture manifests + the manifests WP-12 will produce (until WP-12 lands, the compiler test suite needs a
  fixture catalog for every node type the demos use — write those manifests as fixtures now; WP-12's manifest
  snapshot test then asserts equality with them).
- **WP-03**: `schema.ts` = DATABASE.md verbatim (41 tables), `0001_init.sql`–`0004`, `PgRunStore.appendEvents`
  fenced + projections + `NOTIFY` in one transaction, `PgQueueDriver` (`SKIP LOCKED`, `LISTEN/NOTIFY`), `PgEventBus`,
  `PgCredentialRepository`, `reproject`. Integration tests need a real Postgres (compose `postgres` service or
  testcontainers) — add `DATABASE_URL`-gated vitest project.
- **WP-04**: defines §16 types; `toManifest` must reproduce the 5 fixture manifests from Zod definitions
  (snapshot test against `packages/workflow-core/fixtures/manifests/*.json`).
- **WP-05**: `OpenAICompatibleClient` lives here (ARCHITECTURE §6.6), so WP-11's `provider-openai` is a thin
  preset layer; the acceptance test's "Generation Model" node depends on this client.
- **WP-08**: `packages/ui` already has `SchemaForm` + widgets `textarea|code|slider|keyvalue|model|criteria|json`
  (`forms/widgets.tsx`), `ProbabilityRuler`, `CalibrationChart`, `DataTable`, `DiffView`, `TraceTimeline`,
  `ApprovalCard`/`ReviewPage`. Missing from UI.md §3/§5: `template` widget (CodeMirror mention picker), `levels`,
  `questions`, `schema` (JsonSchemaEditor), `BindingField` (`x-ui.bindable`), `x-ui.showWhen`, `optionsProvider`
  combobox, `oneOf` discriminator, `cron`; `ConfidenceChip`, `DistributionPopover`, `ConfusionMatrix`,
  `JsonViewer` with redaction markers; Playwright gallery screenshots light/dark. All of these must be driven by
  the real `JsonSchema`/`UiHints` types from workflow-core (`json.ts:49–124`), not `types.ts` mirrors.

### Wave 2 (parallel; need Wave 1 as listed)

WP-09 runtime (XL; needs 02, 04, 05, 06 + 03 for the Pg contract suite) · WP-10 provider-typesafe (M; 05) ·
WP-11 provider-openai/anthropic/ollama (M; 05 — `provider-openai` first, it is on the acceptance path) ·
WP-12 nodes-core slice 1 (L; 04, 05, 10) · WP-13 mcp + openapi-tools + nodes-core slice 2 (L; 04 — MCP tool is in
the spec's first slice list) · WP-14 sandbox + `tools/code` (M; 04 — not on the acceptance path, but
`docker/compose.yml` already runs a `worker-code` container with `WORKER_POOLS=code`; either ship WP-14 with
WP-16 or remove `worker-code` from the default compose until it exists, per the quality bar) ·
WP-13b langchain (M; 04, 05) → WP-13c nodes-langchain (L; 12, 13b) — owner requirement, off the acceptance path.

### Wave 3 (need Wave 2)

WP-15 api (XL; 09, 10, 12, 03, 06, 07) · WP-16 worker (L; 09, 12, 13, 14, optionally 13c) · WP-17 sdk + cli (M; 15)
· WP-17b codegen + export (L; 09, 12, 15, 17).

Pull forward from WP-23 into WP-15: first-boot owner creation from `FLOWAID_ADMIN_EMAIL/PASSWORD`, `dev/staging/prod`
seeding on workspace creation, and `seed_templates.ts` for the three demos — §12.4 starts with
"docker compose up → login → New workflow" and API.md §3.9 lists `GET /v1/templates` with the demos as built-ins.

### Wave 4 (need Wave 3)

WP-18 ui node/canvas/inspector/builder/trace/human/shell groups (L; 08, 01) · WP-19 web auth/shell/workflows/builder
(XL; 15, 17, 18, 02) → WP-20 web runs/trace/human tasks/credentials/versions/deployments/settings/integrations

- Playwright acceptance journey (XL; 19).

**WP-21 evaluation is on the acceptance path.** §12.4 ends with "Evaluations: create a set (add both runs as
cases via add-to-evaluation), run against v1 and v2, read the regression report", and SPEC.md's acceptance test
ends with "run evaluation suite". `IMPLEMENTATION_PLAN.md` places WP-21 in Wave 5 _after_ the WP-20 gate. Move
WP-21's package + `evaluation.run` job + `POST /v1/runs/:id/add-to-evaluation` + the evaluations pages into Wave
3/4 (needs 09, 12, 15; UI needs 20) and make the acceptance journey's last step depend on it.

### After the slice (unchanged from the plan)

WP-22 observability surfaces, WP-23 importer/docs/compose hardening (minus the parts pulled forward), WP-24
security hardening; WP-25–27 per §12.5 are explicitly out of the first slice.

## 4. Critical path and parallel lanes

```
WP-00 fix (S) → WP-01 closure (S)
  → lane A: WP-02 (XL) ──────────────────────────────┐
  → lane B: WP-03 (L), WP-06 (M), WP-07 (M)           ├→ WP-09 (XL) → WP-15 (XL) → WP-17 (M) → WP-19 (XL) → WP-20 (XL) + WP-21 UI
  → lane C: WP-04 (M) → WP-05 (L) → WP-10 (M) → WP-12 (L) ┘        ↘ WP-16 (L)   ↘ WP-17b (L)
  → lane E: WP-08 (M) → WP-18 (L) ─────────────────────────────────────────────────→ WP-19
  → lane F: WP-13 (L), WP-14 (M), WP-11 (M), WP-13b (M) → WP-13c (L), WP-21 core (L, after 09/12)
```

The critical path is WP-00 → WP-01 → WP-02 ∥ (WP-04 → WP-05) → WP-09 → WP-15 → WP-17 → WP-19 → WP-20: roughly
XL + XL + XL + M + XL + XL ≈ 14–18 engineer-weeks serial; with five lanes the wall-clock floor is the critical
path itself. WP-02 and WP-09 are the two packages where correctness cannot be recovered later (plan format and
event semantics are frozen contracts) and deserve the most senior owners.

## 5. Gates summary (what "done" must prove, per package)

See the structured findings; every finding lists the tests that gate it. Cross-package invariants to add to CI
as soon as their producers exist:

- `compile` determinism: same definition ⇒ same `planHash` (fast-check over fixture node kinds).
- `project(events) ≡ rows` after every golden runtime scenario (DATABASE.md §Projections).
- Replay determinism: any prefix of a golden log reduces to the same `SchedulerState`; checkpoint+tail ≡ full reduce.
- Manifest parity: `nodes-core` `dist/manifest.json` entries for the five fixture types deep-equal
  `packages/workflow-core/fixtures/manifests/*.json`.
- OpenAPI document snapshot validated with `@readme/openapi-parser`; SDK types regenerated from it in CI.
- Code-export round trip: `definitionHash(evaluate(generateWorkflowTs(def))) === definitionHash(def)` on the
  example + 3 demos.
- `docker compose up` smoke: wait for `/v1/ready`, run the example via the API, assert `completed`.
