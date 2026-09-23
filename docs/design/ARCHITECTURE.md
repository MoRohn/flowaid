# flowaid — Final Architecture

Status: **authoritative** (v1.1, 2026-09-22). This document, `CONTRACTS.ts`, `DATABASE.md`, `API.md`, `UI.md`, `CODE_EXPORT.md`, `LANGCHAIN.md`, `JEV_ENGINEERING.md` (contract-bound decisions: decision contracts, state packets, consequence routing, calibration, shadow mode, rollout, receipts; it wins for those, §10.12) and `IMPLEMENTATION_PLAN.md` are the single source of truth engineers implement from in parallel. Where a name appears in more than one file it is the same name; `CONTRACTS.ts` wins on any discrepancy. Contract changes that the v1.1 review requires but that are not yet applied to `CONTRACTS.ts` are recorded in `RFCS.md`; sequencing lives in `docs/UPGRADE_PLAN.md` (it supersedes the wave order in `IMPLEMENTATION_PLAN.md`).

Base: the **runtime-first** proposal (pure reducer, single-writer lease with fenced appends, DB-authoritative timers, manifest-only compiler). Grafted: typed **input bindings** and the typed `HumanRequest/HumanResponse` wire format (devx-types-first); **exclusive-group control semantics**, `$scope.carry` with defaults, run-drain completion, ephemeral draft versions, write-time redaction by data class, tri-state idempotency, evaluation-gated publish, `add-to-evaluation`, boolean `confidence = max(p, 1-p)` (product-ops-first). Every flaw the three judges identified is resolved; §12.3 maps each one to its fix.

Stack (pinned in `VERSIONS.md`): TypeScript 5.9 strict (`noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`), Zod 4.6, Fastify 5, Drizzle 0.45 + postgres.js, BullMQ 6 (optional), Next.js 16 App Router, React 19, `@xyflow/react` 12, Tailwind 4, Vitest 4, Playwright 1.63, pnpm 12 + Turborepo 2, Node 24 LTS in images.

Reading order: §0 → §2 (model) → §4/§5 (compiler/runtime) → the rest. Each section says which package owns it.

---

## 0. Vocabulary and the load-bearing decisions

| Term                 | Meaning                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkflowDefinition` | Canonical, UI-independent JSON document (Zod-validated). Authored by canvas, API, SDK, CLI, YAML, AI builder.                             |
| `Binding`            | The only way data flows between nodes: `literal                                                                                           | ref | template | expr | object | array` per input port. Data edges on the canvas are _derived_ from bindings. |
| `ControlEdge`        | The only edges in a definition. Carries activation from a control-out port (`done`, `failed`, branch cases, human outcomes, …) to a node. |
| `ExecutionPlan`      | Compiler output: flat, id-resolved, schema-checked graph the runtime walks. Immutable, content-hashed.                                    |
| `Run`                | One execution of one `workflow_versions` row with one input. Has an append-only event log.                                                |
| `NodeRun`            | One attempt of one node in one scope within a run. Address `(runId, scope, nodeId, attempt)`.                                             |
| `Scope`              | Iteration frame path: `""` (root), `"research#2"`, `"research#2/search_all#0"`. Outputs are addressed by `(scope, nodeId)`.               |
| `Guard`              | DNF of `(branchNode, port)` predicates under which a node can run. Computed by the compiler for every node.                               |
| `Exclusive group`    | Set of a node's incoming control edges that are provably mutually exclusive. OR inside a group, AND across groups.                        |
| `Pool`               | Worker queue class: `general`, `code`, `browser`, `gpu`, `retrieval`, `high_memory`.                                                      |

The twelve decisions everything else follows from (rationale in §12.2):

| #   | Decision                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | `run_events` is the only source of truth for a run. `runs`, `node_runs`, `human_tasks`, `run_timers` are projections written in the same transaction as the append.                                                                                                                                                            |
| D2  | Single writer per run: a Postgres lease with **fenced appends** (`… WHERE lease_owner = $me AND last_seq = $expected`). The API never appends run events except `RUN_CREATED`; cancel, human responses, external events and timers reach the run through jobs.                                                                 |
| D3  | Pure scheduler: `initialState / reduce / ready / step`. `step` returns `{ events, effects }`; effects are performed after commit and are idempotent by `nodeRunId` / `timerId`. Replay = re-reduce; recovery = checkpoint + tail.                                                                                              |
| D4  | Data flow is **bindings only**; control flow is **explicit control edges**. A node with no incoming control edges is activated by its data dependencies. A node with control edges is ready when all of them are resolved and every exclusive group has one fired edge.                                                        |
| D5  | One small expression language (FlowExpr) with a fixed grammar and function set, used in `branch.when`, `loop.exitWhen`, `foreach.reduce`, rule providers, `expr` bindings and template holes. No `eval`, no strings-in-strings, bounded evaluation.                                                                            |
| D6  | Containers (`loop`, `foreach`) are flat: body nodes carry `parent`. Bodies may reference enclosing scopes; the container inherits those dependencies. `$scope.carry` (with `initial`) carries state across iterations. No back-edges anywhere.                                                                                 |
| D7  | Control-flow constructs are node **kinds** owned by the runtime (`input, output, branch, join, loop, foreach, subflow, wait, human`). Plugins ship only `task` nodes, which may route (`NodeResult.route`) and suspend (`NodeResult.suspend`).                                                                                 |
| D8  | The compiler consumes JSON `NodeManifest`s only. Dynamic ports are **declarative port rules** (`controlPortsFromConfig`, `outputSchemaFromConfig`, `decisionAnswersFromConfig`, `toolSignature`) plus caller-supplied `resolveTool`/`resolveSubflow` data. The same compiler runs identically in browser, API, worker and CLI. |
| D9  | Ports are typed by JSON Schema (from Zod). `isSubschema` is conservative: decidable keywords are checked, undecidable ones (`pattern`, `if/then`, `patternProperties`, unknown-typed sources) yield `W_TYPE_UNVERIFIED` and the runtime validates on delivery.                                                                 |
| D10 | Redis is optional. `QueueDriver` has BullMQ and Postgres (`SKIP LOCKED` + `LISTEN/NOTIFY`) implementations; timers are authoritative in `run_timers` in both.                                                                                                                                                                  |
| D11 | Idempotency is a manifest contract (`safe                                                                                                                                                                                                                                                                                      | keyed | none`, optionally selected by config). `none` nodes are never auto-retried and never re-executed after a lost worker. Retry waits are durable timers, never in-process sleeps. |
| D12 | Versions are immutable rows holding definition + plan + hash. Every run, including "Run" from the builder, references a version row (ephemeral `kind = 'draft'` rows for drafts). Deployments are pointers per environment; secret bindings live per workflow × environment.                                                   |

---

## 1. Monorepo layout (`pnpm` workspaces + Turborepo)

The repo already contains `packages/config` (**tooling** config: tsconfig bases, ESLint flat config, Prettier) and `packages/ui` (component library with the brand tokens). The runtime configuration package is therefore named **`@flowaid/env`**, not `config`.

```
flowaid/
  apps/
    api/                Fastify 5: HTTP + SSE + webhooks + MCP server endpoint. Never executes nodes.
    worker/             Queue consumer: orchestrator, node executors, plugin host, sandbox host for the code pool.
    web/                Next.js 16 App Router: builder, runs, trace viewer, human tasks, evaluations, settings.
    docs/               Docs site (Fumadocs) + generated OpenAPI reference + node catalog pages.
  packages/
    config/             (exists) tsconfig/eslint/prettier presets — tooling only.
    shared/             Zero-dependency primitives: JsonValue helpers, Result, uuidv7(), sha256Json(), stableStringify(), assertNever, time.
    env/                Zod env schema, `loadEnv(): Env`, feature flags. Only place that reads process.env.
    workflow-core/      Portable contracts (CONTRACTS.ts §1–14, §17): definition, bindings, FlowExpr parser/evaluator, template scanner,
                        events, errors, DecisionResult, NodeManifest, ExecutionPlan types, Diagnostic, store interfaces, isSubschema/projectSchema.
    workflow-compiler/  compile()/validate(): passes 1–7, guard analysis, exclusive groups, batching, plan emission, diff, migrate.
    node-sdk/           defineNode(), definePackage(), toManifest(), ExecutionContext types, NodeResult, testing harness.
    nodes-core/         All built-in NodeDefinitions + build step that emits dist/manifest.json.
    workflow-runtime/   Reducer, scheduler, orchestrator, kind handlers, checkpoints, timers, recovery, replay; in-memory stores for tests.
    providers/          DecisionProvider/GenerationProvider/EmbeddingProvider registry, ModelCatalog, FailoverChain, HealthTracker,
                        LLMDecisionProvider, RuleDecisionProvider, OpenAI-compatible client.
    provider-typesafe/  TypeSafe System One client + TypeSafeDecisionProvider (exact mapping §6.3).
    provider-openai/    OpenAI generation + embeddings (+ presets: Groq, Mistral, xAI, OpenRouter, vLLM, Together, custom).
    provider-anthropic/ Anthropic Messages API.
    provider-ollama/    Ollama chat/embeddings/tags.
    mcp/                MCP client session pool, discovery, sanitisation, stdio policy, workflow-as-MCP-tool builder.
    openapi-tools/      OpenAPI 3.0/3.1 → ToolDefinition[] + executor.
    credentials/        Envelope encryption, master-key providers, credential type catalog, Redactor. No DB dependency (repository injected).
    database/           Drizzle schema (DATABASE.md), migrations, PgRunStore, PgQueueDriver, PgEventBus, repositories.
    observability/      pino logger, OTel tracer/meter, metric names, TraceReviewer, timeline builder.
    evaluation/         Expectation schemas, runner, scorers, RegressionReport, compare().
    workflow-sdk/       @flowaid/workflow-sdk: generated OpenAPI types + Flowaid client + RunHandle + defineWorkflow()/ref() builders.
    cli/                `flowaid` CLI (commander) over the SDK.
    importer/           @flowaid/importer — the importer: ExternalFlowData → WorkflowDefinition + ImportIssue[]. Isolated; Apache-2.0 attributions in NOTICE.
    codegen/            Code export: generated src/workflow.ts (SDK builders), runner, serve, tests, Dockerfile, vendored bundle (CODE_EXPORT.md).
    langchain/          @flowaid/langchain: LangChain ⇄ flowaid adapters (providers, tools, decisions, callbacks). Only place besides nodes-langchain that imports @langchain/* (LANGCHAIN.md).
    nodes-langchain/    @flowaid/nodes-langchain: LangChain-powered node package (chat, runnable, agent, loaders, splitters, embed, vector stores, retrievers, parsers).
    sandbox/            isolated-vm / container executors for the code pool.
    ui/                 (exists) React components + tokens; no data fetching.
```

### 1.1 Dependency DAG (edges point to allowed imports; enforced by `eslint-plugin-boundaries` + workspace `dependencies`)

```
shared            → (none)
env               → shared
workflow-core     → shared, zod
node-sdk          → workflow-core, shared
workflow-compiler → workflow-core, shared                       (never imports node code)
providers         → workflow-core, shared
provider-*        → providers, workflow-core, shared
credentials       → workflow-core (types), shared, env
observability     → workflow-core, credentials (Redactor), shared, env
mcp               → workflow-core, shared
openapi-tools     → workflow-core, shared
nodes-core        → node-sdk, providers, mcp, openapi-tools, workflow-core, shared
sandbox           → workflow-core, shared
workflow-runtime  → workflow-core, workflow-compiler, node-sdk, providers, credentials, observability, shared, env
database          → workflow-core, shared, env                 (implements RunStore/QueueDriver/EventBus/ArtifactStore/CredentialRepository)
evaluation        → workflow-core, providers, shared            (RunLauncher injected)
workflow-sdk      → workflow-core (types), shared
cli               → workflow-sdk, workflow-compiler, workflow-runtime, nodes-core, providers, provider-typesafe, provider-openai, provider-anthropic, provider-ollama, credentials, sandbox, workflow-core, shared   (runtime, nodes and providers only for `workflow run --local`)
importer          → workflow-core, shared
codegen           → workflow-core, workflow-compiler, shared
langchain         → providers, node-sdk, workflow-core, shared, @langchain/core (peer)
nodes-langchain   → langchain, node-sdk, providers, workflow-core, shared, @langchain/*
ui                → workflow-core (types), react, xyflow, tailwind
apps/api          → everything server-side except nodes-core executors, sandbox, langchain and nodes-langchain (imports nodes-core/manifest only; codegen for the single-file `ts` export; importer)
apps/worker       → workflow-runtime, workflow-compiler, node-sdk, nodes-core, providers, provider-*, mcp, openapi-tools, sandbox, database, credentials, observability, evaluation, codegen, langchain, nodes-langchain, env, shared, workflow-core
apps/web          → ui, workflow-core, workflow-compiler, workflow-sdk
```

Rules: `workflow-core` and `workflow-compiler` contain no Node built-ins (they run in the browser). `apps/api` never calls `execute()`. `nodes-core` never imports `database` or `workflow-runtime`. `credentials` never imports `database`. **LangChain boundary**: `langchain` and `@langchain/*` may be imported only by `packages/langchain`, `packages/nodes-langchain`, `packages/importer/src/langchain-map.ts`, `packages/codegen/src/templates/**` and `apps/worker/src/plugins/**`. `boundaries.json.thirdParty` lists exactly these exceptions; `eslint.boundaries.js` emits a `no-restricted-imports` pattern for `langchain`, `langchain/*`, `@langchain/*` in every other package, and `scripts/check-boundaries.test.ts` rejects a `langchain`/`@langchain/*` dependency in any other `package.json` (`LANGCHAIN.md`). **Environment boundary**: only `packages/env` reads `process.env` (ESLint `no-restricted-syntax`; `packages/env` and `packages/cli` carry the override).

### 1.2 Public exports per package

| Package                      | Exports                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@flowaid/shared`            | `JsonValue` utils, `Result<T,E>`, `ok/err`, `uuidv7()`, `sha256Json()`, `stableStringify()`, `assertNever()`, `nowIso()`                                                                                                                                                                                                                                                                     |
| `@flowaid/env`               | `EnvSchema`, `loadEnv()`, `Env`                                                                                                                                                                                                                                                                                                                                                              |
| `@flowaid/workflow-core`     | everything in `CONTRACTS.ts` §1–14, §17 (schemas, types, error classes, `parseRef`, `formatRef`, `parseExpression`, `evaluateExpression`, `parseTemplate`, `renderTemplate`, `isSubschema`, `projectSchema`, `definitionHash`)                                                                                                                                                               |
| `@flowaid/workflow-compiler` | `compile()`, `validate()`, `checkBinding()` (single-binding check for the canvas), `diff()`, `migrateDefinition()`, `COMPILER_VERSION`                                                                                                                                                                                                                                                       |
| `@flowaid/node-sdk`          | `defineNode()`, `definePackage()`, `toManifest()`, `ExecutionContext`, `NodeResult`, `CredentialTypeDefinition`, `createTestContext()`, `runNode()`                                                                                                                                                                                                                                          |
| `@flowaid/workflow-runtime`  | `initialState()`, `reduce()`, `ready()`, `step()`, `Orchestrator`, `RunService`, `recover()`, `MemoryRunStore`, `MemoryQueueDriver`, `MemoryEventBus`, `runLocally()` (`CODE_EXPORT.md` §2; the caller supplies `nodes` and `providers` — the runtime never imports node or provider packages), `testing/contractSuite` (shared `RunStore`/`QueueDriver`/`EventBus` suite run by `database`) |
| `@flowaid/providers`         | `ProviderRegistry`, `ModelCatalog`, `FailoverChain`, `HealthTracker`, `LLMDecisionProvider`, `RuleDecisionProvider`, `OpenAICompatibleClient`, `catalog/*.json`                                                                                                                                                                                                                              |
| `@flowaid/provider-typesafe` | `TypeSafeClient`, `TypeSafeDecisionProvider`, `toSystemOneRequest()`, `fromSystemOneAnswer()`, request/response Zod schemas                                                                                                                                                                                                                                                                  |
| `@flowaid/nodes-core`        | `corePackage: NodePackage`; `@flowaid/nodes-core/manifest` → `coreManifests: NodeManifest[]` (JSON, built)                                                                                                                                                                                                                                                                                   |
| `@flowaid/mcp`               | `McpSessionPool`, `discoverTools()`, `sanitizeToolName()`, `sanitizeToolDescription()`, `validateStdioConfig()`, `buildExposedTools()`                                                                                                                                                                                                                                                       |
| `@flowaid/openapi-tools`     | `parseOpenApi()`, `operationsToTools()`, `executeOperation()`, `coerceArgs()`                                                                                                                                                                                                                                                                                                                |
| `@flowaid/credentials`       | `CredentialCipher`, `MasterKeyProvider` (+ env/file/aws-kms/vault), `CredentialService`, `Redactor`, `credentialTypes`                                                                                                                                                                                                                                                                       |
| `@flowaid/database`          | `schema.*`, `createDb()`, `migrate()`, `PgRunStore`, `PgQueueDriver`, `PgEventBus`, `PgArtifactIndex`, repositories                                                                                                                                                                                                                                                                          |
| `@flowaid/observability`     | `createLogger()`, `tracer`, `meter`, `METRICS`, `TraceReviewer`, `buildTimeline()`                                                                                                                                                                                                                                                                                                           |
| `@flowaid/evaluation`        | `ExpectationSchema`, `runEvaluation()`, `score()`, `summarize()`, `compare()`, `RegressionReport`                                                                                                                                                                                                                                                                                            |
| `@flowaid/workflow-sdk`      | `Flowaid`, `RunHandle`, the builder set `defineWorkflow, input, output, task, branch, join, loop, foreach, subflow, wait, human, note, edge, ref, lit, tpl, expr, obj, arr, secret, variable, trigger` (`API.md` §8; every builder returns the `CONTRACTS.ts` node/binding JSON unchanged), generated `paths`/`components` types                                                             |
| `@flowaid/codegen`           | `generateWorkflowTs()`, `generateRunner()`, `generateServe()`, `generateClient()`, `generateReadme()`, `generateEnvExample()`, `generateExampleInput()`, `generateTests()`, `generateDockerfile()`, `generatePackageJson()`, `packageClosure()`, `buildExportBundle()` (`CODE_EXPORT.md` §3)                                                                                                 |
| `@flowaid/sandbox`           | `SandboxExecutor`, `IsolatedVmSandbox`, `ContainerSandbox`                                                                                                                                                                                                                                                                                                                                   |
| `@flowaid/langchain`         | adapters and callback handler per `LANGCHAIN.md` §2                                                                                                                                                                                                                                                                                                                                          |
| `@flowaid/nodes-langchain`   | `nodePackage: NodePackage`; `@flowaid/nodes-langchain/manifest`                                                                                                                                                                                                                                                                                                                              |
| `@flowaid/cli`               | the `flowaid` binary (`API.md` §8)                                                                                                                                                                                                                                                                                                                                                           |
| `@flowaid/importer`          | `importExternalFlow(flowData): { definition, issues }` (the importer; `langchain-map.ts` is its only LangChain-aware file)                                                                                                                                                                                                                                                                   |
| `@flowaid/ui`                | components by group (`primitives`, `decision`, `node`, `canvas`, `trace`, `inspector`, `forms`, `shell`, `data`, `observability`, `human`, `builder`), `tokens.css`, `styles.css`                                                                                                                                                                                                            |

---

## 2. `workflow-core` contracts (`CONTRACTS.ts` §1–14)

This section explains the model; the schemas are in `CONTRACTS.ts` and are not repeated.

### 2.1 Identifiers

Node ids and port names are `^[a-z][a-z0-9_]{0,63}$`. Node ids are unique per workflow (flat, including container bodies) and may not be an expression keyword or function name (`RESERVED_IDS` → `E_RESERVED_ID`). Node type ids are `flowaid.<group>.<name>` or `@scope/pkg.<name>` (`^(@[a-z0-9-]+\/)?[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$`). Secret names are `UPPER_SNAKE`. Paths inside values are RFC 6901 JSON Pointers (they can address keys with spaces, dots or dashes, which TypeSafe choice keys may contain).

### 2.2 References and bindings — decision: bindings are the only data mechanism

A `Ref` names a value: an output port of a node (`{ kind:'port', node, port, path? }`), a variable (`$vars.x`), the innermost container's `item | index | iteration | carry` (`$scope.…`), or run metadata (`$run.id`). The compact string form (`intent.decision.value`, `$scope.carry.gaps`, `start.message`) is used inside templates and expressions and normalised to the JSON form on save.

Each input port of a node holds exactly one `Binding`:

| kind               | meaning                                                                  | typed as                            |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------- |
| `literal`          | constant                                                                 | the literal's inferred schema       |
| `ref`              | a value; `default` makes it optional (used when the producer was pruned) | `projectSchema(producerPort, path)` |
| `template`         | text with `{{ expr \| filter }}` holes                                   | `{ type: 'string' }`                |
| `expr`             | a FlowExpr expression                                                    | inferred by the expression typer    |
| `object` / `array` | composed from other bindings                                             | synthesised object/array schema     |

Why bindings and not data edges: one source of truth (storing wiring twice lets the copies desync), every value crossing a boundary has a schema, an object binding assembles decision `state`, loop `carry`, HTTP bodies and prompts without a merge node, and the canvas stays honest: it draws one derived data edge per `ref` (solid) and per template/expr reference (dashed), and dragging a data handle _writes_ a `ref` binding. Explicit data edges were rejected because two overlapping wiring mechanisms double the compiler surface and make "same value via edge and via ref" ambiguous.

Config fields can also carry data: fields whose schema has `x-ui.widget: 'template'` accept templates, and fields with `x-ui.bindable: true` accept a `Binding` object instead of a literal. The compiler moves both into the plan (`configTemplates`, `configBindings`); the runtime renders them before `execute()` so nodes see plain values.

### 2.3 FlowExpr — the expression language

Grammar (LL(1), hand-written in `workflow-core/src/expr/`, no `eval`, no `Function`):

```
expr     := ternary
ternary  := or ('?' expr ':' expr)?
or       := and ('||' and)*
and      := cmp ('&&' cmp)*
cmp      := add (('==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'matches') add)?
add      := mul (('+' | '-') mul)*
mul      := unary (('*' | '/' | '%') unary)*
unary    := ('!' | '-') unary | postfix
postfix  := primary ('.' IDENT | '[' expr ']')*
primary  := NUMBER | STRING | 'true' | 'false' | 'null' | ref | call | lambda | '(' expr ')' | '[' args? ']' | '{' pairs? '}'
ref      := IDENT ('.' IDENT)+ ('[' (INT|STRING) ']' | '.' IDENT)*        -- node.port.path…
          | '$vars' '.' IDENT | '$scope' '.' ('item'|'index'|'iteration'|'carry') ('.' IDENT | '[' … ']')* | '$run' '.' IDENT
call     := FN '(' args? ')'
lambda   := IDENT '=>' expr                                              -- only as an argument of filter/map/any/all/sort
STRING   := '\'' chars '\'' | '"' chars '"'                                    -- single or double quotes, JSON escapes; NUMBER := JSON number
```

Functions (closed set; names are in `RESERVED_IDS`, which is derived from `EXPRESSION_KEYWORDS ∪ EXPRESSION_FUNCTION_NAMES`): `len, lower, upper, trim, contains, starts_with, ends_with, split, join, json, parse_json, keys, values, has, get(obj, pointer, default), coalesce, min, max, abs, round(x, digits?), floor, ceil, sum, avg, first, last, filter(arr, x => …), map(arr, x => …), any, all, sort(arr, x => key), to_number, to_string, regex_test, regex_match, now, format_date`. Errors are `ExpressionError` with a machine-readable `details.reason`. The typer (`inferExprType`) is structural; an `unknown`-typed operand yields `W_EXPR_UNTYPED`, a type contradiction `E_EXPR_TYPE`, a non-boolean `when`/`exitWhen` `E_EXPR_NOT_BOOLEAN`.

Literals: a number literal must be a finite double (`1e999` is `E_EXPR_SYNTAX` "number literal out of range"; hand-built ASTs holding `Infinity`/`NaN` are `NOT_FINITE` at runtime); an object literal may not repeat a key (`{a: 1, a: 2}` is `E_EXPR_SYNTAX`; a hand-built AST with a repeated key is `INVALID_ARGUMENT`). `has(arr, i)` accepts an integer or a canonical integer string (`has(arr, "0")` ≡ `arr["0"]`).

Budget (RFC-0003, accepted): evaluation is total and bounded by **1 000 000 steps** per expression — one step per AST node visited (lambda bodies on every invocation) plus one step per element for the array built-ins (`sort` n·log₂n; `join`, `in`, `contains`, `sum`, `avg`, `min`, `max`, `keys`, `values`, `split`, `len` n, where n is the element count of an array or object and the code-unit length of a string) — so the bound measures work rather than AST shape (`map`/`filter` over 100 000 items fit; `sort` over 2 000 000 items is `STEP_LIMIT` before the sort starts). Values the expression _builds_ are capped at **1 MiB** of compact JSON (`RESULT_TOO_LARGE`); a value read through a reference is capped separately at **8 MiB** (`INPUT_TOO_LARGE`) so a large node output can still be summarised (`len(n.p)`, `first(n.p)`). Value nesting is capped at **512** levels (`DEPTH_LIMIT`, checked iteratively so hostile inputs never overflow the stack); AST height at 100 (`MAX_EXPR_DEPTH`).

Regular expressions (`matches`, `regex_test`, `regex_match`): the pattern operand — and the flags argument when given — must be a **string literal** (`E_EXPR_REGEX_DYNAMIC` at compile time; `INVALID_ARGUMENT` at runtime for a hand-built AST), so every pattern a workflow can run is known when it is compiled. Each literal is vetted with `recheck` (automaton checker): only a pattern proven to match in linear time passes; a vulnerable (exponential or polynomial), unsupported or undecided pattern is `E_EXPR_REGEX_UNSAFE` at compile time and `INVALID_REGEX` at runtime (`(a+)+$` is rejected in milliseconds instead of backtracking; an unanchored `(\d+)-(\d+)` is polynomial — anchor it: `^(\d+)-(\d+)$`). An unparseable literal is `E_EXPR_TYPE` / `INVALID_REGEX`. Patterns are at most 1 024 characters and subjects at most 65 536 (`INVALID_ARGUMENT`); flags are a subset of `imsu`. Verdicts are memoised in a 256-entry LRU, compiled regexes are memoised per evaluation in a 256-entry LRU (a pattern inside a lambda compiles once), and the engine is replaceable (`setDefaultRegexEngine`): the worker installs `re2` when that package is present.

Dates: `format_date(value, format?)` and every other date-consuming function accept exactly three forms, none of which depends on the process time zone — **epoch milliseconds** (a number), **`YYYY-MM-DD`** (UTC midnight) and an **RFC 3339 date-time** with `Z` or a `±HH:MM` offset (`2024-01-02T03:04:05.678+02:00`; fractional seconds are truncated to milliseconds; calendar fields must be in range, no roll-over). Everything else — offset-less date-times, `1/2/2024`, month names, epoch strings — is `INVALID_DATE` naming the accepted forms. Output is always UTC (`YYYY MM DD HH mm ss SSS` tokens, `[literal]` passes through; no format → ISO 8601). The suite runs under two `TZ` values in CI (`pnpm --filter @flowaid/workflow-core test:tz`).

Templates: `text ('{{' ws expr ws ('|' filter)? ws '}}')*`, `filter := 'json' | 'json_pretty' | 'join_lines' | 'join_comma' | 'upper' | 'lower' | 'trim'`, `\{{` escapes. A hole without a filter is `string` (scalars become text, `null` the empty string). `json` and `json_pretty` serialise any value; `join_lines` and `join_comma` join an array's items as text (`\n` / `, `; a non-array is a runtime `TYPE` error); `upper`, `lower` and `trim` coerce to text first — the scanner accepts all seven (RFC-0009; `TEMPLATE_HOLE_FILTERS` is derived from `TemplateFilterSchema` minus `string`). A hole whose static type is object/array without a `json | json_pretty | join_lines | join_comma` filter is `E_TEMPLATE_OBJECT_COERCION` (a bare hole and the three text filters alike); an `unknown`-typed hole is `W_TYPE_UNVERIFIED` and is rendered as compact JSON at runtime if it turns out non-scalar.

### 2.4 Node kinds and their ports

| kind      | data-in                                                             | data-out                                                       | control-out                                                                                                              |
| --------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `input`   | —                                                                   | one port per top-level property of `inputs`                    | `done`                                                                                                                   |
| `output`  | `value` (binding, assignable to `outputs`)                          | —                                                              | —                                                                                                                        |
| `task`    | manifest `inputs` (+ `dynamicInputs`, port rules)                   | manifest `outputs` (+ port rules)                              | `done`; `failed` if `policy.onError='route'`; manifest `controlPorts`; rule-derived                                      |
| `branch`  | refs inside `cases[].when`                                          | `taken: string[]`                                              | one per case port + `defaultPort`                                                                                        |
| `join`    | `inputs` (bindings, collected)                                      | `values: Record<name, JsonValue\|null>`, `first: string\|null` | `done`; `timeout` if `timeoutMs`                                                                                         |
| `loop`    | container; `carry.next`/`result`/`exitWhen` evaluated in body scope | `result` (object), `carry` (final), `iterations: int`          | `done`; `exhausted` if `onExhausted='route'`; `failed` if `onError='route'`                                              |
| `foreach` | `items` (array binding)                                             | `results: array`, `errors: array`, `reduced` (if `reduce`)     | `done`; `failed` if `onError='route'`                                                                                    |
| `subflow` | `inputs` (child input keys)                                         | `output` (child outputs object)                                | `done`, `failed`                                                                                                         |
| `wait`    | `until.at` for timestamps                                           | `payload` (event payload or null), `fired_at`                  | `done`; `timeout` for events                                                                                             |
| `human`   | `title`, `context`, `mode.value`                                    | `decision: HumanDecision`, `value`                             | approval/review → `approved`,`rejected`; form → `submitted`; choice → one per option id; `expired` if `onExpire='route'` |
| `note`    | —                                                                   | —                                                              | — (dropped by the compiler)                                                                                              |

A task fires exactly one control-out per completion: `result.route ?? 'done'` (or `failed` on error with `onError='route'`).

### 2.5 Activation semantics (used identically by compiler and runtime)

- **Control edges** carry activation. When a node completes, each of its control-out ports is **fired** or **pruned**; edges inherit the port's state.
- **Data dependencies** (from bindings) become **settled** when the producer completes (value available) or is pruned (value absent).
- The compiler partitions a node's incoming control edges into **exclusive groups**: two edges are in the same group iff their guards are mutually exclusive (§4.3). Within a group at most one edge can fire (OR); across groups all must fire (AND). If the pairwise-exclusivity graph has a connected component that is not a clique the intent is ambiguous → `E_CONTROL_AMBIGUOUS` (insert a `join`). Nodes with more than one group get `I_CONTROL_AND` so the AND is visible.
- A node is **ready** when (a) every data dependency is settled, and (b) if it has control edges: all of them are resolved and every group has ≥ 1 fired edge; if it has none: immediately (data-activated).
- A node is **pruned** (`NODE_SKIPPED{pruned}`) as soon as any group has all of its edges pruned, or a required (non-defaulted) data dependency's producer is pruned. Pruning propagates transitively and eagerly, so joins never wait for edges that can no longer fire.
- A node with several fired edges in one group runs **once** (merge of exclusive branches). This generalises conditional groups without a waiting-node structure.
- `join` nodes are the explicit place for `any | count | race` semantics and for collecting values from possibly-pruned producers (their `inputs` refs need no `default`).
- Cycles are illegal at every level (`E_CYCLE`); iteration is only through `loop`/`foreach` containers.

Guarantee that a referenced value exists: because a data dependency is a readiness condition, a producer always settles before the consumer runs; the compiler additionally proves the producer is not on a strictly narrower branch than the consumer (`E_CONDITIONAL_DATA_DEP` for required refs, `W_NULLABLE_INPUT` for defaulted ones).

### 2.6 Containers

Body nodes carry `parent: <containerId>`; nesting is allowed to depth 4 (`E_SCOPE_DEPTH`). Control edges may not cross a container boundary (`E_EDGE_CROSSES_SCOPE`). Bindings may reference **outward** (a body node may read any node of any enclosing scope and `$scope.*` of the innermost container); the compiler adds those producers as **hoisted dependencies of the container** (`via: 'hoisted'`), so the container does not start until they settle. Bindings may not reference **inward** except through the container's own output ports (`E_REF_SCOPE_VIOLATION`). An iteration completes when its scope has no ready or running nodes; then `carry.next`, `result` and `exitWhen` are evaluated in that scope. `$scope.carry` on iteration 0 is `carry.initial`. Refs to body nodes from `carry.next`/`result` may be pruned inside an iteration and therefore need a `default` (`E_CONDITIONAL_DATA_DEP` otherwise).

### 2.7 Run completion

`output` nodes emit `RUN_OUTPUT`. The run completes (`RUN_COMPLETED`) when the root scope has no ready or running nodes; its output is the merge (by key, in completion order) of all completed output nodes' values and `outcome` is the last one's. If an output node has `earlyExit: true` the run completes as soon as that node completes and still-running siblings are cancelled (`NODE_CANCELLED{early_exit}`). Root scope drained with no output completed → `RUN_FAILED{NO_OUTPUT}`. The compiler warns `W_OUTPUT_AMBIGUOUS` when two output nodes are not provably exclusive.

### 2.8 Decision result (spec-exact)

`DecisionResult` is a discriminated union on `kind`. Common: `confidence`, `provider`, `model` (resolved id, e.g. `jev-1.13.0`), `latencyMs`, `usage?`, `costUsd`, `requestId?`, `raw?`, `attempts[]` (failover chain walked). Boolean: `value`, `pYes`, `probabilities: {true, false}`, `confidence = max(pYes, 1 − pYes)` — comparable with a two-option choice so one Confidence Gate threshold means the same across kinds. Choice: `value`, `probabilities` per option. Score: fractional `value` in `[0, n−1]`, `normalized = value/(n−1)`, `level = round(value)`, `levelLabel = levels[level]`, `levels`, `probabilities` keyed `"0".."n-1"`. Decision nodes expose the whole result on output port `decision` (schema `DecisionResultJsonSchema[kind]`), so `decision.value`, `decision.confidence`, `decision.probabilities` are ordinary typed refs.

### 2.9 Example workflow (Input → TypeSafe Choice → Branch → HTTP → Generate → TypeSafe Boolean → Confidence Gate → Human Approval / Output)

This is the acceptance-test workflow. It parses with `WorkflowDefinitionSchema` and compiles with zero errors against the core catalog. Note how the human-edited reply reaches the output without a merge node (two exclusive output nodes), how `fetch_account` is optional on non-billing paths (`default: null`), and how the only control edges are the ones that carry a decision.

```json
{
  "$schema": "https://flowaid.dev/schemas/workflow/v1",
  "id": "5b1c2b60-6e0f-4a1a-9b0e-1b1a2c3d4e5f",
  "name": "Support reply with safety gate",
  "description": "Classify a support message, fetch account context for billing, draft a reply, verify it is safe, gate on confidence.",
  "inputs": {
    "type": "object",
    "additionalProperties": false,
    "required": ["message", "customer_id"],
    "properties": {
      "message": { "type": "string", "x-dataClass": "pii" },
      "customer_id": { "type": "string" },
      "tier": { "type": "string", "enum": ["free", "gold"] }
    }
  },
  "outputs": {
    "type": "object",
    "required": ["reply", "team", "auto_sent"],
    "properties": {
      "reply": { "type": "string" },
      "team": { "type": "string" },
      "auto_sent": { "type": "boolean" },
      "approved_by": { "type": ["string", "null"] }
    }
  },
  "secrets": [
    { "name": "TYPESAFE_API_KEY", "credentialType": "typesafe.api_key" },
    { "name": "OPENAI_API_KEY", "credentialType": "openai.api_key" },
    { "name": "CRM_TOKEN", "credentialType": "http.bearer", "required": false }
  ],
  "variables": [
    {
      "name": "crmBaseUrl",
      "schema": { "type": "string" },
      "default": "https://crm.example.com",
      "source": "environment"
    },
    {
      "name": "autoSendThreshold",
      "schema": { "type": "number", "minimum": 0, "maximum": 1 },
      "default": 0.85
    }
  ],
  "execution": {
    "timeoutMs": 180000,
    "maxCostUsd": 0.5,
    "decisions": { "primary": { "provider": "typesafe", "model": "jev-latest" } }
  },
  "nodes": [
    { "id": "start", "kind": "input", "name": "Ticket" },

    {
      "id": "intent",
      "kind": "task",
      "name": "Intent",
      "type": "flowaid.decision.choice",
      "typeVersion": "1.0.0",
      "config": {
        "instructions": "Which team should handle this support request?",
        "options": {
          "billing": "Invoices, charges, refunds",
          "technical": "Bugs, outages, integrations",
          "security": "Fraud, stolen cards, account takeover",
          "general": "Anything else"
        }
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "message": {
              "kind": "ref",
              "ref": { "kind": "port", "node": "start", "port": "message" }
            },
            "tier": {
              "kind": "ref",
              "ref": { "kind": "port", "node": "start", "port": "tier" },
              "default": "free"
            }
          }
        }
      },
      "credentials": { "typesafe": "TYPESAFE_API_KEY" }
    },

    {
      "id": "route",
      "kind": "branch",
      "name": "Billing?",
      "cases": [{ "port": "billing", "when": "intent.decision.value == 'billing'" }],
      "defaultPort": "other"
    },

    {
      "id": "fetch_account",
      "kind": "task",
      "name": "Fetch account",
      "type": "flowaid.tools.http",
      "typeVersion": "1.0.0",
      "config": {
        "method": "GET",
        "url": "{{ $vars.crmBaseUrl }}/customers/{{ start.customer_id }}",
        "responseType": "json",
        "timeoutMs": 5000
      },
      "credentials": { "auth": "CRM_TOKEN" },
      "policy": { "retry": { "maxAttempts": 3 }, "onError": "ignore" }
    },

    {
      "id": "draft",
      "kind": "task",
      "name": "Draft reply",
      "type": "flowaid.ai.generate",
      "typeVersion": "1.0.0",
      "config": {
        "model": { "provider": "openai", "model": "gpt-4.1-mini" },
        "temperature": 0.3,
        "maxOutputTokens": 600,
        "stream": true,
        "system": "You are a concise, friendly support agent. Never promise refunds or credits."
      },
      "inputs": {
        "prompt": {
          "kind": "template",
          "source": "Team: {{ intent.decision.value }} (confidence {{ round(intent.decision.confidence, 2) }})\nAccount: {{ coalesce(fetch_account.body, {}) | json }}\n\nCustomer message:\n{{ start.message }}\n\nWrite the reply."
        }
      },
      "credentials": { "llm": "OPENAI_API_KEY" }
    },

    {
      "id": "safe",
      "kind": "task",
      "name": "Safe to send?",
      "type": "flowaid.decision.boolean",
      "typeVersion": "1.0.0",
      "config": {
        "instructions": "Is this reply safe to send without human review?",
        "criteria": {
          "true": "Polite, accurate, makes no financial or legal commitment",
          "false": "Speculates, promises refunds, discloses internal data, or is rude"
        }
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "reply": { "kind": "ref", "ref": { "kind": "port", "node": "draft", "port": "text" } },
            "message": {
              "kind": "ref",
              "ref": { "kind": "port", "node": "start", "port": "message" }
            },
            "team": {
              "kind": "ref",
              "ref": { "kind": "port", "node": "intent", "port": "decision", "path": "/value" }
            }
          }
        }
      },
      "credentials": { "typesafe": "TYPESAFE_API_KEY" }
    },

    {
      "id": "gate",
      "kind": "task",
      "name": "Confidence gate",
      "type": "flowaid.decision.confidence_gate",
      "typeVersion": "1.0.0",
      "config": {
        "threshold": { "kind": "ref", "ref": { "kind": "var", "name": "autoSendThreshold" } },
        "requireValue": true
      },
      "inputs": {
        "decision": { "kind": "ref", "ref": { "kind": "port", "node": "safe", "port": "decision" } }
      }
    },

    {
      "id": "approve",
      "kind": "human",
      "name": "Approve reply",
      "mode": {
        "type": "review",
        "value": { "kind": "ref", "ref": { "kind": "port", "node": "draft", "port": "text" } },
        "schema": { "type": "string", "minLength": 1 }
      },
      "title": {
        "kind": "template",
        "source": "Review reply for {{ start.customer_id }} ({{ intent.decision.value }})"
      },
      "context": {
        "message": { "kind": "ref", "ref": { "kind": "port", "node": "start", "port": "message" } },
        "safety": { "kind": "ref", "ref": { "kind": "port", "node": "safe", "port": "decision" } }
      },
      "assignees": ["role:support_lead"],
      "expiresInMs": 86400000,
      "onExpire": "route",
      "externalReview": true
    },

    {
      "id": "out_auto",
      "kind": "output",
      "name": "Auto reply",
      "outcome": "auto",
      "value": {
        "kind": "object",
        "fields": {
          "reply": { "kind": "ref", "ref": { "kind": "port", "node": "draft", "port": "text" } },
          "team": {
            "kind": "ref",
            "ref": { "kind": "port", "node": "intent", "port": "decision", "path": "/value" }
          },
          "auto_sent": { "kind": "literal", "value": true },
          "approved_by": { "kind": "literal", "value": null }
        }
      }
    },

    {
      "id": "out_human",
      "kind": "output",
      "name": "Reviewed reply",
      "outcome": "human_approved",
      "value": {
        "kind": "object",
        "fields": {
          "reply": { "kind": "ref", "ref": { "kind": "port", "node": "approve", "port": "value" } },
          "team": {
            "kind": "ref",
            "ref": { "kind": "port", "node": "intent", "port": "decision", "path": "/value" }
          },
          "auto_sent": { "kind": "literal", "value": false },
          "approved_by": {
            "kind": "ref",
            "ref": { "kind": "port", "node": "approve", "port": "decision", "path": "/by" }
          }
        }
      }
    },

    {
      "id": "out_rejected",
      "kind": "output",
      "name": "Rejected",
      "outcome": "rejected",
      "value": {
        "kind": "object",
        "fields": {
          "reply": { "kind": "literal", "value": "" },
          "team": {
            "kind": "ref",
            "ref": { "kind": "port", "node": "intent", "port": "decision", "path": "/value" }
          },
          "auto_sent": { "kind": "literal", "value": false },
          "approved_by": { "kind": "literal", "value": null }
        }
      }
    }
  ],
  "edges": [
    {
      "id": "c1",
      "from": { "node": "route", "port": "billing" },
      "to": { "node": "fetch_account" }
    },
    { "id": "c2", "from": { "node": "gate", "port": "pass" }, "to": { "node": "out_auto" } },
    { "id": "c3", "from": { "node": "gate", "port": "review" }, "to": { "node": "approve" } },
    {
      "id": "c4",
      "from": { "node": "approve", "port": "approved" },
      "to": { "node": "out_human" }
    },
    {
      "id": "c5",
      "from": { "node": "approve", "port": "rejected" },
      "to": { "node": "out_rejected" }
    },
    {
      "id": "c6",
      "from": { "node": "approve", "port": "expired" },
      "to": { "node": "out_rejected" }
    }
  ],
  "layout": {
    "nodes": {
      "start": { "x": 0, "y": 220 },
      "intent": { "x": 260, "y": 220 },
      "route": { "x": 520, "y": 220 },
      "fetch_account": { "x": 780, "y": 80 },
      "draft": { "x": 1040, "y": 220 },
      "safe": { "x": 1300, "y": 220 },
      "gate": { "x": 1560, "y": 220 },
      "approve": { "x": 1820, "y": 360 },
      "out_auto": { "x": 1820, "y": 80 },
      "out_human": { "x": 2080, "y": 300 },
      "out_rejected": { "x": 2080, "y": 480 }
    }
  }
}
```

Compiler notes on this example: `intent`, `draft`, `safe`, `gate` are data-activated (no control edges); `fetch_account` runs only on `route.billing`, so `fetch_account.body` inside `draft`'s template is wrapped in `coalesce()` (bare use → `E_CONDITIONAL_DATA_DEP`); `gate` fires `pass` or `review`; `out_auto`/`out_human`/`out_rejected` are pairwise exclusive (guards `{gate.pass}`, `{gate.review ∧ approve.approved}`, `{gate.review ∧ (approve.rejected ∨ approve.expired)}`), so no `W_OUTPUT_AMBIGUOUS`. The pruned-path edges (`c5`, `c6`) form one exclusive group on `out_rejected`.

---

## 3. Node SDK (`@flowaid/node-sdk`, `CONTRACTS.ts` §15–16)

### 3.1 NodeDefinition

A node author writes one object: four Zod schemas (`configSchema`, `inputSchema`, `outputSchema`, optional `dynamicInputs`), metadata, capabilities, an `idempotency` spec, optional `controlPorts`/`portRules`/`credentials`, and `execute(ctx, input)`. `toManifest()` turns it into the JSON `NodeManifest` (schemas via `z.toJSONSchema({ target: 'draft-2020-12' })`, `x-ui` hints from `.meta()`), which is what the compiler, the API and the browser consume. The runtime — never the node — validates `input` against `inputSchema` before `execute` and `output` against `outputSchema` after (`OUTPUT_SCHEMA_MISMATCH`), renders templates/bindables in `config`, and resolves credentials, so nodes receive typed, validated values and cannot leak malformed outputs.

`NodeResult` is a three-way union: `ok` (with optional `route`, `usage`, `costUsd`, `decision`), `suspend` (durable wait for a human response or an external event, with a `state` blob), `error` (a `FlowaidError`). Throwing is equivalent to `error` with `toFlowaidError(thrown)`.

Idempotency is declared, not guessed: `idempotency: 'safe' | 'keyed' | 'none'` or `{ byConfig: '/method', cases: { GET: 'safe', HEAD: 'safe', PUT: 'keyed', DELETE: 'keyed' }, default: 'none' }` (the HTTP node's declaration). The compiler resolves it per node into `PlanNode.idempotency`.

### 3.2 ExecutionContext

`ctx` exposes capability-scoped services only (`credentials`, `providers`, `tools`, `state`, `artifacts`, `events`, `budget`, `http`, `clock`, `logger`, `signal`, `scope`, `vars`, `run`, `node`, `resume?`). A node that did not declare a capability gets a service whose methods throw `ForbiddenError`. Nothing on `ctx` references the database, the queue, the event log or key material. `ctx.signal` combines run cancellation and the node timeout (`AbortSignal.any`) and must be passed to every I/O call; `ctx.http` is the SSRF-guarded fetch (§10.6).

`ctx.providers.decision(chain)` returns a `FailoverChain` over `[primary, ...failover]` hops; every hop appears in `DecisionResult.attempts` and as `PROVIDER_FAILOVER` events. When the chain ends in `{ provider: 'human' }` and all providers failed, the wrapper throws `HumanFallbackSignal`; the decision node converts it into `NodeResult.suspend` with a `choice`/`approval` request (`origin: 'decision_failover'`); on resume the node returns a `DecisionResult` with `provider: 'human'`, `confidence: 1`.

### 3.3 Suspension (task nodes)

Mid-node durable suspension uses **explicit re-entry**, not a step journal: the node returns `{ kind: 'suspend', wait, state }`; the runtime persists `state` in `NODE_WAITING.state`, creates the human task or event wait, releases the lease, and on resume calls `execute()` again with `ctx.resume = { kind, state, response | payload }`. Node authors own the re-entry logic (an Agent node stores its message history in `state`). This needs no determinism rules, no ESLint policing of third-party packages and no journal table; it requires `capabilities: ['suspend']`.

### 3.4 Control-flow kinds vs executors

| kind      | runtime handler                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task`    | resolve bindings → render config → validate → build ctx → in-worker executor or `NODE_DELEGATED` to another pool → `NODE_COMPLETED{firedPorts: [route ?? 'done']}`                              |
| `input`   | `NODE_COMPLETED` immediately with the run input split into ports                                                                                                                                |
| `output`  | validate `value` against `outputs` → `RUN_OUTPUT`; run completes per §2.7                                                                                                                       |
| `branch`  | evaluate cases in order → `BRANCH_EVALUATED{taken}` → `NODE_COMPLETED{firedPorts}`                                                                                                              |
| `join`    | track arrivals (`JOIN_ARRIVED`) per mode; `race` aborts the losers' private subgraphs; optional `join_timeout` timer                                                                            |
| `loop`    | open scope `<scope>/<id>#<n>` with `carry`; on drain → `LOOP_ITERATION_COMPLETED`; evaluate `exitWhen` + bounds → next iteration or `LOOP_EXITED` → `NODE_COMPLETED{result, carry, iterations}` |
| `foreach` | `FOREACH_STARTED`; schedule up to `concurrency` item scopes; `FOREACH_ITEM_COMPLETED` per item; failure policy; sequential reduce; `NODE_COMPLETED{results, errors, reduced}`                   |
| `subflow` | create child run (`origin: 'subflow'`, `parentRunId`, `parentNodeRunId`), `NODE_WAITING{subflow}`; child terminal event enqueues `run.signal{subflow_completed}`                                |
| `wait`    | `TIMER_SET` or event wait registration; `NODE_WAITING`; `TIMER_FIRED`/`EVENT_RECEIVED` → `NODE_COMPLETED`                                                                                       |
| `human`   | `HUMAN_APPROVAL_REQUESTED` + `human_tasks` row + expiry/escalation timers; `NODE_WAITING{human}`; response → `HUMAN_APPROVAL_RECEIVED` → `NODE_COMPLETED{firedPorts: [outcome]}`                |

Kind handlers and executors both produce only events; executors never see scheduler state.

### 3.5 Registration and plugins

`packages/nodes-core` exports `corePackage` (`definePackage`) and a build step writes `dist/manifest.json` (`NodeManifest[]`), consumed by `apps/api` and `apps/web` without importing executors. Third-party packages export `nodePackage` from `definePackage({ name: '@community/slack', version, sdk: '^1', nodes, credentialTypes, providers })` — the loader also accepts a single `export const node: NodeDefinition` or `export const nodes: NodeDefinition[]` (wrapped into a package named after `package.json.name`) — and declare `"flowaid": { "package": "nodePackage", "sdk": "^1.0.0" }` in `package.json`. `flowaid plugin add <pkg>` installs into `FLOWAID_PLUGIN_DIR` with `pnpm add --ignore-scripts` under the repository's `minimumReleaseAge`, records the registry tarball integrity in `plugins.integrity` (verified again at load: `E_PLUGIN_INTEGRITY`), verifies the SDK range, runs `toManifest` and stores manifests in `plugins.manifests`; node ids must start with the package name (`E_PLUGIN_ID_PREFIX`); `source: 'local'` is accepted only when `FLOWAID_PLUGIN_ALLOW_LOCAL=true`; every install is audited (`plugin.install`).

**Bundled plugins.** Packages that ship inside the worker image (`FLOWAID_BUNDLED_PLUGINS`, default `@flowaid/nodes-langchain`) are registered the same way without an install step: at boot the worker resolves each bundled package, runs `toManifest` and upserts a global `plugins` row (`workspace_id = NULL`, `source = 'bundled'`, `status = 'enabled'`, `integrity` = the package version). The API therefore serves their manifests from `GET /v1/nodes` and their `NodePackage.providers` factories from `GET /v1/providers` (provider ids such as `langchain:openai`; their `credentialType` maps onto the existing catalog types). Bundled rows are read-only in the API except `status`.

**Plugin host.** The worker runs every enabled plugin package in its own **plugin host process** (`child_process.fork` of `apps/worker/dist/plugin-host.js` with `--disallow-code-generation-from-strings`, the Node 24 permission model restricted to `--allow-fs-read=<pluginDir>/<pkg>` and no child processes, environment scrubbed to `{ NODE_ENV, LOG_LEVEL }`, `--max-old-space-size=512`) and talks to it over a JSON-only message-port `ctx` proxy (`AbortSignal`, streaming deltas and credential lookups are marshalled as messages; the host receives only the credential slots the executing node declared). A crashed host is restarted and the node fails with `PLUGIN_HOST_CRASHED`. This is a **process boundary for admin-trusted code**, not a sandbox: untrusted code belongs in the `code` pool (§10.7). The `NodeRegistry` is immutable after boot.

### 3.6 Tools

`ToolDefinition` (`CONTRACTS.ts` §13) is shared by Agent, MCP, OpenAPI, HTTP and workflow-as-tool. `ctx.tools.call(source, name, args)` validates args (ajv) after `coerceArgs` (ported from an Apache-2.0 upstream `parseWithTypeConversion`, attributed in NOTICE), checks `capability` against the bound credential's `scopes`, emits `TOOL_CALLED`/`TOOL_RETURNED`, forwards `ctx.node.idempotencyKey` for `keyed` tools, and returns `ToolResult`.

### 3.7 Testing harness

`createTestContext({ config, input, credentials, http: mockFetch, providers: fakes })` provides in-memory implementations of every `ctx` service and records emitted events; `runNode(def, ctx, input)` validates input/output like the runtime. Every node in `nodes-core` has Vitest coverage without a database.

---

## 4. Compiler (`@flowaid/workflow-compiler`)

Pure, synchronous, deterministic; runs in the API (save/publish), the worker (plan hash re-check), the browser (Web Worker, debounced 150 ms) and the CLI. Same package, so diagnostics never disagree. Inputs that are not JSON (tool signatures, subflow signatures, provider availability, bound secrets) are supplied by the caller through `CompileOptions`; the web app fetches them from `GET /v1/nodes`, `GET /v1/tools/catalog`, `GET /v1/workflows/:id/signature` and passes lookups.

### 4.1 Passes

1. **Schema** — `WorkflowDefinitionSchema.safeParse`; Zod issues → `E_SCHEMA` with JSON pointer. Stops here on failure.
2. **Catalog & config** — resolve `type@typeVersion` (`E_UNKNOWN_NODE_TYPE`, `E_NODE_VERSION_UNSUPPORTED`, `I_NODE_VERSION_OUTDATED` with a migrate fix); validate `config` with ajv against `configSchema` (`E_CONFIG_INVALID`, pointer); evaluate **port rules** against the config (`E_PORT_RULE_INVALID`, `E_TOOL_UNRESOLVED`); resolve `PlanNode.idempotency`; plugin id prefix (`E_PLUGIN_ID_PREFIX`); pool allowed (`E_POOL_NOT_ALLOWED`).
3. **Structure** — unique ids (`E_DUPLICATE_NODE_ID`, `E_DUPLICATE_EDGE_ID`), reserved ids, `W_DUPLICATE_NAME`; exactly one root `input`, ≥ 1 `output`; `parent` refers to a `loop|foreach` (`E_PARENT_NOT_CONTAINER`), depth ≤ 4; control edges resolve (`E_EDGE_ENDPOINT_MISSING`, `E_UNKNOWN_CONTROL_PORT`, `E_SELF_EDGE`, `E_EDGE_CROSSES_SCOPE`); secrets/variables declared (`E_SECRET_UNDECLARED`, `E_VARIABLE_UNDECLARED`); credential slots bound with matching types (`E_CREDENTIAL_SLOT_UNBOUND`, `E_CREDENTIAL_TYPE_MISMATCH`, `E_CAPABILITY_MISSING`); decision configs (`E_DECISION_CONFIG`: choice 2–255 options with keys `^[a-z0-9_]{1,64}$`, score 2–10 levels, non-empty instructions, boolean criteria both or none); human configs (`E_HUMAN_CONFIG`); retries on `none` nodes (`E_RETRY_ON_IRREVERSIBLE` unless `allowOnIrreversible` → `W_RETRY_SIDE_EFFECT`); `doNotPersist` on `none` nodes (`E_DONOTPERSIST_SIDE_EFFECT`); subflow signature (`E_SUBFLOW_UNRESOLVED`, `E_SUBFLOW_SIGNATURE`, `E_SUBFLOW_CYCLE`, `E_SUBFLOW_DEPTH`); triggers — two triggers of the definition with the same webhook `path`, MCP `toolName`, `cron`+`input` or event name (`E_TRIGGER_CONFLICT`; collisions with _other_ workflows are checked by the API at deploy time, §8). Pass 2 also reports an unrewritten template resource sentinel (`"serverId": "$template.mcp.<key>"`, §11) as `E_TOOL_UNRESOLVED` with a quick-fix that opens the resource picker.
4. **Bindings & expressions** — parse every template/expression (`E_TEMPLATE_SYNTAX`, `E_EXPR_SYNTAX` with ranges); resolve every `Ref` (`E_REF_UNKNOWN_NODE`, `E_REF_UNKNOWN_PORT`, `E_REF_PATH_INVALID`, `W_REF_PATH_UNTYPED`, `E_REF_SELF`, scope rules `E_REF_SCOPE_VIOLATION` / `E_SCOPE_REF_OUTSIDE_SCOPE`); required ports bound (`E_INPUT_REQUIRED_MISSING` with candidate-port fixes), unknown ports (`E_INPUT_UNKNOWN_PORT`), literals valid (`E_INPUT_LITERAL_INVALID`).
5. **Dependency & guards** — build data deps from bindings (hoisting outward refs to the container), control deps from edges; Tarjan SCC over the union graph per scope (`E_CYCLE`); reachability from `input` (`W_UNREACHABLE`; `E_DANGLING_DEPENDENCY` if a reachable node depends on an unreachable one); **guard analysis** (§4.3) → exclusive groups (`E_CONTROL_AMBIGUOUS`, `I_CONTROL_AND`), `E_CONDITIONAL_DATA_DEP` / `W_NULLABLE_INPUT`, `W_IMPOSSIBLE_BRANCH`, `W_BRANCH_SHADOWED`, `W_UNREACHABLE_ROUTE` (router option absent from the upstream enum), `W_OUTPUT_AMBIGUOUS`, `W_CONTROL_PORT_UNCONNECTED`, `I_DANGLING_OUTPUT`; join checks (`E_JOIN_CONFIG`); loops (`W_LOOP_NO_EXIT`, `W_LOOSE_BOUNDS`, `E_CARRY_TYPE_MISMATCH`); foreach (`E_FOREACH_NOT_ARRAY`, `E_FOREACH_COLLECT_MISSING`); race private subgraphs.
6. **Types** — for every data dependency `isSubschema(projectSchema(producer, path), consumer)` → `E_TYPE_MISMATCH` / `W_TYPE_UNVERIFIED`; expression typer (`E_EXPR_TYPE`, `W_EXPR_UNTYPED`, `E_EXPR_NOT_BOOLEAN`); template holes (`E_TEMPLATE_OBJECT_COERCION`); output nodes vs `outputs` (`E_OUTPUT_UNBOUND`, `E_OUTPUT_SCHEMA_MISMATCH`).
7. **Environment** (when options are given) — provider/model availability (`E_PROVIDER_UNAVAILABLE` at publish / `W_PROVIDER_UNAVAILABLE` at draft, `W_MODEL_DEPRECATED`), failover hops without configuration (`W_FAILOVER_UNCONFIGURED`), secret bindings (`E_SECRET_UNBOUND` publish / `W_SECRET_UNBOUND` draft), `W_SECRET_UNUSED`, `W_VARIABLE_UNUSED`, cost estimate (`W_COST_ESTIMATE`).
8. **Emit** — `ExecutionPlan`: scopes with deterministic topological order (Kahn, ties by node id), resolved policies (workflow default ← manifest default ← node override), redaction rules from `x-dataClass` and `privacy.redactFields`, decision batch groups (§4.4), `dataEdges` for the canvas, `catalogSnapshot`, `planHash`.

Errors stop after their pass group (1 alone; 2–3 together; 4–6 together; 7–8 only when no errors). Warnings never block publish; they are shown in the publish dialog and stored on the version.

### 4.2 Port rules (browser-identical dynamic ports)

| rule                                   | reads                                                        | produces                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controlPortsFromConfig{path}`         | `config[path]`: `string[]` or object keys                    | one control-out per entry (Decision Router routes, choice options)                                                                                       |
| `outputSchemaFromConfig{port,path}`    | `config[path]`: JSON Schema                                  | schema of output `port` (Code, Transform, Schema Validate, Structured Generation)                                                                        |
| `inputSchemaFromConfig{port,path}`     | `config[path]`: JSON Schema                                  | schema of input `port` (Code, Form-like nodes)                                                                                                           |
| `decisionAnswersFromConfig{port,path}` | `config[path]`: `Record<id, DecisionQuestion>`               | `port` schema = object with one `DecisionResultJsonSchema[kind]` property per question (Batch)                                                           |
| `toolSignature{source}`                | `CompileOptions.resolveTool({ kind: source, … config ids })` | input ports = top-level properties of the tool's `inputSchema`; outputs `result` (structured) and `content` (text); `PlanNode.idempotency` from the tool |

Rules are evaluated in manifest order; a rule that cannot be evaluated (missing config value, unresolved tool) is `E_PORT_RULE_INVALID` / `E_TOOL_UNRESOLVED` and the node's ports fall back to the static manifest so the rest of the graph still compiles.

### 4.3 Guard analysis and exclusive groups

For every node `n` the compiler computes `guard(n)`: a DNF over `(branchNode, port)` literals, bounded to 64 clauses (beyond that the guard is widened to `[[]]` and `W_TYPE_UNVERIFIED`-style precision is lost, never soundness of pruning — the runtime prunes by actual edge state, guards only drive diagnostics and grouping).

- `guard(input) = [[]]`.
- For a control edge `e` from `(src, port)`: `guard(e) = guard(src) ∧ (src, port)` when `src` is a `branch` in `first` mode or a `human`/router-style task whose fired ports are exclusive; otherwise `guard(e) = guard(src)`. (A `branch` in `all` mode and a task's `done`/`failed` pair are not exclusive-by-port except `done` vs `failed`.)
- Data-activated node: `guard(n) = ∧ guard(producer)` over required data deps (DNF product, simplified).
- Node with control edges: groups first (below), then `guard(n) = ∧_groups (∨_{e ∈ group} guard(e))`, additionally conjoined with required data producers' guards.
- Two edges `e1, e2` are **exclusive** iff every pair of clauses `(c1 ∈ guard(e1), c2 ∈ guard(e2))` contains contradictory literals (same branch node, different port). Groups are the connected components of the exclusivity graph; a non-clique component is `E_CONTROL_AMBIGUOUS` (the message names the two edges that can co-fire and suggests a `join`).
- A required data producer `p` of consumer `n` is conditional iff `guard(p) ⊉ guard(n)` (there is a clause of `guard(n)` not implied by any clause of `guard(p)`): `E_CONDITIONAL_DATA_DEP` for refs without `default`, `W_NULLABLE_INPUT` with one. Refs inside `coalesce(x, …)` and join `inputs` count as defaulted.
- `W_IMPOSSIBLE_BRANCH`: a case whose predicate contradicts `guard(branch)` (literal comparisons on enum-typed refs only); `W_BRANCH_SHADOWED`: a case implied by an earlier one.
- Output ambiguity: two output nodes are exclusive iff their guards are pairwise contradictory; otherwise `W_OUTPUT_AMBIGUOUS`.

### 4.4 Decision batch groups

TypeSafe's native batching is "several questions over the same `state` in one request". The compiler finds it statically: a batch group is a maximal set of decision task nodes in the same scope whose `state` binding ASTs are identical (`stateBindingHash`), whose resolved primary hop is identical, whose credential slot resolves to the same secret, that have identical guards and no dependency path between them. Groups are stored in `plan.batchGroups` and on each member's `batchGroup`; the runtime issues one provider request per group (`DECISION_REQUESTED{batchId, questionCount}`) and one `DECISION_COMPLETED` per member with the shared `requestId` and usage split proportionally by question text length. Deterministic across replays; visible in the plan and in the `I_BATCH_GROUP` info diagnostic. The explicit `flowaid.decision.batch` node exists for authors who want one node with N questions.

### 4.5 Type compatibility — `isSubschema(S, T)`

Is every value valid under `S` also valid under `T`? Implemented in `workflow-core/src/schema/subset.ts` over normalised schemas (local `$ref`/`$defs` resolved, `allOf` collapsed, missing `type` = any, `enum`/`const` as literal sets, `nullable` as `type: [..,'null']`):

- `T` unconstrained (`{}`/`true`) ⇒ ok. `S` unconstrained into a constrained `T` ⇒ **ok with `verified: false`** (`W_TYPE_UNVERIFIED`; the runtime validates on delivery). This is the deliberate answer to `z.json()` HTTP bodies flowing into typed ports without forcing a Schema Validate node everywhere.
- `type` sets: `S.type ⊆ T.type` (`integer ⊆ number`). `enum(S) ⊆ enum(T)`; `S` typed vs `T` enum ⇒ fail.
- Numbers: `[S.min, S.max] ⊆ [T.min, T.max]`, `multipleOf` divisibility. Strings: length bounds; `pattern`/`format` equal or absent on `T`, differing ⇒ unverified.
- Arrays: `items`, `prefixItems` positional, bounds, `uniqueItems` implication. Objects: every `T.required` ∈ `S.required` and recurse; `S` property not in `T` with `T.additionalProperties === false` ⇒ fail; `additionalProperties` schemas recurse.
- `anyOf/oneOf` on `S`: every alternative ⊆ `T`; on `T`: `S` ⊆ some alternative. `if/then`, `patternProperties`, `dependentSchemas`, `not`, unknown keywords ⇒ unverified.
- Depth limit 32; recursive `$ref` ⇒ unverified.

Property-tested with fast-check (reflexive, transitive) and table-tested. The canvas calls the same function in `isValidConnection` and the compiler calls it on every data dependency. `projectSchema(S, pointer)` walks `properties`/`items`/`prefixItems`/`additionalProperties`; a missing property under `additionalProperties: false` ⇒ `E_REF_PATH_INVALID`; through an `additionalProperties` schema ⇒ that schema; unknown ⇒ `{}` + `W_REF_PATH_UNTYPED`. A pointer that steps _through_ a level admitting `null` (`type: [..,'null']`, a `null` `anyOf` alternative) is admitted with the additive result flag `nullable: true` (the compiler advises a binding `default`); the runtime twin `projectValue` treats a `null` level like an absent property (`value: undefined`, so the `default` applies) and `createEvalScope` resolves paths through `projectValue` (absence ⇒ `null`, a step into a scalar ⇒ `ExpressionError` `TYPE`).

### 4.6 Diagnostics

`Diagnostic` (`CONTRACTS.ts` §12) carries `location { nodeId, edgeId, port, path, bindingPath, range, scope }` so the inspector can render a red ring on a port, a field-level error, or a squiggle inside a template, plus optional RFC 6902 `fix` patches for the quick-fix menu and the AI critic. The full code list is the `DiagnosticCodeSchema` enum; severities: `E_*` error, `W_*` warning, `I_*` info.

### 4.7 Diff and migration

`diff(a, b): WorkflowDiff` = `{ nodes: { added, removed, changed: { id, patch: JsonPatch }[] }, edges: { added, removed }, inputs, outputs, variables, secrets, execution, layoutOnly }` over canonical definitions. `migrateDefinition(def, catalog)` applies node `migrations` chains and returns `{ def, applied: { node, from, to }[] }`.

---

## 5. Runtime (`@flowaid/workflow-runtime`, `apps/worker`)

### 5.1 Invariants

1. **The event log is the truth.** `run_events(run_id, seq)` is append-only; `seq` is dense and unique per run. `runs`, `node_runs`, `human_tasks`, `run_timers` projections are maintained in the _same transaction_ as the append and can be rebuilt from events (`flowaid db reproject <runId>`; CI asserts `project(events) ≡ rows` after every golden scenario).
2. **Single writer per run, fenced.** Exactly one worker holds the lease (`runs.lease_owner`, `runs.lease_until`). Every append runs `UPDATE runs SET last_seq = last_seq + $n WHERE id = $1 AND lease_owner = $2 AND last_seq = $expected RETURNING last_seq` before inserting; zero rows ⇒ `WorkerLostError` and the worker drops the run. `RUN_CREATED` is the only event written without a lease (by the API, in the transaction that inserts the run, when `last_seq = 0`).
3. **Deterministic reduction.** `reduce(plan, state, event)` and `ready(plan, state)` are pure; replaying a log yields an identical `SchedulerState`.
4. **Effects are outside the reducer.** Executing a node, setting a timer, enqueuing a job, creating a human task and publishing SSE are effects returned by `step()`, performed after commit, idempotent by id.
5. **Nothing blocks in memory.** Timers, human tasks, subflows, delegated nodes and retry waits release the lease; resumption is a job.

### 5.2 Run state machine

```
queued ──(worker claims; RUN_STARTED)──▶ starting ──(entry nodes scheduled)──▶ running
running ──(only waiting nodes remain: timer/subflow/event/delegated)──▶ waiting
running ──(only human-waiting nodes remain)──▶ waiting_for_human
running ──(only retry timers remain)──▶ retrying
waiting | waiting_for_human | retrying ──(RUN_RESUMED)──▶ running
running ──(root scope drained with ≥1 RUN_OUTPUT, or earlyExit)──▶ completed
running | waiting* | retrying ──(RUN_FAILED)──▶ failed
any non-terminal ──(RUN_CANCEL_REQUESTED → abort → RUN_CANCELLED)──▶ cancelled
any non-terminal ──(deadline; RUN_TIMED_OUT)──▶ timed_out
```

`status` is `reduce(...).run.status` projected onto `runs.status`. A run with a suspended human node _and_ other running nodes reports `running`; the run-level status describes whether anything is executing.

### 5.3 SchedulerState and reducer

```ts
interface EdgeState {
  status: "pending" | "fired" | "pruned";
}
interface NodeState {
  status: NodeRunStatus | "idle"; // idle = no node run yet in this scope
  nodeRunId: string | null;
  attempt: number;
  firedPorts: PortName[];
  outputRef: { inline: JsonValue } | { artifact: string } | null; // never large values inline in state
  waiting: { reason: WaitReason; ref: string; state: JsonValue | null } | null;
  retryTimerId: string | null;
  usage: TokenUsage;
  costUsd: number;
}
interface ScopeState {
  path: ScopePath;
  planScope: ScopeId;
  parent: { path: ScopePath; nodeId: NodeId } | null;
  nodes: Record<NodeId, NodeState>;
  edges: Record<EdgeId, EdgeState>;
  iterationInput: { item?: JsonValue; index?: number; iteration?: number; carry?: JsonObject };
  drained: boolean;
}
interface SchedulerState {
  run: {
    status: RunStatus;
    lastSeq: number;
    usage: TokenUsage;
    costUsd: number;
    nodeRunCount: number;
    cancelRequested: boolean;
    startedAt: string | null;
    deadlineAt: string | null;
    outputs: { nodeId: NodeId; output: JsonValue; outcome: string | null }[];
  };
  scopes: Record<ScopePath, ScopeState>;
  loops: Record<
    string /* scopePath/nodeId */,
    {
      iteration: number;
      carry: JsonObject;
      lastResult: JsonObject | null;
      startedAt: string;
      usage: TokenUsage;
      costUsd: number;
    }
  >;
  foreach: Record<
    string,
    {
      total: number;
      started: number;
      done: number;
      results: (JsonValue | null)[];
      errors: (ErrorInfo | null)[];
      reduced: JsonValue | null;
    }
  >;
  joins: Record<string, { arrived: Record<EdgeId, "fired" | "pruned">; done: boolean }>;
  timers: Record<
    string,
    { fireAt: string; purpose: TimerPurpose; scope: ScopePath; nodeId: NodeId; nodeRunId: string }
  >;
  humanTasks: Record<
    string,
    { scope: ScopePath; nodeId: NodeId; nodeRunId: string; status: "open" | "done" | "expired" }
  >;
  subruns: Record<string, { scope: ScopePath; nodeId: NodeId; nodeRunId: string }>;
  batches: Record<string, { scope: ScopePath; nodeRunIds: string[] }>;
}
function initialState(plan: ExecutionPlan): SchedulerState;
function reduce(plan: ExecutionPlan, s: SchedulerState, e: DurableRunEvent): SchedulerState; // pure, structural sharing
function ready(plan: ExecutionPlan, s: SchedulerState): ReadyItem[]; // [{ scope, nodeId, action: 'run' | 'prune' }] sorted (scope depth, plan order)
```

Reducer rules that matter for correctness:

- `NODE_COMPLETED{firedPorts}` → node `completed`; each control-out edge becomes `fired` if its port ∈ `firedPorts` else `pruned`; data dependencies on this node are settled. `NODE_FAILED{terminal:true, firedPorts:['failed']}` behaves like a completion with only `failed` fired. `NODE_FAILED{terminal:true}` with no fired ports fails the scope: root ⇒ `step` emits `RUN_FAILED`; inside a foreach item scope ⇒ the item fails per `failurePolicy`; inside a loop iteration ⇒ `LOOP_EXITED{body_failed}` and the loop node fails/routes per its policy.
- Pruning is explicit in the log: `ready()` returns `{ action: 'prune' }` for nodes whose group/data conditions can no longer be met and `step` emits `NODE_SKIPPED{pruned}`, which the reducer then applies (prunes all its control-outs, settles its data deps as absent).
- `NODE_RETRIED{timerId}` → `retry_wait`; `TIMER_FIRED{purpose:'retry'}` → node back to `idle` with `attempt + 1` (immediately ready again; edges unchanged).
- Scope drain: when a non-root scope has no ready/running/waiting nodes, `drained = true`; `step` invokes the parent kind handler (loop/foreach) which appends the iteration event and opens the next scope or completes the container.
- Run completion per §2.7. Usage/cost roll-up on `NODE_COMPLETED`/`GENERATION_COMPLETED`/`DECISION_COMPLETED` into run, scope and enclosing loop/foreach accumulators; `step` checks `maxCostUsd`/`maxTokens`/`maxNodeRuns`/deadline after every reduction and emits `LOOP_EXITED{max_cost|max_tokens|timeout}` or `RUN_FAILED{BOUNDS_EXCEEDED}`. Irreversible actions are never cut mid-flight: the crossing node completes, then the run fails.

### 5.4 step() and effects

```ts
type Trigger =
  | { type: "start" }
  | { type: "node_result"; nodeRunId: string; result: ExecutorOutcome }
  | { type: "batch_result"; batchId: string; results: Record<string, ExecutorOutcome> }
  | { type: "timer"; timerId: string }
  | { type: "human_response"; humanTaskId: string; response: HumanResponse; by: string }
  | { type: "event"; eventName: string; payload: JsonValue }
  | {
      type: "subflow_completed";
      childRunId: string;
      status: RunStatus;
      output: JsonValue | null;
      error: ErrorInfo | null;
    }
  | { type: "delegated_result"; nodeRunId: string; result: ExecutorOutcome }
  | { type: "cancel"; by: string; reason: string | null }
  | { type: "manual_retry"; nodeRunId: string; by: string }
  | { type: "recovered"; lostNodeRunIds: string[] };
type Effect =
  | { type: "execute"; scope: ScopePath; nodeId: NodeId; nodeRunId: string }
  | { type: "execute_batch"; batchId: string; nodeRunIds: string[] }
  | { type: "delegate"; pool: WorkerPool; nodeRunId: string }
  | { type: "set_timer"; timer: RunTimer }
  | { type: "cancel_timer"; timerId: string }
  | { type: "create_human_task"; humanTaskId: string; nodeRunId: string; request: HumanRequest }
  | {
      type: "enqueue_child_run";
      childRunId: string;
      workflowId: string;
      versionId: string | null;
      input: JsonValue;
      parentNodeRunId: string;
    }
  | { type: "cancel_child_run"; childRunId: string }
  | {
      type: "abort_node";
      nodeRunId: string;
      reason: "run_cancelled" | "race_lost" | "early_exit" | "parent_failed";
    }
  | { type: "release_lease" }
  | { type: "publish"; fromSeq: number; toSeq: number };
interface StepResult {
  events: DurableRunEvent[];
  effects: Effect[];
}
function step(
  plan: ExecutionPlan,
  s: SchedulerState,
  trigger: Trigger,
  ids: IdSource,
  now: string,
  recorded?: RecordedOutputs,
): StepResult; // pure
```

`Orchestrator.handle(trigger)`: (1) load state (in-memory if this worker holds the lease, else `recover()`); (2) `step()`; (3) one transaction: `appendEvents` with fencing + projections + `run_timers`/`human_tasks` rows + `queue_jobs` for child runs; (4) `EventBus.publish('run:<id>', { runId, fromSeq, toSeq })`; (5) perform effects (executions tracked in `active: Map<nodeRunId, AbortController>`; an `execute` for a nodeRunId that already has a live promise is ignored); (6) if nothing is active and `ready()` is empty: `release_lease` and complete the job. Triggers are serialised per run with an async mutex inside the worker; across workers the lease serialises.

### 5.5 Node outputs — storage and addressing

Address `(runId, scope, nodeId, attempt)` ⇒ a `node_runs` row. Outputs ≤ 64 KiB canonical JSON are stored inline in `node_runs.output` and in `NODE_COMPLETED.output`; larger values go to the artifact store (`runs/<runId>/node-runs/<nodeRunId>/output.json`) and both hold `{ "$artifact": id }` (`run_events.payload` has a 256 KiB check constraint). Binding resolution for a consumer walks from its scope outward to the nearest scope where the producer has completed (hoisted deps guarantee it exists), applies `projectSchema`'s runtime twin `projectValue`, renders templates/expressions with the bounded evaluator, and validates the assembled value against the consumer port schema (`SCHEMA_VALIDATION_ERROR`, not retried) — also when the compile-time check was only `W_TYPE_UNVERIFIED`. Redaction (§10.6) runs before persistence; `doNotPersist` outputs live only in worker memory and are stored as `{ "$redacted": true }` (such runs are not replayable past that node; `runs.privacy.replayable = false`).

### 5.6 Checkpoints and recovery

`run_checkpoints(run_id, seq, state)` is written every 200 events, on every `release_lease`, and before a terminal event; `state` holds output refs only (O(nodes)). `recover(runId)` = latest checkpoint ≤ `last_seq` + `reduce` over `run_events WHERE seq > checkpoint.seq`. Lease TTL 30 s, renewed every 10 s; a reaper on every worker runs every 15 s: `SELECT … FROM runs WHERE lease_until < now() AND status IN ('starting','running','retrying') FOR UPDATE SKIP LOCKED LIMIT 10`, takes the lease (`RUN_LEASE_TAKEN{expired}`), recovers, and for every node in `running` state without a terminal event: `idempotency ∈ {safe, keyed}` ⇒ `NODE_RETRIED{error: WORKER_LOST, delayMs: 0}` (not counted against `maxAttempts`); `none` ⇒ `NODE_FAILED{NONIDEMPOTENT_INTERRUPTED, terminal}` per `onError`, and the UI offers **Retry node** (an explicit, audited human decision). Waiting nodes need nothing: their human task, timer or child run is durable. The reaper also fires overdue `run_timers` (§5.11), so timers survive Redis loss.

### 5.7 Human suspension and resume

1. Human node ready → `step` emits `HUMAN_APPROVAL_REQUESTED{request}`, `NODE_WAITING{human}`, optional `TIMER_SET{human_expiry}` / `TIMER_SET{human_escalation}`; effect `create_human_task` inserts `human_tasks` (`status='open'`, assignees, `expires_at`, `review_token_hash` when `externalReview`). Task-node suspensions (`NodeResult.suspend` with `wait.kind='human'`) follow the same path with `origin: 'task_suspend'` and `NODE_WAITING.state`.
2. When nothing else is runnable: `RUN_WAITING{human}`, lease released.
3. `POST /v1/human-tasks/:id/respond` → API checks the caller may respond (assignee/RBAC or review token), validates `HumanResponse` against `request.mode` (edit/form values against the JSON Schema), then **one transaction**: `human_tasks` CAS `open → responded` (409 `CONFLICT` if not open), then enqueue `run.resume{reason:'human'}`. The API appends no run events.
4. A worker takes the job, acquires the lease (`RUN_LEASE_TAKEN{resume}`), recovers, `handle({ type:'human_response' })` → `HUMAN_APPROVAL_RECEIVED`, `NODE_COMPLETED{output:{decision, value}, firedPorts:[outcome]}` (or re-invokes `execute` with `ctx.resume` for task suspensions), `RUN_RESUMED`.
5. `escalate` responses reassign (`HUMAN_TASK_ESCALATED{reviewer}`) and keep the task open. Expiry timer → `HUMAN_TASK_EXPIRED{action}`: `fail` ⇒ `NODE_FAILED{HUMAN_TASK_EXPIRED}`; `route` ⇒ completion firing `expired`; `escalate` ⇒ reassign to `escalation.to` with a fresh expiry.

Everything lives in `human_tasks` + events; a restart between any two steps loses nothing. External links: `POST /v1/human-tasks/:id/review-link` mints a 32-byte token (hash stored, TTL ≤ 7 d, single-use); the review page shows only `request` and posts through the `review_token` principal; responses are audited as `actor_type='review_token'`.

### 5.8 Retries, cancellation, idempotency keys, timeouts

- **Retry**: on `NODE_FAILED` with `error.retryable` (or `code ∈ retryOn`), `attempt < maxAttempts`, and `idempotency !== 'none'` (or `allowOnIrreversible`): `NODE_RETRIED{delayMs, timerId}` + `TIMER_SET{retry}`. Delay = backoff with full jitter, `ProviderRateLimitedError.retryAfterMs` wins. **All** retry waits are durable timers; the worker never sleeps holding the lease. If nothing else is active the run goes to `retrying` and the lease is released.
- **Idempotency keys**: `idempotencyKey = base64url(sha256(runId|scope|nodeId|inputHash))[:32]`, stable across attempts, exposed as `ctx.node.idempotencyKey`, forwarded by `ctx.http` (`Idempotency-Key`) and tools for `keyed` nodes. Run level: `Idempotency-Key` header on `POST …/run` ⇒ `runs.idempotency_key` unique per workspace; a repeat returns the existing run (409 `CONFLICT` if the body hash differs).
- **Cancellation**: `POST /v1/runs/:id/cancel` does not append events. It sets `runs.cancel_requested_at/by/reason` and publishes `run:<id>:control`. The lease holder subscribes to that channel and also re-reads the flag on every heartbeat (works without Redis); it then appends `RUN_CANCEL_REQUESTED`, aborts every active `AbortController` (`ctx.signal` propagates into fetch, providers, MCP, sandbox), waits ≤ 5 s, appends `NODE_CANCELLED{run_cancelled}` per node, cancels timers and child runs, and appends `RUN_CANCELLED`. If no worker holds the lease (queued/waiting/retrying), the API additionally enqueues `run.control{cancel}`; any worker takes the lease and performs the same sequence, closing open human tasks (`status='cancelled'`).
- **Timeouts**: node timeout via `AbortSignal.timeout(policy.timeoutMs)` combined with the run signal ⇒ `TimeoutError` (retryable). Run deadline `deadlineAt` from `RUN_STARTED`; a `run_timers` row with purpose `run_deadline` makes a waiting run time out too; `step` never schedules past the deadline and emits `RUN_TIMED_OUT`.

### 5.9 Replay, restart-from-node, fork, retry-node

All create a **new run** except retry-node; the original is immutable.

- **Replay** `POST /v1/runs/:id/replay { mode: 'reexecute' | 'recorded', versionId? }`: same input, `origin: 'replay'`, `sourceRunId`. `recorded` seeds `RecordedOutputs` keyed `(nodeId, scope, inputHash)` from the source run (`inputHash = sha256(canonical(resolvedInputs) + canonical(renderedConfig) + typeVersion)`); a node whose hash matches is emitted as `NODE_SCHEDULED{reusedFromNodeRunId}` + `NODE_COMPLETED{reused:true}` (status `reused`) with the recorded output/decision, no execution. Replaying against v2 therefore re-runs only nodes whose inputs or config changed — exactly "edit → publish v2 → compare".
- **Restart from node** `POST /v1/runs/:id/restart { nodeId, scope?, versionId?, input? }`: recorded replay in which the target node and everything downstream of it (successor closure) are never reused; `input` overrides the target's resolved ports. The target must exist in the target version (409 otherwise); upstream nodes that changed simply re-execute because their hash differs.
- **Fork** `POST /v1/runs/:id/fork { versionId, nodeId?, input?, variables? }`: restart against a different (usually draft) version with patched run input/variables; `origin: 'fork'`.
- **Retry node** `POST /v1/runs/:id/node-runs/:nodeRunId/retry`: only for `failed` runs; enqueues `run.resume{manual_retry}` → `NODE_RETRIED{delayMs:0, error: manual}` → the run returns to `running`. Audited.

### 5.10 Loops, foreach, join, race

Loop `L` in scope `S` at iteration `n` opens scope `S/L#n` with `iterationInput = { iteration: n, carry }`; body entries become ready; on drain the handler evaluates `carry.next`, `result` and `exitWhen` in that scope, appends `LOOP_ITERATION_COMPLETED{carry, result, exit}`, checks bounds _before_ opening `n+1` (`iterations`, `timeoutMs`, `maxCostUsd`, `maxTokens` of the loop subtree) and appends `LOOP_EXITED{reason}` then `NODE_COMPLETED{result, carry, iterations}` firing `done` (exit condition) or `exhausted` (bounds, when `onExhausted='route'`). Foreach resolves `items` (runtime assert array), caps at `maxIterations` (extra items ⇒ `errors[i] = BOUNDS_EXCEEDED`), runs ≤ `concurrency` item scopes `S/F#i` with `{ item, index }`, records `FOREACH_ITEM_COMPLETED`, applies `failurePolicy` (`fail_fast` aborts siblings and fails the node; `collect` records errors and continues; `skip` sets `results[i] = null`), reduces sequentially by index, then completes. Suspension inside an iteration is fine: several iterations may wait at once (`humanTasks`/`waiting` are keyed by nodeRunId); the run status becomes `waiting_for_human` only when nothing is running. Join state is per scope (reset each iteration).

Join `J` expects its incoming control edges: `all` ⇒ ready when every edge is resolved (pruned edges recorded as `JOIN_ARRIVED{pruned}` and `values[name] = null`); `any` ⇒ first fired edge; `count n` ⇒ n fired; `race` ⇒ first fired, then `abort_node{race_lost}` for running nodes and `NODE_SKIPPED{race_lost}` for pending nodes in the losing inputs' **private subgraphs** (compiler-computed: nodes in the same scope that are dependency-ancestors of that input's source and of nothing outside the join's inputs). `timeoutMs` uses a `join_timeout` timer; on fire the join completes with the arrivals so far and fires `timeout`. Plain fan-out needs no join: several fired control-outs (or several control edges from `done`) make all successors ready in the same step; the orchestrator runs up to `execution.concurrency` node runs concurrently.

### 5.11 Timers, queue and worker design

```ts
export type QueueName =
  | `run:${WorkerPool}`
  | "run:control"
  | "schedule"
  | "ingest"
  | "evaluation"
  | "trace_review"
  | "jobs"
  | "maintenance";
// Job union: run.start | run.resume | run.control | run.signal | node.exec | timer.fire | schedule.tick | ingest.source | evaluation.run | trace_review.run  (CONTRACTS.ts §17)
//            | export.package (queue 'jobs')  | retention.sweep | partition.ensure | draft_versions.gc (queue 'maintenance')   — RFC-0001 in RFCS.md; CONTRACTS.ts §17 is updated when the RFC is accepted
```

- **Timers** are rows in `run_timers` (authoritative). `BullMqQueueDriver.scheduleTimer` adds a delayed `timer.fire` job as an accelerator; `PgQueueDriver` polls due rows. Firing is idempotent: `markTimerFired` is a CAS on `fired_at IS NULL`, so an accelerator job and the reaper cannot both fire a timer.
- **BullMqQueueDriver** (`REDIS_URL` set): one BullMQ queue per `QueueName`; deterministic `jobId`s (`run:<id>:start`, `timer:<id>`) for dedupe; `attempts: 1` (retries are the runtime's job, so semantics are identical with and without Redis); Redis pub/sub `EventBus`; Bull Board at `/admin/queues` is mounted only when `FLOWAID_QUEUE_UI=true`, behind the session auth hook with scope `admin` (its job views show raw `run.start` payloads, so it never ships enabled by default).
- **PgQueueDriver** (no Redis): `queue_jobs` claimed with `FOR UPDATE SKIP LOCKED`, `run_at` for delays, `locked_by/locked_until`, `LISTEN/NOTIFY` to wake pollers; multiple API/worker replicas share work over Postgres alone. `PgEventBus` uses `NOTIFY run_events` with id-only payloads. Both drivers pass the same contract test suite. The default compose runs api + worker + web + postgres + minio without Redis; `docker compose --profile scale up` adds Redis and worker replicas.
- **Worker process**: consumes the pools it is configured for (`WORKER_POOLS=general,retrieval`); a run's orchestration is pinned to `general`; nodes whose `pool` differs are dispatched as `node.exec` jobs (`NODE_DELEGATED`) executed by that pool's worker in its sandbox, reporting back through `run.signal{delegated_result}` with a 2 s DB fallback poll on `node_runs`. The `code` pool is a separate container (`worker-code`) hosting `isolated-vm`. Backpressure: `POST …/run` returns 429 when the workspace backlog exceeds `workspaces.settings.maxQueuedRuns` (default 1000). The `jobs` queue carries long-running API-initiated work (`export.package`); the `maintenance` queue carries `retention.sweep` (`RETENTION_SWEEP_CRON`, default `0 3 * * *`), `partition.ensure` and `draft_versions.gc`. The scheduler (`jobs/schedule.ts`, `croner`) polls `schedules` every 15 s with `FOR UPDATE SKIP LOCKED`, creates runs with `origin: 'schedule'` and `idempotency_key = 'schedule:<id>:<fireAtIso>'` so replicas cannot double-fire, honours `overlap`, `catch_up`, `max_catch_up` and `jitter_ms`, and records `last_error` (audit `schedule.fired`).
- **API process** never runs nodes; it enqueues `run.start` and serves reads, SSE and webhooks.

### 5.12 Streaming and SSE fan-out

After each commit the worker publishes `{ runId, fromSeq, toSeq }`; ephemeral `GENERATION_DELTA` (batched every 30 ms) and `HEARTBEAT` are published directly without DB writes. The API SSE handler (`GET /v1/runs/:id/stream`): (1) sends durable events from the DB with `seq > Last-Event-ID` (or `?after`), (2) subscribes to `run:<id>`, (3) on notification re-reads `(lastSent, toSeq]` from the DB — never trusting the payload — and forwards ephemeral payloads as-is without `id`, (4) `: heartbeat` every 15 s, (5) ends with `event: END` after a terminal event (or after the first `RUN_WAITING` when `?until=suspend`). Sync runs are server-side subscribers with `waitTimeoutMs` (default 60 s, max 300 s).

### 5.13 Accounting

`ModelCatalog.price()` returns `costUsd` and a `PriceSnapshot` at emit time; `GENERATION_COMPLETED` and `DECISION_COMPLETED` carry both, so historical cost never drifts. TypeSafe: `inputTokens × 0.042 / 1e6`, output free. `node_runs.cost_usd/usage/latency_ms` are projections; `runs.cost_usd/usage` are running sums maintained in the append transaction; loop/foreach accumulators live in `SchedulerState` for bounds. `latencyMs = NODE_COMPLETED.at − NODE_STARTED.at` of the last attempt; `queueLatencyMs = NODE_STARTED − NODE_SCHEDULED`.

---

## 6. Providers (`@flowaid/providers`, `provider-*`)

### 6.1 Interfaces

`DecisionProvider`, `GenerationProvider`, `EmbeddingProvider`, `ProviderFactory`, `ModelCatalog`, `ProviderHealth`, `DecisionQuestion`, `DecisionState`, `GenerationRequest/Result/Chunk` are in `CONTRACTS.ts` §15. `DecisionState` is exactly what TypeSafe accepts (`string | object | string[]`); objects are sent verbatim, which preserves field semantics like `customer_tier`.

### 6.2 Registry, catalog, failover, health

`ProviderRegistry` holds factories by `(kind, id)`; `registry.decision(hop, creds)` / `registry.generation(ref, creds)` resolve credentials through `CredentialAccess`, memoise per `(workspace, hop hash, credential id)`, and wrap the provider with accounting, `HealthTracker` and rate limiting. `ModelCatalog` merges `providers/src/catalog/*.json` (versioned in git, per provider) with the `models` table (workspace overrides, custom OpenAI-compatible endpoints) and live discovery (`GET /v1/models` on TypeSafe, `/models` on OpenAI, `/api/tags` on Ollama; cached 10 min).

`FailoverChain` walks `[primary, ...failover]` hops. It moves to the next hop on `ProviderError{retryable}`, `ProviderRateLimitedError`, `ProviderOverloadedError`, `TimeoutError`, `NetworkError`, or when the hop's circuit is open; it records a `ProviderAttempt` per hop and emits `PROVIDER_FAILOVER`. Non-retryable errors (401 credential, 422 invalid criteria) fail immediately — configuration bugs must surface, never silently degrade. Hops: `typesafe`, `llm` (`LLMDecisionProvider` over the referenced chat model), `rule` (requires `config.rules` on the node; skipped with a `LOG{warn}` otherwise), `human` (§3.2). The workspace default chain (`workspaces.settings.decisions`) applies when the definition's `execution.decisions` is untouched; the compiler sees it through `CompileOptions.defaultDecisions`.

`HealthTracker`: per `(provider, model, credentialId)` sliding 60 s window of error rate and p95 latency; `degraded` at ≥ 5 % errors, `down` (circuit open 30 s, one half-open probe) after 5 consecutive retryable failures or error rate > 50 % with ≥ 10 samples; mirrored to Redis when available so `GET /v1/providers/health` is cluster-wide. Rate limiting: a token bucket per credential (TypeSafe default 1 200 rpm from the catalog) applied inside the wrapper; when exhausted the call waits up to the signal/timeout instead of hitting 429.

### 6.3 TypeSafe provider (`@flowaid/provider-typesafe`) — exact mapping to the verified API

```ts
export const SystemOneQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("noul"),
    instructions: z.string().min(1),
    criteria: z.object({ true: z.string(), false: z.string() }).optional(),
  }),
  z.object({
    type: z.literal("choice"),
    instructions: z.string().min(1),
    criteria: z.record(z.string(), z.string()).refine((o) => {
      const n = Object.keys(o).length;
      return n >= 2 && n <= 255;
    }),
  }),
  z.object({
    type: z.literal("score"),
    instructions: z.string().min(1),
    criteria: z.array(z.string()).min(2).max(10),
  }),
]);
export const SystemOneRequestSchema = z.object({
  model: z.string().default("jev-latest"),
  state: z.union([z.string(), z.record(z.string(), JsonValueSchema), z.array(z.string())]),
  questions: z.record(z.string(), SystemOneQuestionSchema),
});
export const SystemOneAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number()),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().min(0),
    confidence: z.number().min(0).max(1),
    legend: z.record(z.string(), z.string()),
    probabilities: z.record(z.string(), z.number()),
  }),
]);
export const SystemOneResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), SystemOneAnswerSchema),
  usage: z.object({ input_tokens: z.int(), output_tokens: z.int() }),
});
export const SystemOneErrorSchema = z.union([
  z.object({ detail: z.object({ error_type: z.string(), message: z.string() }) }), // 401
  z.object({
    detail: z.array(
      z.object({
        type: z.string(),
        loc: z.array(z.union([z.string(), z.int()])),
        msg: z.string(),
        input: z.unknown().optional(),
      }),
    ),
  }), // 422
]);
export class TypeSafeClient {
  constructor(opts: {
    apiKey: string;
    baseUrl?: string /* https://api.typesafe.ai */;
    http: SafeFetch;
  });
  models(
    signal: AbortSignal,
  ): Promise<{ name: string; description: string; release_date: string }[]>; // GET /v1/models
  systemOne(
    req: z.infer<typeof SystemOneRequestSchema>,
    signal: AbortSignal,
  ): Promise<{
    body: z.infer<typeof SystemOneResponseSchema>;
    requestId: string | null;
    latencyMs: number;
  }>; // POST /v1/systemone
}
```

Mapping (`toSystemOneRequest` / `fromSystemOneAnswer`):

| flowaid question | TypeSafe question                                                        | answer → `DecisionResult`                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boolean`        | `{ type:'noul', instructions, criteria? }`                               | `pYes = noul`; `value = noul >= threshold` (0.5 default, node-configurable); `probabilities = { true: noul, false: 1−noul }`; `confidence = max(noul, 1−noul)`                                     |
| `choice`         | `{ type:'choice', instructions, criteria: options }` (key → description) | `value = choice`; `confidence`; `probabilities` as returned (keys validated ⊆ options)                                                                                                             |
| `score`          | `{ type:'score', instructions, criteria: levels }`                       | `value = score`; `normalized = score/(n−1)`; `level = round(score)`; `levelLabel = legend[level]`; `levels` from `legend` ordered by numeric key; `probabilities` keyed `"0".."n-1"`; `confidence` |

Common: `provider = 'typesafe'`, `model = response.model` (`jev-1.13.0`, never the alias), `usage = { inputTokens: input_tokens, outputTokens: output_tokens }`, `costUsd = inputTokens × 0.042/1e6`, `requestId = x-typesafe-request-id`, `raw = answers[id]`, `latencyMs`. `batch()` sends all questions in one request (keys = node ids inside a batch group, or the author's question ids in `flowaid.decision.batch`). Limits enforced client-side before the call: `state + longest question ≤ 32k` tokens and total ≤ 64k (estimate `chars/3.5`) ⇒ `BoundsExceededError('maxTokens')` with the hint "chunk the state (ForEach + Chunker)". Errors: 401 → `CredentialError`; 422 → `ProviderError{retryable:false, details: detail[]}` (no failover); 429 → `ProviderRateLimitedError` (honours `Retry-After`; the client retries ≤ 5× with jittered backoff 500 ms → 16 s inside the signal); 529 → `ProviderOverloadedError` (retryable, failover-eligible); other 5xx/network → `ProviderError{retryable:true}` / `NetworkError`. Images are unsupported (`capabilities.images = false`); an image-typed `state` port is `E_TYPE_MISMATCH`.

Decision nodes (`nodes-core/decision`): `boolean`, `choice`, `score`, `batch` (N questions, one state; output `answers` via `decisionAnswersFromConfig`), `confidence_gate` (input `decision`; config `threshold` (bindable), `requireValue?`, `reviewBand?`; control-outs `pass`, `review`, `fail`; outputs `decision` pass-through, `passed: boolean`, `outcome: 'pass' | 'review' | 'fail'`). **Gate semantics, defined once here and copied into the node's `configSchema` description**: `pass` iff `confidence ≥ threshold` and (`requireValue` is false or the decision is boolean with `value === true`); otherwise `fail` iff `reviewBand` is set and `confidence < threshold − reviewBand`; otherwise `review`. Without `reviewBand` the gate is two-way (`pass`/`review`, as in §2.9); with it the band `[threshold − reviewBand, threshold)` goes to review and everything below to `fail`; a `requireValue` failure routes `fail` when `reviewBand` is set, else `review`. The UI's two-threshold model maps onto this as `auto := threshold`, `review := threshold − (reviewBand ?? threshold)`, with outcome names `pass | review | fail`. `router` (choice decision → control-out per option via `controlPortsFromConfig{'/routes'}`, `minConfidence` else `review`). `consensus`: config `{ question: DecisionQuestion, voters: ProviderHop[] (2–5, pairwise distinct), method: 'majority' | 'confidence_weighted' | 'unanimous', minAgreement: number ∈ [0,1] (default 0.6) }`, input `state`, output `decision` — a `DecisionResult` of the question's kind with `provider: 'consensus'`, `model: 'consensus:v1'`, `probabilities` = confidence-weighted mean of the voters' distributions renormalised, `confidence = agreement × mean(voter confidence)` where `agreement` is the share of voters that agree with the winning value, `raw.votes: DecisionResult[]`, `attempts` = the voters' attempts concatenated, `costUsd` = Σ votes; control-outs `agreed` (agreement ≥ `minAgreement`) / `disagreed`; each vote is its own `DECISION_REQUESTED`/`DECISION_COMPLETED` sharing `batchId = nodeRunId`; excluded from compiler batch groups; `E_DECISION_CONFIG` for fewer than two or repeated voters. `validator`: inputs `value` (any) and optional `reference`; config `{ rubric: string, criteria?: { true, false }, threshold: number (default 0.5) }`; runs one boolean question ("does `value` satisfy the rubric?") over `{ value, reference? }`; output `decision` (boolean) plus `value` pass-through; control-outs `valid` / `invalid` (`pYes ≥ threshold`). Each decision node has credential slots `typesafe` (`typesafe.api_key`, optional) and `llm` (`openai.api_key | anthropic.api_key | ollama.host`, optional); the compiler requires the slot of the resolved primary hop to be bound.

### 6.4 LLMDecisionProvider (no-TypeSafe-key path)

Wraps a `GenerationProvider`. One structured request per `batch()` when the model supports JSON Schema (`strict: true`), else one call per question with a JSON-repair pass. Schema per question kind: boolean `{ p_yes: number[0,1] }`; choice `{ choice: enum(keys), probabilities: { key: number } }`; score `{ probabilities: number[n] }`. Post-processing: renormalise when the sum ∈ [0.9, 1.1] (else one automatic re-ask, then `ProviderError{retryable:false}`); boolean `confidence = max(p, 1−p)`; choice `value` must be a key (fuzzy match ≥ 0.9 similarity via the ported `findBestScenarioIndex`, attributed, and `confidence × 0.8` when fuzzy-mapped); score `value = Σ i·p_i`, `confidence = max p_i`. `provider = 'llm'`, `model = <underlying model>`, `raw` carries the prompt hash and reasoning (redacted per policy). Calibration is not assumed; the evaluation package reports ECE per provider.

### 6.5 RuleDecisionProvider

Deterministic, zero-cost. Node config `rules`: `{ kind, rules: [{ when: FlowExpr over $state, value, confidence? }], default: { value, confidence } }`; first match wins; probabilities one-hot scaled by confidence with the remainder spread uniformly; `provider = 'rule'`, `model = 'rule:v1'`. Because rules are FlowExpr, the compiler type-checks them like branch cases.

### 6.6 Generation providers

- **OpenAI-compatible client** (`providers/src/openai-compatible.ts`): `POST {baseUrl}/chat/completions` with `stream: true` + `stream_options.include_usage`; SSE parsing (`data: [DONE]`); tool-call deltas assembled by index; `response_format: { type: 'json_schema', json_schema: { name, schema, strict } }`; `usage.prompt_tokens_details.cached_tokens` → `cacheReadTokens`; `/embeddings`. Presets: OpenAI, Groq, Mistral, xAI, OpenRouter, vLLM, Together, custom (`models` rows with `provider = 'openai-compatible'`, `baseUrl`, `credentialType`).
- **Anthropic**: Messages API (`anthropic-version: 2023-06-01`), streaming events (`message_start`, `content_block_delta` text/thinking/input_json, `message_delta` usage/stop), tools via `tools`/`tool_use`, structured output via a forced tool `respond` with `input_schema`, `cache_control` on system prompts > 1k tokens, cache tokens surfaced.
- **Ollama**: `/api/chat` NDJSON streaming, `format: <json schema>`, `/api/embed`, `/api/tags` for discovery; cost 0.

All providers honour `ctx.signal`, translate HTTP errors into the taxonomy (401 → `CredentialError`, 429 → `ProviderRateLimitedError`, 529/503 → `ProviderOverloadedError`, other 5xx → retryable `ProviderError`, 4xx → non-retryable, `context_length_exceeded` → `BoundsExceededError('maxTokens')`), report `finishReason: 'content_filter'` for filtered completions (the node decides), and price usage through `ModelCatalog`.

---

## 7. Database (`@flowaid/database`) — decisions; full Drizzle definitions in `DATABASE.md`

- **Postgres 16 only** (pgvector, `LISTEN/NOTIFY`, RLS, jsonb). Drizzle `pg-core` schema; migrations generated by `drizzle-kit generate` and applied explicitly (`flowaid db migrate` / container entrypoint), fail-fast.
- **Ids** are `uuid` v7 generated in the application (`@flowaid/shared` `uuidv7()`), time-ordered so `runs`/`run_events`/`audit_events` cluster by time.
- Every tenant-owned table has `workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` first in an index; RLS policies on `workspace_id` are generated for every tenant table and enabled when `DB_RLS=true` (the API runs `SET LOCAL app.workspace_id`).
- `run_events(run_id, seq)` is the log; `runs`, `node_runs`, `human_tasks`, `run_timers` are projections maintained by `PgRunStore.appendEvents` in one transaction with the fenced `last_seq` update; `run_events.payload` carries a `pg_column_size < 262144` check; monthly range partitioning on `at` is switched on by a migration when `RUN_EVENTS_PARTITIONED=true`.
- `run_checkpoints(run_id, seq, state)` — separate table, written every 200 events / on lease release / before terminal; keeps the last two per run.
- `workflow_versions.kind ∈ {'published','draft'}`; drafts have `version = NULL`, `label = 'draft@rev<n>'`, are deduplicated by `plan_hash`, and are garbage-collected after 7 days when no run references them.
- `secret_references(workflow_id, environment_id, secret_name) → credential_id` is the binding table (spec entity name kept); `workflow_deployments` carry `variable_overrides`, `previous_version_id` for rollback and a partial unique index on the active row per `(workflow_id, environment_id)`.
- `credentials` unique on `(workspace_id, name, coalesce(environment_id, zero-uuid))` so "any environment" credentials cannot collide by NULL-distinctness.
- `queue_jobs` and `run_timers` implement the Postgres queue driver and DB-authoritative timers; `state_entries` implement `ctx.state` and every other key/value need (there is no separate `kv` table; MCP OAuth tokens are credentials, §10.2); `jobs` tracks API-initiated background jobs (`export.package`) with an artifact result; `credentials.storage` is `db | external` (external references carry a scheme prefix, §10.6).
- Retention by data class and per-workspace overrides; the `maintenance` queue's `retention.sweep` job drops partitions/rows and S3 objects nightly, nulls `runs.idempotency_key` after 24 h and garbage-collects unreferenced draft versions; `runs` rows keep metrics columns for 400 days (DATABASE.md §Retention). `WorkspaceSettings` is validated by the Zod `WorkspaceSettingsSchema` on `PATCH /v1/workspaces/:id` (retention ≥ 1 d, audit ≥ 90 d).
- RLS is real, not advisory: every tenant table has `ENABLE` + `FORCE ROW LEVEL SECURITY`, the policy reads `NULLIF(current_setting('app.workspace_id', true), '')::uuid` (unset GUC ⇒ zero rows) with a `system` bypass GUC for sweeps and reprojection, and the api/worker connect as `flowaid_app` (migrations as the owner through `DATABASE_ADMIN_URL`, `worker-code` as `flowaid_code` with grants on `queue_jobs`, `node_runs` and `run_events` only). `DB_RLS=true` is the compose default.

Entity list (spec-complete): `users, identities, refresh_tokens, user_tokens, workspaces, memberships, environments, api_keys, workflows, workflow_versions, workflow_deployments, secret_references, credentials, encryption_keys, runs, run_events, node_runs, run_checkpoints, run_timers, human_tasks, human_task_review_tokens, state_entries, artifacts, jobs, queue_jobs, event_subscriptions, agents, tools, mcp_servers, mcp_exposures, models, plugins, knowledge_sources, documents, chunks, evaluation_sets, evaluation_cases, evaluation_runs, evaluation_results, webhooks, webhook_deliveries, schedules, templates, notifications, audit_events`.

---

## 8. API (`apps/api`, Fastify 5) — decisions; every route in `API.md`

- Base path `/v1`; every route declared with `fastify-type-provider-zod` schemas and a required `config.auth` (a route without one fails to register); `@fastify/swagger` emits OpenAPI 3.1 at `/v1/openapi.json`, the contract the SDK (`openapi-typescript`) and CLI are generated from; Scalar reference at `/docs`.
- Principals: `user` (session JWT ES256, 15 min, `__Host-fa_session` cookie with claims `sub`, `sid`, `tv` only + rotated refresh-token families; the workspace is resolved per request from `X-Workspace`/the `[ws]` route segment and the role from `memberships`, cached 60 s per `sid`), `api_key` (`Authorization: Bearer fa_live_…`, sha256 lookup, scopes intersected with the creator's current role at request time, optional environment and workflow pins, per-key rate limit), `review_token` (external human review; bearer only, never a query string), `webhook` (the webhook row is the principal: `{ runs:create }` pinned to its workflow and environment), `mcp_token` (an `api_keys` service-account row with scope `mcp:serve` and `workflow_ids` pinned to the exposed workflows), `system`. Scopes, role mapping and session hardening in `API.md` §1.
- Error envelope `{ error: { code, message, retryable, run_id?, node_id?, node_run_id?, details?, request_id } }`; HTTP status from `FlowaidError.httpStatus`; request validation → 400; compile errors → 422 with `details.diagnostics`.
- `POST /v1/workflows/:id/run` validates input against `plan.inputs` (400, no run created), resolves the deployment for the environment (session default `dev`; API keys must be pinned to an environment or pass `environmentId` — 400 otherwise, never an implicit `prod`), checks secret bindings (422 `E_SECRET_UNBOUND`), inserts `runs` + `RUN_CREATED`, enqueues `run.start`. `mode: 'async'` → 202 `{ run_id, status: 'queued' }`; `mode: 'sync'` → 200 with output on completion, 202 with `status: 'waiting_for_human'` + `human_task` when suspended, 202 with `status: 'running'` when `waitTimeoutMs` elapses (the run continues), or the run's error envelope (with `run_id`) when it fails. Builder runs compile the draft into an ephemeral draft version first.
- SSE at `GET /v1/runs/:id/stream` (format §5.12 / `API.md` §3); JSON polling at `GET /v1/runs/:id/events`.
- Human tasks: `POST /v1/human-tasks/:id/respond` (CAS + enqueue, no run event writes); external review via `/v1/review/:token`.
- Cancel = flag + control job (§5.8). Replay/restart/fork/retry-node per §5.9. `POST /v1/runs/:id/add-to-evaluation` prefills expectations from the run's decisions and taken branches.
- Publish: `POST /v1/workflows/:id/publish { notes?, deployTo?, requireEvaluation?: { setId, minPassRate, baselineVersionId? } }` compiles at `level: 'publish'`, optionally runs the evaluation gate (422 with the `RegressionReport` on failure), inserts the immutable version, updates `workflows.latest_version_id`, creates deployments.
- MCP server endpoint `/mcp/:workspaceSlug` (Streamable HTTP, stateless) lists the exposed workflows the principal's `workflow_ids` pin allows as tools; webhook ingress `ANY /hooks/:workspaceSlug/:path` with raw-body HMAC, mandatory `X-Timestamp` unless `require_timestamp=false`, and delivery-id idempotency (`webhooks.idempotency_header`).
- **Trigger materialisation.** `WorkflowDefinition.triggers[]` is versioned with the definition; `webhooks`, `schedules` and `mcp_exposures` rows are its per-environment materialisation. On `PUT /v1/workflows/:id/deployments/:environmentId` (and on promote/rollback) the API upserts one row per trigger of the deployed plan for that environment, keyed `(workflow_id, environment_id, path | cron+input | tool_name)`, disables rows whose trigger disappeared (never deletes them, so delivery history survives), and returns the resulting webhook URLs / schedule ids / tool names; a webhook `path`, MCP `tool_name` or event name that collides with another workflow in the workspace is `422 E_TRIGGER_CONFLICT`. The trigger CRUD routes (`API.md` §3.9) edit environment-specific fields only (`secretCredentialId`, `callbackUrl`, `allowedHeaders`, `enabled`, `requireTimestamp`, `idempotencyHeader`, `catchUp`, `jitterMs`) and answer `409` to a `path`/`cron`/`toolName` change — those are definition edits. `POST /v1/events/:eventName { payload, correlationKey? }` starts every deployed workflow whose triggers declare that event and delivers the payload to runs waiting on `wait{event}` with a matching correlation key (`event_subscriptions` projection).
- **First boot and slugs.** The api entrypoint runs migrations, then, when no user exists, creates the owner from `FLOWAID_ADMIN_EMAIL/PASSWORD` — or, when those are unset, `owner@flowaid.local` with a generated password printed once to the api log and `status='invited'` (forces a password change) — the default workspace `{ name: 'Default', slug: 'default' }`, its `dev/staging/prod` environments and the built-in templates. Slugs are `SlugSchema` (`API.md` §7); `workflows.slug = slugify(name)` with `-2`, `-3` suffixes on collision, changeable through `PATCH /v1/workflows/:id { slug }` (409 while a webhook or MCP exposure references the old one).
- **Code export** (`CODE_EXPORT.md`): `GET /v1/workflow-versions/:versionId/export?format=json|yaml|ts`, `POST /v1/workflow-versions/:versionId/export/package` and the draft twins `GET|POST /v1/workflows/:id/draft/export[/package]`; the package job runs on the worker's `jobs` queue, lands in `artifacts` (`kind='export'`, 24 h) and is polled through `GET /v1/jobs/:id`.
- `GET /v1/me.features` is a `Record<FeatureKey, boolean>` (`API.md` §7) computed from the release constant `FEATURES_SHIPPED`, the operator's `FLOWAID_FEATURES_DISABLED` list and runtime conditions (`oidc` iff `OIDC_ISSUER` is set, `langchain` iff the bundled plugin is enabled, `code_export` iff `FLOWAID_EXPORT_MODE` resolves, `schedules` iff the scheduler job is enabled).

---

## 9. Web app (`apps/web`) — decisions; routes, layout, component tree, tokens and trace viewer in `UI.md`

- Next.js 16 App Router; server components fetch initial data through the SDK with the session cookie; client components use TanStack Query; the builder store is zustand + immer with JSON-patch undo/redo; the compiler runs in a Web Worker for on-canvas diagnostics identical to the server's.
- The canvas is a **projection** of `WorkflowDefinition` + `layout`: nodes → XYFlow nodes (`parentId` = `parent`, `extent: 'parent'`), control edges → `type: 'control'`, `plan.dataEdges` → `type: 'data'` (solid for refs, dashed for template/expr refs, non-selectable). `onConnect` from a data handle writes a `ref` binding; from a control handle adds a control edge. Handle ids are `out:<port>`, `in:<port>`, `ctl:<port>`, `ctl-in`. `reactFlowInstance.toObject()` is never persisted.
- Design tokens are the existing `brand/tokens.css` (synced into `packages/ui/src/tokens.css`): cobalt accent means decision, status is a border not a fill, Instrument Sans for prose and JetBrains Mono for machine values. Node categories are the `@flowaid/ui` `NODE_CATEGORIES` (`flow, decision, generation, agent, tool, data, retrieval, state, human, safety, developer`) — the same enum as `NodeCategorySchema`.
- Navigation lists only finished features; `GET /v1/me` returns the `features: Record<FeatureKey, boolean>` map (`API.md` §7) and every `SideNav` item is keyed by a `FeatureKey`, so panels that exist in `@flowaid/ui` for later phases (AI builder, critic, cost optimizer, knowledge, agents, schedules) are never mounted before their backend reports the feature.

---

## 10. Cross-cutting subsystems

### 10.1 Human-in-the-loop

Modes `approval | review | form | choice` on the `human` kind (control ports §2.4), typed `HumanRequest`/`HumanResponse` on the wire (`CONTRACTS.ts` §9), escalation (timer or reviewer-initiated), expiry (`fail | route | escalate`), external review links (§5.7), and mid-node approvals for task nodes through `NodeResult.suspend` (Agent tool approval: `config.tools[].approval: 'always' | 'irreversible' | 'never'`). Notification channels (`notifications` table: email/SMTP, Slack webhook, generic webhook) fire on `HUMAN_APPROVAL_REQUESTED` with a deep link and, when allowed, the external link. Evaluation runs auto-resolve human nodes (§10.4).

### 10.2 MCP (`@flowaid/mcp`)

`McpSessionPool.acquire(server, creds, signal)` pools sessions per `(serverId, credentialId)` with reconnect/backoff and health; `McpSession` exposes `listTools/callTool/listResources/readResource/listPrompts/getPrompt/ping`. Transports: Streamable HTTP (preferred), SSE (legacy), stdio (worker only, only when `MCP_STDIO_ENABLED=true`; the command must be one of the operator's absolute-path allow-list `FLOWAID_MCP_STDIO_ALLOWED_COMMANDS` (empty = none) with an optional per-command args regex, the child environment is `FLOWAID_MCP_STDIO_ENV_ALLOWLIST` ∩ request plus the bound credential's fields, the process is spawned with `shell: false` in a fresh temp cwd as a detached process group killed on timeout/cancel with a 1 MiB stderr cap, and `validateStdioConfig` — metachar rejection, dangerous-flag blocklist, ported from an Apache-2.0 upstream `core.ts`, attributed in NOTICE — runs as a second line; every spawn is audited `mcp_server.stdio_spawn`). Discovered tool descriptions are capped at 1 KiB and stripped of control characters before storage. Auth: none / static headers (credential) / OAuth 2.1 with PKCE (tokens stored as a credential, refresh handled by the pool, per-call header hook). Discovery (`POST /v1/mcp/servers/:id/discover`, worker job) sanitises names/descriptions, flags injection patterns (`W_MCP_TOOL_SUSPICIOUS`), stores tools/resources/prompts on the server row; `toolPolicy` (allow/deny/approvalRequired globs) is enforced in `ctx.tools.call`. The palette lists each allowed tool as a preset of `flowaid.tools.mcp` with `config = { serverId, tool }`; the compiler resolves its ports through `toolSignature` and `CompileOptions.resolveTool`, fed from `GET /v1/tools/catalog`. Workflows as MCP tools: `mcp_exposures` rows (materialised from `triggers[].type='mcp'`, §8); the caller's token is an `api_keys` service-account row (scope `mcp:serve`, `workflow_ids` pinned to the exposed workflows, minted by `POST /v1/mcp/exposures` and shown once); `/mcp/:workspaceSlug` runs `@modelcontextprotocol/sdk` `McpServer` + `StreamableHTTPServerTransport` (stateless), `tools/list` returns only exposures whose `workflow_id` the principal's pin allows, `tools/call` runs the workflow sync (≤ 110 s) and returns `structuredContent`, or a `flowaid://runs/<id>` resource link when suspended/long-running; `resources/list` exposes `flowaid://workflows/<id>/schema` and `flowaid://runs/<id>`. Discovered resources and prompts are consumed by `flowaid.tools.mcp_resource` (config `serverId`, `uri` template; output `contents[]`; idempotency `safe`) and `flowaid.tools.mcp_prompt` (config `serverId`, `name`; dynamic inputs = the prompt's arguments; output `messages: ChatMessage[]`), with `toolPolicy` globs applied to resource URIs as well.

### 10.3 OpenAPI tools (`@flowaid/openapi-tools`)

`parseOpenApi({ url } | { text, format })` dereferences 3.0/3.1 documents (`@readme/openapi-parser` with `resolve: { external: false, file: false }`; external `$ref`s are pre-resolved through `SafeFetch` — at most 10 documents, 3 hops, 5 MiB each — or rejected with `E_OPENAPI_EXTERNAL_REF`; YAML with the core schema only; caps 500 operations, schema depth 32, 2 MiB text; `servers[]`/`serverUrl` resolving to private ranges are rejected at import with `E_TOOL_SERVER_PRIVATE` and re-checked at execution; 3.0 `nullable` normalised). `operationsToTools(doc, { serverUrl?, include? })` yields one `ToolDefinition` per operation: `inputSchema = { path, query, headers, body }`, `outputSchema = { status, body }` from the 2xx JSON response, `idempotency` from the method (`GET/HEAD` safe; `PUT/DELETE` keyed; `POST/PATCH` none unless `x-idempotent: true`), `capability` from `x-flowaid-capability` or `<toolset>.<read|write>`, auth from `securitySchemes` → credential types `http.bearer`, `http.basic`, `http.api_key`, `oauth2.client_credentials`. `executeOperation` validates/coerces args, builds the request (path templating with `encodeURIComponent`, `URLSearchParams`, JSON/form/multipart/text bodies), applies auth, forwards `Idempotency-Key` for keyed operations, refuses args that set `Host`, `Content-Length` or `Authorization` (unless the operation declares that header) or any header value containing CR/LF, parses the response and maps ≥ 400 to `ToolExecutionError{ retryable: status ∈ {408,425,429,5xx} }`. Node `flowaid.tools.openapi` = `{ toolsetId, operationId }` with ports via `toolSignature`.

### 10.4 Evaluation (`@flowaid/evaluation`)

```ts
export const ExpectationSchema = z.object({
  output: z
    .array(
      z.object({
        path: JsonPointerSchema,
        matcher: z.discriminatedUnion("type", [
          z.object({ type: z.literal("equals"), value: JsonValueSchema }),
          z.object({ type: z.literal("contains"), value: z.string() }),
          z.object({ type: z.literal("regex"), pattern: z.string() }),
          z.object({ type: z.literal("schema"), schema: JsonSchemaSchema }),
          z.object({
            type: z.literal("range"),
            min: z.number().optional(),
            max: z.number().optional(),
          }),
          z.object({
            type: z.literal("judge"),
            instructions: z.string(),
            criteria: z.object({ true: z.string(), false: z.string() }).optional(),
          }), // boolean decision over { input, expected?, actual }
        ]),
      }),
    )
    .default([]),
  decisions: z
    .record(
      NodeIdSchema,
      z.object({
        value: JsonValueSchema.optional(),
        valueIn: z.array(JsonValueSchema).optional(),
        range: z.tuple([z.number(), z.number()]).optional(),
        minConfidence: z.number().optional(),
      }),
    )
    .default({}),
  branches: z.record(NodeIdSchema, PortNameSchema).default({}), // required fired port per branch/gate/router node
  requiredNodes: z.array(NodeIdSchema).default([]),
  forbiddenNodes: z.array(NodeIdSchema).default([]),
  requiredTools: z.array(z.string()).default([]),
  forbiddenTools: z.array(z.string()).default([]),
  status: RunStatusSchema.optional(),
  outcome: z.string().optional(),
  maxLatencyMs: z.int().optional(),
  maxCostUsd: z.number().optional(),
  human: z.record(NodeIdSchema, HumanResponseSchema).default({}), // auto-response per human node; default { action: 'approve' }
  humanExpected: z.boolean().optional(), // scored: did the run request a human at all?
});
export interface EvaluationSummary {
  cases: number;
  passed: number;
  passRate: number;
  completionRate: number;
  accuracy: Record<NodeId, number>; // decision expectations met, per node
  calibration: Record<
    NodeId,
    {
      ece: number;
      bins: { lo: number; hi: number; count: number; accuracy: number; confidence: number }[];
    }
  >;
  branchCorrectness: number;
  schemaSuccess: number;
  toolSuccess: number;
  humanReviewRate: number;
  latency: { p50: number; p95: number; p99: number };
  costUsd: { total: number; perCase: number };
}
export interface RegressionReport {
  versionId: string;
  baselineVersionId: string | null;
  summary: EvaluationSummary;
  baseline: EvaluationSummary | null;
  deltas: Partial<Record<keyof EvaluationSummary, number>>;
  flips: { caseId: string; field: string; before: JsonValue; after: JsonValue }[];
  verdict: "pass" | "fail";
  gate: { minPassRate: number } | null;
}
```

Runner (worker job `evaluation.run`): one run per case (`origin: 'evaluation'`, labels `{ evaluationRunId, caseId }`, bounded concurrency), human nodes auto-resolved from `expectations.human` (default approve) and `humanRequested` recorded, scores from `runs` + `node_runs`, `evaluation_results` rows, summary, `compare()` against the baseline. Publish gate: `requireEvaluation { setId, minPassRate, baselineVersionId? }` runs the set against the compiled draft (as a draft version) and fails publish with 422 + report when `verdict = 'fail'`; the regression report is also shown in the publish dialog whenever the latest version has a run on a linked set (`W_REGRESSION` when pass rate drops > 2 pt, p95 +30 %, cost +20 %).

### 10.5 Observability (`@flowaid/observability`)

pino JSON logs bound to `requestId/runId/nodeRunId/workspaceId`, scrubbed by the `Redactor`. OpenTelemetry: a span per HTTP request, run step, node run (`flowaid.node_run` with `node.id/type`, `scope`, `attempt`, `provider`, `model`, `decision.confidence`), provider and tool call; OTLP exporter when configured. Prometheus on the internal listener: `flowaid_runs_total{workflow,env,status,origin}`, `flowaid_run_duration_ms`, `flowaid_queue_latency_ms`, `flowaid_node_runs_total{type,status}`, `flowaid_node_duration_ms{type}`, `flowaid_ai_cost_usd_total{provider,model}`, `flowaid_tokens_total{provider,model,direction}`, `flowaid_decision_confidence{kind,provider}` (histogram), `flowaid_provider_failover_total{from,to}`, `flowaid_provider_errors_total{provider,code}`, `flowaid_tool_calls_total{tool,status}`, `flowaid_tool_duration_ms`, `flowaid_human_tasks_total{mode,action}`, `flowaid_retries_total{type,code}`, `flowaid_queue_depth{queue}`, `flowaid_lease_takeovers_total`, `flowaid_worker_active_runs{pool}`. Dashboard endpoints (`GET /v1/metrics/overview|timeseries`) aggregate `runs`/`node_runs` in SQL (`percentile_cont`); no separate metrics store.

**TraceReviewer** (worker job `trace_review.run`, enabled per workspace: all failures + a sample of completions): deterministic short-circuits first (`RUN_FAILED{BOUNDS_EXCEEDED}` → `FILE_BUG`; `NONIDEMPOTENT_INTERRUPTED` → `PRIORITY_REVIEW`; cancelled → `NO_ACTION`), otherwise a compact trace summary (statuses, errors, retries, low-confidence decisions, latency/cost vs the workflow's p95, human overrides) is judged with one `choice` question over `NO_ACTION | REVIEW | PRIORITY_REVIEW | FILE_BUG | PAGE_ON_CALL` plus a boolean "likely wrong outcome" through the workspace decision chain (works with the LLM adapter when no TypeSafe key exists). The verdict is stored in `runs.review` (not as a run event — nothing follows a terminal event) and `audit_events`; `PAGE_ON_CALL`/`FILE_BUG` fire the workspace alert channels.

### 10.6 Security

- **Credential encryption** (`@flowaid/credentials`): envelope — per-credential random 32-byte DEK, AES-256-GCM (12-byte IV, 16-byte tag, AAD = `credential.id|type|keyVersion`), DEK wrapped by the active KEK (`encryption_keys`), KEK wrapped by the master (`MasterKeyProvider`: `env` `FLOWAID_MASTER_KEY`, `file` (0600, created with `O_CREAT|O_EXCL` under `pg_advisory_xact_lock('flowaid.master_key')` so replicas cannot each generate one; in production only when `FLOWAID_MASTER_KEY_AUTOGENERATE=true`, with a loud warning), `aws-kms`, `vault-transit`; `azure-keyvault` and `gcp-kms` implement the same interface in a later phase). `encryption_keys.master_kcv` (first 8 bytes of `HMAC-SHA256(master, 'flowaid/master-kcv/v1')`) is verified at boot so a wrong master key fails with `E_MASTER_KEY_MISMATCH` instead of at the first decrypt; `rotate` re-wraps DEKs only, `flowaid keys rotate-master --new-key-file` re-wraps every KEK in one transaction (audited as `system`). **Storage** is `credentials.storage = 'db' | 'external'`; external references carry a scheme prefix — `env:NAME` (resolved only for `^FLOWAID_SECRET_[A-Z0-9_]+$`, never a `packages/env` schema variable; creating one requires `admin` and is audited `credential.create{ storage, ref }`; the ref format is validated at write time), `vault:path#key`, `aws-sm:arn`, `azure-kv:<vault>/<secret>[/<version>]`, `gcp-sm:projects/*/secrets/*/versions/*` — resolved at use time with a 5-minute cache. Decryption happens only in the worker's `CredentialAccess`; values are cached per run in memory and zeroised after. The `code` pool never holds a master key: `node.exec` jobs for code nodes carry the already-resolved values of the node's declared slots, and the worker refuses to start with `WORKER_POOLS` containing `code` while `FLOWAID_MASTER_KEY*` is set (`E_CODE_POOL_HAS_MASTER_KEY`).
- **Redaction at write time**: the compiler emits `PlanNode.redact` from `x-dataClass` (`pii` masked, `sensitive` hashed, `doNotPersist` dropped) and `privacy.redactFields`; the worker's per-run `Redactor` also learns every decrypted secret value (plus base64/url-encoded variants) and masks them; both run inside `appendEvents` before insert, on `run_events.payload`, `node_runs.input/output`, `human_tasks.request`, error messages and logs. No code path can read unredacted PII from history; exports contain secret _names_ only. **Privacy flags** (`PrivacyPolicySchema`): `containsPII: true` treats the node's whole input and output as `x-dataClass: 'pii'` (masked at write, 7-day I/O retention); `sensitive: true` hashes the node's input/output at write and excludes them from code exports, `add-to-evaluation`, external review context and `NodeRunDetail` for non-admins; `doNotPersist` and `redactFields` as above. Run-level `runs.privacy` is the OR over executed nodes and the input schema's data classes, `runs.data_class` the maximum class seen; `GET /v1/runs?privacy=pii|sensitive` filters on them and the UI shows a privacy chip. The `Redactor` also learns every secret-valued environment variable (`secretEnvValues(env)` from `@flowaid/env`) and the api's pino logger redacts `authorization`, `cookie`, `x-webhook-token`, `x-signature` and `set-cookie` headers; `audit_events.details` passes through `Redactor.redact()` before insert.
- **RBAC**: roles → scope sets (`API.md` §1); resource checks in services (`assertCan(principal, 'runs:approve', humanTask)` also checks assignees); credential `scopes[]` are tool capabilities intersected with `ToolDefinition.capability` at compile (`E_CAPABILITY_MISSING` when bindings are known) and at run (`ForbiddenError`); API keys may be pinned to an environment and to workflow ids.
- **Egress**: `SafeFetch` (SSRF guard ported from an Apache-2.0 upstream `httpSecurity.ts`, attributed in NOTICE): DNS resolution with private/link-local/metadata deny-list, pinned address across redirects, method downgrade on 301/302/303, max 5 redirects, 25 MiB response cap, per-workspace allow/deny lists; used by the HTTP node, OpenAPI tools, MCP HTTP transports, webhook callbacks and the sandbox bridge.
- Webhooks: raw-body HMAC (`X-Signature: sha256=…`, timing-safe compare in HMAC _and_ token mode, ±5 min `X-Timestamp` replay window with a nonce cache, mandatory unless `require_timestamp=false`), `none` mode only with a server-generated 128-bit path and a 60/min per-webhook limit, delivery-id idempotency (`idempotency_header`, fallback sha256 of the raw body for 24 h); outbound callbacks signed `X-Flowaid-Signature` with 5 retries. API: helmet headers, CORS allow-list (never literal `*` with credentials; in development `*` reflects the request origin), `@fastify/rate-limit` keyed by `sid` / api-key id / review-token id / client IP with `FLOWAID_TRUST_PROXY` wired to Fastify `trustProxy`, concurrent SSE streams capped per principal and workspace, 2 MiB JSON bodies (uploads via presigned URLs with pinned `Content-Type`/`Content-Length` and a `complete` step; downloads `Content-Disposition: attachment` + `nosniff`), audit events on every mutation, passwords argon2id, refresh-token families with reuse detection, `users.token_version` revocation, JWT ES256. `@flowaid/env` refuses production configurations that are unsafe (`CORS_ORIGINS=*`, `http:` public URLs without `FLOWAID_ALLOW_INSECURE_HTTP`, the example admin password, generated JWT keys without `FLOWAID_JWT_KEYS_DIR`, silent master-key generation).

### 10.7 Sandboxed code execution (`@flowaid/sandbox`)

`flowaid.tools.code` (`pool: 'code'`, `capabilities: ['sandbox']`, `portRules: [inputSchemaFromConfig('/inputs'), outputSchemaFromConfig('/output')]`) and `flowaid.tools.shell` are delegated to the `code` pool. `IsolatedVmSandbox`: one `isolated-vm` isolate per execution (`new ivm.Isolate({ memoryLimit: 128, inspector: false })`, CPU timeout = node timeout **and** a wall-clock deadline `min(node timeout, 120 s)` enforced with `AbortSignal.timeout` around the whole run plus `isolate.dispose()`, no `require`, no Node globals), code transpiled by `esbuild` once per hash (LRU 200), host bridges `fetch` (through `SafeFetch`, only with `allowNetwork` + allow-listed hosts), `log` (captured into `LOG` events, 1 000 lines / 8 KiB per line cap), `tools.call` (only `config.tools[]` names whose `approval` is `never`; anything else is `SandboxToolNeedsApproval` — no suspension from inside an isolate), `state.get/set` (keys prefixed by the runtime with `run:<id>`); every value crossing the bridge is capped at 4 MiB; result validated against the declared output schema (`SCHEMA_VALIDATION_ERROR`). `isolated-vm` is in maintenance mode: it is the single-tenant/dev default, `SANDBOX_MODE=container` is the recommendation for multi-tenant production, and the `worker-code` container runs with `cap_drop: [ALL]`, `pids_limit`, a memory limit, no `.env`, no `/data` mount and no master key (§10.6). `ContainerSandbox` (`SANDBOX_MODE=container`, gVisor/`docker run --network none --read-only --memory --pids-limit`) implements the same `SandboxExecutor` interface and is the only host for `shell`. The API image has no sandbox dependency.

### 10.8 Knowledge / RAG (not in the first slice)

Ingestion as worker jobs (`ingest.source`): loaders (files via artifacts, URL/sitemap, GitHub) → normalise (pdf/docx/html→md) → chunker (recursive by tokens with overlap) → metadata → `EmbeddingProvider` → `VectorIndexAdapter { upsert, query, delete, stats }` with pgvector first (`chunks` table, HNSW cosine + `tsvector` for hybrid via reciprocal rank fusion), then Qdrant/Pinecone/Weaviate/Milvus/Chroma/Elasticsearch/OpenSearch. Nodes: `flowaid.retrieval.loader|chunker|embed|upsert|retriever|hybrid_search|rerank|knowledge_base`.

### 10.9 FlowAId importer (`@flowaid/importer`)

`importExternalFlow(flowData)` → `{ definition, issues }`. The source format's `IReactFlowObject` schemas are copied as data (Apache-2.0, NOTICE). Pipeline: sanitise credential ids/password inputs/auth headers → graph helpers (`constructGraphs`, attributed) → node mapping (`startAgentflow→input`, `llmAgentflow→flowaid.ai.generate`, `conditionAgentflow→branch`, `conditionAgentAgentflow→flowaid.decision.choice + flowaid.decision.router` with `W_IMPORT_PROVIDER_CHANGED`, `humanInputAgentflow→human`, `loopAgentflow`+target→`loop`, `iterationAgentflow→foreach`, `httpAgentflow→flowaid.tools.http`, `toolAgentflow→flowaid.tools.mcp|openapi|http`, `customFunctionAgentflow→flowaid.tools.code` (flagged), `executeFlowAgentflow→subflow`) → template grammar translation (`{{ question }}`, `{{ nodeId.output.path }}`, `$flow.state.x`, `$vars.x`, `$form.x`, `$webhook.body.x`, `$iteration.x`; TipTap HTML unwrapped) into bindings → unsupported nodes become `flowaid.dev.todo` placeholders that fail compile with `E_IMPORT_UNSUPPORTED` so nothing silently degrades. Never extends core types.

---

### 10.10 Code export — "Download code" (authoritative detail in `CODE_EXPORT.md`)

Every workflow version (or the current draft) can be downloaded as a complete, runnable code package: canonical `workflow.json` + compiled plan, the same workflow as typed `src/workflow.ts` built with the SDK builders (round-trip guaranteed by `definitionHash`), a local runner over the embedded runtime (`runLocally()` in `@flowaid/workflow-runtime`, identical code path to the worker), an optional HTTP wrapper with the platform's SSE wire format, `.env.example` for the declared secrets, tests with recorded decisions, a Dockerfile, and (in vendored mode) tarballs of the `@flowaid/*` packages it needs so it installs offline. Owned by `packages/codegen`; exposed through `POST /v1/workflow-versions/:versionId/export/package` (draft: `POST /v1/workflows/:id/draft/export/package`), `GET /v1/jobs/:id`, `GET /v1/artifacts/:id/download`, `flowaid workflow package`, and the **Download code** action in the builder and versions page. `runLocally()` takes the node packages, provider registry and optional sandbox from the caller (`CODE_EXPORT.md` §2), so the runtime package keeps its dependency edges.

### 10.11 LangChain integration (authoritative detail in `LANGCHAIN.md`)

LangChain is integrated as a compartmentalized driver layer: `@flowaid/langchain` adapts LangChain chat models, embeddings, tools and callbacks to the flowaid `GenerationProvider`/`EmbeddingProvider`/`DecisionProvider`/`ToolDefinition` interfaces (both directions, including exposing a flowaid workflow as a LangChain tool), and `@flowaid/nodes-langchain` is a plugin-style node package (chat, LCEL runnable, LangGraph agent bounded by flowaid budgets with approval suspension, document loaders, text splitters, embeddings, vector stores for every database in the spec, retrievers, output parsers). A `FlowaidCallbackHandler` maps LangChain callbacks to run events so LangChain work is visible in traces, cost and bounds. The core never imports LangChain.

### 10.12 Jev engineering — decision contracts, packets, routing, calibration, receipts (authoritative detail in `JEV_ENGINEERING.md`)

TypeSafe's Jev is flowaid's decision layer, and `JEV_ENGINEERING.md` makes the practices of _Jev Engineering for Production Agents_ part of the platform: _"Jev judges; code checks policy; the tool executes; the trace records."_ A production semantic decision is a versioned **decision contract** (`support.router@4`: state spec, instructions, outcomes with escape hatches, fallback, thresholds per consequence class with governance, allowed actions, escalation, model, owner) kept in a registry separate from workflow versions and deployed per environment with shadow, canary and one-step rollback. Contract-bound nodes (`flowaid.jev.decide | bundle | route | menu | packet | tool_gate | verify | relevance | shadow`) send a compact, least-privilege **state packet** (≤ 30 000 estimated tokens, under TypeSafe's 32k state limit), batch independent questions against one `stateVersion`, route confidence × consequence into **auto / improve / human** (irreversible actions always human), build live option menus (≤ 255 options with escapes), and write an immutable **decision receipt** per question (contract version and hash, state reference, full distribution, thresholds, consequence class, route, policy verdict, executed action, overrides). Calibration is tracked per contract version and segment (ECE, Brier, drift alarms, threshold recommendations); the failure-mode catalog becomes compiler diagnostics, TraceReviewer signals and advisor rules. The logic lives in the browser-safe package `@flowaid/jev` (`jev → workflow-core, shared`); contract changes are RFC-0013…0016 in `RFCS.md`; delivery is track J of `docs/UPGRADE_PLAN.md` (§6). Legacy `flowaid.decision.*` nodes keep their semantics and wire behaviour and gain receipts through implicit contracts.

## 11. Demo workflows (WorkflowDefinition outlines)

All three ship as templates in `packages/nodes-core/templates/*.json`, are compiled in CI against the core catalog (zero errors), and are the fixtures of the golden-trace tests. Outlines omit `$schema`, `layout`, `description`, uuids and repetitive `credentials` entries; every node id, port and edge shown is real. Refs are written in the compact form (`"ref": "intent.decision.value"` ≙ `{ kind:'port', node:'intent', port:'decision', path:'/value' }`), which the importer normalises. **Template resources**: a template never carries workspace ids. `templates.required_resources` declares `{ mcpServers: [{ key, description, requiredTools }], knowledgeSources: [{ key, description }] }`, definitions reference them with sentinels (`"serverId": "$template.mcp.github"`), `POST /v1/templates/:id/instantiate { name?, resources: Record<key, uuid> }` rewrites the sentinels (the "new from template" dialog collects them), an unrewritten sentinel compiles to `E_TOOL_UNRESOLVED` with a picker quick-fix, and CI compiles every template with a stub `resolveTool` built from `required_resources`. The first-slice demos use only first-slice nodes: demo 2's duplicate search is the GitHub MCP `search_issues` tool; a retrieval variant of that template ships with the knowledge slice.

### 11.1 Intelligent Support Triage

```jsonc
{
  "name": "Intelligent Support Triage",
  "inputs": {
    "type": "object",
    "required": ["message", "customer_id"],
    "properties": {
      "message": { "type": "string", "x-dataClass": "pii" },
      "customer_id": { "type": "string" },
      "channel": { "type": "string", "enum": ["email", "chat", "api"] },
    },
  },
  "outputs": {
    "type": "object",
    "required": ["team", "urgency", "reply", "disposition"],
    "properties": {
      "team": { "type": "string" },
      "urgency": { "type": "number" },
      "reply": { "type": "string" },
      "disposition": { "type": "string", "enum": ["auto", "human_approved", "escalated"] },
    },
  },
  "secrets": [
    { "name": "TYPESAFE_API_KEY", "credentialType": "typesafe.api_key" },
    { "name": "OPENAI_API_KEY", "credentialType": "openai.api_key" },
    { "name": "BILLING_API", "credentialType": "http.bearer" },
    { "name": "STATUS_API", "credentialType": "http.bearer", "required": false },
  ],
  "variables": [
    { "name": "billingBase", "schema": { "type": "string" }, "source": "environment" },
    { "name": "autoThreshold", "schema": { "type": "number" }, "default": 0.9 },
  ],
  "execution": {
    "timeoutMs": 180000,
    "maxCostUsd": 0.25,
    "decisions": {
      "primary": { "provider": "typesafe", "model": "jev-latest" },
      "failover": [
        { "provider": "llm", "model": { "provider": "openai", "model": "gpt-4.1-mini" } },
      ],
    },
  },
  "nodes": [
    { "id": "start", "kind": "input", "name": "Ticket" },
    // ONE TypeSafe request answering three questions (explicit batch node)
    {
      "id": "judgments",
      "kind": "task",
      "type": "flowaid.decision.batch",
      "typeVersion": "1.0.0",
      "name": "Triage judgments",
      "config": {
        "questions": {
          "intent": {
            "kind": "choice",
            "instructions": "Which team should handle this?",
            "options": {
              "billing": "Invoices, charges, refunds, subscriptions",
              "technical": "Bugs, errors, outages, integrations",
              "security": "Fraud, stolen cards, account takeover, data exposure",
              "general": "Anything else",
            },
          },
          "urgency": {
            "kind": "score",
            "instructions": "How urgent is this request?",
            "levels": ["Not urgent", "Low", "Moderate", "High", "Critical"],
          },
          "escalate": {
            "kind": "boolean",
            "instructions": "Should a human handle this from the start (legal threat, churn risk, abuse)?",
            "criteria": { "true": "Human must handle", "false": "Automation may proceed" },
          },
        },
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "message": { "kind": "ref", "ref": "start.message" },
            "channel": { "kind": "ref", "ref": "start.channel", "default": "api" },
          },
        },
      },
      "credentials": { "typesafe": "TYPESAFE_API_KEY", "llm": "OPENAI_API_KEY" },
    },
    {
      "id": "esc_gate",
      "kind": "branch",
      "name": "Escalate now?",
      "cases": [
        {
          "port": "escalate",
          "when": "judgments.answers.escalate.value || judgments.answers.urgency.value >= 3.5",
        },
      ],
      "defaultPort": "continue",
    },
    {
      "id": "route",
      "kind": "branch",
      "name": "Route by team",
      "cases": [
        { "port": "billing", "when": "judgments.answers.intent.value == 'billing'" },
        { "port": "technical", "when": "judgments.answers.intent.value == 'technical'" },
        { "port": "security", "when": "judgments.answers.intent.value == 'security'" },
      ],
      "defaultPort": "general",
    },
    {
      "id": "billing_lookup",
      "kind": "task",
      "type": "flowaid.tools.http",
      "typeVersion": "1.0.0",
      "name": "Billing lookup",
      "config": {
        "method": "GET",
        "url": "{{ $vars.billingBase }}/customers/{{ start.customer_id }}/invoices?limit=3",
        "responseType": "json",
      },
      "credentials": { "auth": "BILLING_API" },
      "policy": { "retry": { "maxAttempts": 3 }, "onError": "ignore" },
    },
    {
      "id": "status_lookup",
      "kind": "task",
      "type": "flowaid.tools.http",
      "typeVersion": "1.0.0",
      "name": "Status page",
      "config": {
        "method": "GET",
        "url": "https://status.example.com/api/v2/incidents/unresolved.json",
        "responseType": "json",
      },
      "credentials": { "auth": "STATUS_API" },
      "policy": { "onError": "ignore" },
    },
    {
      "id": "security_kb",
      "kind": "task",
      "type": "flowaid.tools.mcp",
      "typeVersion": "1.0.0",
      "name": "Security playbook",
      "config": { "serverId": "$template.mcp.security_kb", "tool": "search_playbooks" },
      "inputs": { "query": { "kind": "ref", "ref": "start.message" } },
    },
    // join: four control edges, all downstream of `route` on different ports ⇒ one exclusive group ⇒ fires once
    {
      "id": "context",
      "kind": "join",
      "name": "Context",
      "mode": { "type": "all" },
      "inputs": {
        "billing": { "kind": "ref", "ref": "billing_lookup.body" },
        "status": { "kind": "ref", "ref": "status_lookup.body" },
        "security": { "kind": "ref", "ref": "security_kb.result" },
      },
    },
    {
      "id": "draft",
      "kind": "task",
      "type": "flowaid.ai.generate",
      "typeVersion": "1.0.0",
      "name": "Draft response",
      "config": {
        "model": { "provider": "openai", "model": "gpt-4.1-mini" },
        "temperature": 0.2,
        "maxOutputTokens": 500,
        "stream": true,
        "system": "You write concise, accurate support replies. Never promise refunds or timelines.",
      },
      "inputs": {
        "prompt": {
          "kind": "template",
          "source": "Team: {{ judgments.answers.intent.value }} (p={{ round(judgments.answers.intent.confidence, 2) }})\nUrgency: {{ judgments.answers.urgency.levelLabel }}\nContext: {{ context.values | json }}\n\nCustomer message:\n{{ start.message }}",
        },
      },
      "credentials": { "llm": "OPENAI_API_KEY" },
    },
    {
      "id": "safety",
      "kind": "task",
      "type": "flowaid.decision.batch",
      "typeVersion": "1.0.0",
      "name": "Safety checks",
      "config": {
        "questions": {
          "safe": {
            "kind": "boolean",
            "instructions": "Is the reply safe to send (no promises, no policy violations, no PII leakage)?",
            "criteria": { "true": "Safe", "false": "Unsafe" },
          },
          "on_topic": {
            "kind": "boolean",
            "instructions": "Does the reply address the customer's actual issue?",
          },
        },
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "message": { "kind": "ref", "ref": "start.message" },
            "reply": { "kind": "ref", "ref": "draft.text" },
          },
        },
      },
      "credentials": { "typesafe": "TYPESAFE_API_KEY", "llm": "OPENAI_API_KEY" },
    },
    {
      "id": "gate",
      "kind": "task",
      "type": "flowaid.decision.confidence_gate",
      "typeVersion": "1.0.0",
      "name": "Confidence gate",
      "config": {
        "threshold": { "kind": "ref", "ref": { "kind": "var", "name": "autoThreshold" } },
        "requireValue": true,
      },
      "inputs": { "decision": { "kind": "ref", "ref": "safety.answers.safe" } },
    },
    {
      "id": "approve",
      "kind": "human",
      "name": "Agent approval",
      "mode": {
        "type": "review",
        "value": { "kind": "ref", "ref": "draft.text" },
        "schema": { "type": "string" },
      },
      "title": {
        "kind": "template",
        "source": "Review reply for a {{ judgments.answers.intent.value }} ticket (safety p={{ round(safety.answers.safe.pYes, 2) }})",
      },
      "context": {
        "message": { "kind": "ref", "ref": "start.message" },
        "safety": { "kind": "ref", "ref": "safety.answers" },
      },
      "expiresInMs": 7200000,
      "onExpire": "route",
      "escalation": { "afterMs": 1800000, "to": ["role:admin"] },
      "externalReview": true,
    },
    {
      "id": "out_auto",
      "kind": "output",
      "name": "Auto respond",
      "outcome": "auto",
      "value": {
        "kind": "object",
        "fields": {
          "team": { "kind": "ref", "ref": "judgments.answers.intent.value" },
          "urgency": { "kind": "ref", "ref": "judgments.answers.urgency.value" },
          "reply": { "kind": "ref", "ref": "draft.text" },
          "disposition": { "kind": "literal", "value": "auto" },
        },
      },
    },
    {
      "id": "out_human",
      "kind": "output",
      "name": "Human approved",
      "outcome": "human_approved",
      "value": {
        "kind": "object",
        "fields": {
          "team": { "kind": "ref", "ref": "judgments.answers.intent.value" },
          "urgency": { "kind": "ref", "ref": "judgments.answers.urgency.value" },
          "reply": { "kind": "ref", "ref": "approve.value" },
          "disposition": { "kind": "literal", "value": "human_approved" },
        },
      },
    },
    {
      "id": "out_esc",
      "kind": "output",
      "name": "Escalated",
      "outcome": "escalated",
      "value": {
        "kind": "object",
        "fields": {
          "team": { "kind": "ref", "ref": "judgments.answers.intent.value" },
          "urgency": { "kind": "ref", "ref": "judgments.answers.urgency.value" },
          "reply": { "kind": "literal", "value": "" },
          "disposition": { "kind": "literal", "value": "escalated" },
        },
      },
    },
  ],
  "edges": [
    { "id": "c1", "from": { "node": "esc_gate", "port": "escalate" }, "to": { "node": "out_esc" } },
    { "id": "c2", "from": { "node": "esc_gate", "port": "continue" }, "to": { "node": "route" } },
    {
      "id": "c3",
      "from": { "node": "route", "port": "billing" },
      "to": { "node": "billing_lookup" },
    },
    {
      "id": "c4",
      "from": { "node": "route", "port": "technical" },
      "to": { "node": "status_lookup" },
    },
    {
      "id": "c5",
      "from": { "node": "route", "port": "security" },
      "to": { "node": "security_kb" },
    },
    {
      "id": "c6",
      "from": { "node": "billing_lookup", "port": "done" },
      "to": { "node": "context" },
    },
    {
      "id": "c7",
      "from": { "node": "status_lookup", "port": "done" },
      "to": { "node": "context" },
    },
    { "id": "c8", "from": { "node": "security_kb", "port": "done" }, "to": { "node": "context" } },
    { "id": "c9", "from": { "node": "route", "port": "general" }, "to": { "node": "context" } },
    { "id": "c10", "from": { "node": "gate", "port": "pass" }, "to": { "node": "out_auto" } },
    { "id": "c11", "from": { "node": "gate", "port": "review" }, "to": { "node": "approve" } },
    { "id": "c12", "from": { "node": "gate", "port": "fail" }, "to": { "node": "approve" } },
    {
      "id": "c13",
      "from": { "node": "approve", "port": "approved" },
      "to": { "node": "out_human" },
    },
    { "id": "c14", "from": { "node": "approve", "port": "rejected" }, "to": { "node": "out_esc" } },
    { "id": "c15", "from": { "node": "approve", "port": "expired" }, "to": { "node": "out_esc" } },
  ],
}
```

Trace highlights: `judgments` is one `DECISION_REQUESTED{questionCount: 3}` and three `DECISION_COMPLETED` sharing a `requestId`; `esc_gate.escalate` prunes `route` and everything downstream (`NODE_SKIPPED{pruned}` ×9) and `out_esc` fires from its single exclusive group; `context` receives one `JOIN_ARRIVED{fired}` and three `{pruned}`; `draft` streams `GENERATION_DELTA`; `gate.review` suspends the run at `approve` (`waiting_for_human`, inbox + external link); the three output nodes are pairwise exclusive so no `W_OUTPUT_AMBIGUOUS`.

### 11.2 GitHub Issue Triage

```jsonc
{
  "name": "GitHub Issue Triage",
  "triggers": [
    {
      "type": "webhook",
      "path": "github-issues",
      "signature": "hmac_sha256",
      "responseMode": "async",
      "inputPointer": "/body",
      "allowedHeaders": ["x-github-event", "x-github-delivery"],
    },
  ],
  "inputs": {
    "type": "object",
    "required": ["action", "issue", "repository"],
    "properties": {
      "action": { "type": "string" },
      "issue": {
        "type": "object",
        "required": ["number", "title", "html_url"],
        "properties": {
          "number": { "type": "integer" },
          "title": { "type": "string" },
          "body": { "type": ["string", "null"] },
          "html_url": { "type": "string" },
        },
      },
      "repository": {
        "type": "object",
        "required": ["full_name"],
        "properties": { "full_name": { "type": "string" } },
      },
    },
  },
  "outputs": {
    "type": "object",
    "required": ["handled"],
    "properties": {
      "handled": { "type": "boolean" },
      "labels": { "type": "array", "items": { "type": "string" } },
      "duplicate_of": { "type": ["integer", "null"] },
      "route": { "type": "string" },
    },
  },
  "secrets": [
    { "name": "TYPESAFE_API_KEY", "credentialType": "typesafe.api_key" },
    { "name": "GITHUB_MCP", "credentialType": "mcp.headers" },
  ],
  "execution": { "timeoutMs": 120000, "maxCostUsd": 0.2 },
  "nodes": [
    { "id": "start", "kind": "input", "name": "Webhook" },
    {
      "id": "opened",
      "kind": "branch",
      "name": "Opened?",
      "cases": [
        { "port": "yes", "when": "start.action == 'opened' || start.action == 'reopened'" },
      ],
      "defaultPort": "no",
    },
    {
      "id": "actionable",
      "kind": "task",
      "type": "flowaid.decision.boolean",
      "typeVersion": "1.0.0",
      "name": "Actionable?",
      "config": {
        "instructions": "Is this issue actionable by maintainers (a real bug, feature, docs or usage question rather than spam/empty)?",
        "criteria": { "true": "Actionable", "false": "Spam, empty or off-topic" },
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "title": { "kind": "ref", "ref": "start.issue", "default": {} },
            "body": { "kind": "expr", "source": "coalesce(start.issue.body, '')" },
          },
        },
      },
    },
    {
      "id": "act_gate",
      "kind": "branch",
      "name": "Actionable gate",
      "cases": [
        {
          "port": "yes",
          "when": "actionable.decision.value && actionable.decision.confidence >= 0.7",
        },
      ],
      "defaultPort": "no",
    },
    // classify and similar run in parallel: both activated by act_gate.yes
    {
      "id": "classify",
      "kind": "task",
      "type": "flowaid.decision.batch",
      "typeVersion": "1.0.0",
      "name": "Classify",
      "config": {
        "questions": {
          "kind": {
            "kind": "choice",
            "instructions": "What kind of issue is this?",
            "options": {
              "bug": "Something is broken",
              "feature": "New capability requested",
              "docs": "Documentation problem",
              "question": "Usage question",
            },
          },
          "severity": {
            "kind": "score",
            "instructions": "How severe (bugs) or impactful (otherwise) is this?",
            "levels": ["Trivial", "Minor", "Moderate", "Major", "Critical"],
          },
        },
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "title": { "kind": "ref", "ref": "start.issue.title" },
            "body": { "kind": "expr", "source": "coalesce(start.issue.body, '')" },
          },
        },
      },
    },
    {
      "id": "similar",
      "kind": "task",
      "type": "flowaid.tools.mcp",
      "typeVersion": "1.0.0",
      "name": "Similar issues",
      "config": { "serverId": "$template.mcp.github", "tool": "search_issues" },
      "inputs": {
        "q": {
          "kind": "template",
          "source": "repo:{{ start.repository.full_name }} is:issue {{ start.issue.title }}",
        },
        "per_page": { "kind": "literal", "value": 5 },
      },
      "credentials": { "mcp": "GITHUB_MCP" },
    },
    {
      "id": "dup_judge",
      "kind": "task",
      "type": "flowaid.decision.boolean",
      "typeVersion": "1.0.0",
      "name": "Duplicate of top candidate?",
      "config": {
        "instructions": "Is the new issue a duplicate of the top candidate (same root cause or same request)?",
        "criteria": { "true": "Duplicate", "false": "Different problem despite similar words" },
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "issue": { "kind": "ref", "ref": "start.issue" },
            "candidate": { "kind": "expr", "source": "first(similar.result.items)" },
          },
        },
      },
    },
    {
      "id": "is_dup",
      "kind": "branch",
      "name": "Duplicate?",
      "cases": [
        {
          "port": "dup",
          "when": "len(similar.result.items) > 0 && dup_judge.decision.value && dup_judge.decision.confidence >= 0.8",
        },
      ],
      "defaultPort": "new",
    },
    {
      "id": "gh_dup_comment",
      "kind": "task",
      "type": "flowaid.tools.mcp",
      "typeVersion": "1.0.0",
      "name": "Comment duplicate",
      "config": { "serverId": "$template.mcp.github", "tool": "add_issue_comment" },
      "inputs": {
        "owner": { "kind": "expr", "source": "split(start.repository.full_name, '/')[0]" },
        "repo": { "kind": "expr", "source": "split(start.repository.full_name, '/')[1]" },
        "issue_number": { "kind": "ref", "ref": "start.issue.number" },
        "body": {
          "kind": "template",
          "source": "Possible duplicate of #{{ first(similar.result.items).number }} (confidence {{ round(dup_judge.decision.confidence, 2) }}).",
        },
      },
      "credentials": { "mcp": "GITHUB_MCP" },
    },
    // labels: data dep on classify (AND) + control edge from is_dup.new ⇒ runs only on the "new" path, after classify
    {
      "id": "labels",
      "kind": "task",
      "type": "flowaid.data.transform",
      "typeVersion": "1.0.0",
      "name": "Compute labels",
      "config": {
        "output": { "type": "array", "items": { "type": "string" } },
        "expr": "[classify.answers.kind.value, 'severity:' + lower(classify.answers.severity.levelLabel)]",
      },
    },
    {
      "id": "gh_label",
      "kind": "task",
      "type": "flowaid.tools.mcp",
      "typeVersion": "1.0.0",
      "name": "Apply labels",
      "config": { "serverId": "$template.mcp.github", "tool": "add_issue_labels" },
      "inputs": {
        "owner": { "kind": "expr", "source": "split(start.repository.full_name, '/')[0]" },
        "repo": { "kind": "expr", "source": "split(start.repository.full_name, '/')[1]" },
        "issue_number": { "kind": "ref", "ref": "start.issue.number" },
        "labels": { "kind": "ref", "ref": "labels.result" },
      },
      "credentials": { "mcp": "GITHUB_MCP" },
      "policy": { "retry": { "maxAttempts": 3 } },
    },
    {
      "id": "route",
      "kind": "branch",
      "name": "Route",
      "cases": [
        {
          "port": "oncall",
          "when": "classify.answers.kind.value == 'bug' && classify.answers.severity.value >= 3",
        },
        { "port": "product", "when": "classify.answers.kind.value == 'feature'" },
      ],
      "defaultPort": "backlog",
    },
    {
      "id": "page",
      "kind": "task",
      "type": "flowaid.tools.http",
      "typeVersion": "1.0.0",
      "name": "Notify on-call",
      "config": {
        "method": "POST",
        "url": "https://hooks.slack.com/services/T000/B000/XXXX",
        "responseType": "json",
      },
      "inputs": {
        "body": {
          "kind": "object",
          "fields": {
            "text": {
              "kind": "template",
              "source": ":rotating_light: Critical bug {{ start.issue.html_url }} (sev {{ round(classify.answers.severity.value, 1) }})",
            },
          },
        },
      },
    },
    {
      "id": "out_ignored",
      "kind": "output",
      "name": "Ignored",
      "outcome": "ignored",
      "value": {
        "kind": "object",
        "fields": {
          "handled": { "kind": "literal", "value": false },
          "route": { "kind": "literal", "value": "ignored" },
        },
      },
    },
    {
      "id": "out_dup",
      "kind": "output",
      "name": "Duplicate",
      "outcome": "duplicate",
      "value": {
        "kind": "object",
        "fields": {
          "handled": { "kind": "literal", "value": true },
          "duplicate_of": { "kind": "expr", "source": "first(similar.result.items).number" },
          "route": { "kind": "literal", "value": "duplicate" },
        },
      },
    },
    {
      "id": "out_routed",
      "kind": "output",
      "name": "Routed",
      "outcome": "routed",
      "value": {
        "kind": "object",
        "fields": {
          "handled": { "kind": "literal", "value": true },
          "labels": { "kind": "ref", "ref": "labels.result" },
          "route": { "kind": "expr", "source": "first(route.taken)" },
        },
      },
    },
  ],
  "edges": [
    { "id": "c1", "from": { "node": "opened", "port": "no" }, "to": { "node": "out_ignored" } },
    { "id": "c2", "from": { "node": "opened", "port": "yes" }, "to": { "node": "actionable" } },
    { "id": "c3", "from": { "node": "act_gate", "port": "no" }, "to": { "node": "out_ignored" } },
    { "id": "c4", "from": { "node": "act_gate", "port": "yes" }, "to": { "node": "classify" } },
    { "id": "c5", "from": { "node": "act_gate", "port": "yes" }, "to": { "node": "similar" } },
    { "id": "c6", "from": { "node": "is_dup", "port": "dup" }, "to": { "node": "gh_dup_comment" } },
    {
      "id": "c7",
      "from": { "node": "gh_dup_comment", "port": "done" },
      "to": { "node": "out_dup" },
    },
    { "id": "c8", "from": { "node": "is_dup", "port": "new" }, "to": { "node": "labels" } },
    { "id": "c9", "from": { "node": "labels", "port": "done" }, "to": { "node": "gh_label" } },
    { "id": "c10", "from": { "node": "gh_label", "port": "done" }, "to": { "node": "route" } },
    { "id": "c11", "from": { "node": "route", "port": "oncall" }, "to": { "node": "page" } },
    { "id": "c12", "from": { "node": "page", "port": "done" }, "to": { "node": "out_routed" } },
    { "id": "c13", "from": { "node": "route", "port": "product" }, "to": { "node": "out_routed" } },
    { "id": "c14", "from": { "node": "route", "port": "backlog" }, "to": { "node": "out_routed" } },
  ],
}
```

Notes: `similar` is the GitHub MCP `search_issues` tool (its `result` port is typed by the tool signature at instantiation); `dup_judge` is data-activated on `similar.result` (and therefore on `act_gate.yes`); `out_ignored` has one exclusive group (`opened.no` ⊥ `act_gate.no`); `out_routed` has one group (`page.done` is downstream of `route.oncall`, exclusive with `route.product`/`route.backlog`); `labels` shows the AND of a data dependency (`classify`) with a control group (`is_dup.new`) and gets `I_CONTROL_AND`-style visibility through the inspector's dependency panel. Duplicate detection is a boolean over the top candidate, so all option keys stay static (no runtime-computed criteria).

### 11.3 Research Agent (bounded loop, parallel tools, evidence carried in the loop)

```jsonc
{
  "name": "Research Agent",
  "inputs": {
    "type": "object",
    "required": ["question"],
    "properties": {
      "question": { "type": "string" },
      "max_rounds": { "type": "integer", "minimum": 1, "maximum": 5, "default": 3 },
    },
  },
  "outputs": {
    "type": "object",
    "required": ["answer", "evidence", "complete"],
    "properties": {
      "answer": { "type": "string" },
      "evidence": { "type": "array", "items": { "type": "object" } },
      "complete": { "type": "boolean" },
      "rounds": { "type": "integer" },
    },
  },
  "secrets": [
    { "name": "TYPESAFE_API_KEY", "credentialType": "typesafe.api_key" },
    { "name": "ANTHROPIC_API_KEY", "credentialType": "anthropic.api_key" },
    { "name": "SEARCH_API", "credentialType": "http.api_key" },
  ],
  "execution": { "timeoutMs": 600000, "maxCostUsd": 2.0, "maxTokens": 400000, "concurrency": 6 },
  "nodes": [
    { "id": "start", "kind": "input", "name": "Question" },
    {
      "id": "research",
      "kind": "loop",
      "name": "Research rounds",
      "carrySchema": {
        "type": "object",
        "required": ["evidence", "gap"],
        "properties": {
          "evidence": { "type": "array", "items": { "type": "object" } },
          "gap": { "type": "string" },
        },
      },
      "carry": {
        "initial": { "evidence": [], "gap": "none" },
        "next": {
          "evidence": { "kind": "ref", "ref": "store.result" },
          "gap": { "kind": "ref", "ref": "completeness.answers.gap.value" },
        },
      },
      "result": {
        "answer": { "kind": "ref", "ref": "synthesis.structured.answer" },
        "complete": { "kind": "ref", "ref": "completeness.answers.complete.value" },
      },
      "exitWhen": "completeness.answers.complete.value && completeness.answers.complete.confidence >= 0.8 || $scope.iteration + 1 >= start.max_rounds",
      "bounds": { "maxIterations": 5, "maxCostUsd": 1.5, "timeoutMs": 480000 },
      "onExhausted": "route",
    },

    {
      "id": "planner",
      "kind": "task",
      "parent": "research",
      "type": "flowaid.ai.structured_generate",
      "typeVersion": "1.0.0",
      "name": "Plan queries",
      "config": {
        "model": { "provider": "anthropic", "model": "claude-sonnet-4-5" },
        "schema": {
          "type": "object",
          "required": ["queries"],
          "properties": {
            "queries": {
              "type": "array",
              "minItems": 1,
              "maxItems": 4,
              "items": {
                "type": "object",
                "required": ["query", "source"],
                "properties": {
                  "query": { "type": "string" },
                  "source": { "type": "string", "enum": ["web", "papers"] },
                },
              },
            },
          },
        },
      },
      "inputs": {
        "prompt": {
          "kind": "template",
          "source": "Question: {{ start.question }}\nRound {{ $scope.iteration + 1 }}. Known gap: {{ $scope.carry.gap }}\nEvidence so far: {{ $scope.carry.evidence | json }}\nPropose up to 4 targeted searches.",
        },
      },
      "credentials": { "llm": "ANTHROPIC_API_KEY" },
    },

    {
      "id": "search_all",
      "kind": "foreach",
      "parent": "research",
      "name": "Run searches",
      "items": { "kind": "ref", "ref": "planner.structured.queries" },
      "concurrency": 4,
      "failurePolicy": "collect",
      "bounds": { "maxIterations": 4 },
      "collect": {
        "kind": "object",
        "fields": {
          "query": { "kind": "ref", "ref": { "kind": "scope", "field": "item", "path": "/query" } },
          "result": { "kind": "expr", "source": "first(web.body.results)" },
          "judgment": { "kind": "ref", "ref": "judge.answers" },
        },
      },
    },
    {
      "id": "web",
      "kind": "task",
      "parent": "search_all",
      "type": "flowaid.tools.http",
      "typeVersion": "1.0.0",
      "name": "Search",
      "config": {
        "method": "GET",
        "url": "https://search.example.com/v1?q={{ $scope.item.query }}&source={{ $scope.item.source }}",
        "responseType": "json",
      },
      "credentials": { "auth": "SEARCH_API" },
      "policy": { "retry": { "maxAttempts": 2 } },
    },
    {
      "id": "judge",
      "kind": "task",
      "parent": "search_all",
      "type": "flowaid.decision.batch",
      "typeVersion": "1.0.0",
      "name": "Judge result",
      "config": {
        "questions": {
          "relevant": {
            "kind": "score",
            "instructions": "How relevant is this result to the question?",
            "levels": ["Irrelevant", "Weak", "Partial", "Strong", "Direct answer"],
          },
          "reliable": {
            "kind": "score",
            "instructions": "How reliable is the source?",
            "levels": ["Unreliable", "Questionable", "Mixed", "Reliable", "Authoritative"],
          },
        },
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "question": { "kind": "ref", "ref": "start.question" },
            "result": { "kind": "expr", "source": "first(web.body.results)" },
          },
        },
      },
      "credentials": { "typesafe": "TYPESAFE_API_KEY" },
    },

    {
      "id": "store",
      "kind": "task",
      "parent": "research",
      "type": "flowaid.data.transform",
      "typeVersion": "1.0.0",
      "name": "Accumulate evidence",
      "config": {
        "output": { "type": "array", "items": { "type": "object" } },
        "expr": "$scope.carry.evidence + filter(search_all.results, r => r.judgment.relevant.value >= 2 && r.judgment.reliable.value >= 2)",
      },
    },
    {
      "id": "synthesis",
      "kind": "task",
      "parent": "research",
      "type": "flowaid.ai.structured_generate",
      "typeVersion": "1.0.0",
      "name": "Synthesize",
      "config": {
        "model": { "provider": "anthropic", "model": "claude-sonnet-4-5" },
        "schema": {
          "type": "object",
          "required": ["answer", "citations"],
          "properties": {
            "answer": { "type": "string" },
            "citations": { "type": "array", "items": { "type": "string" } },
          },
        },
      },
      "inputs": {
        "prompt": {
          "kind": "template",
          "source": "Question: {{ start.question }}\nEvidence (scored): {{ store.result | json }}\nWrite a sourced answer; cite by url.",
        },
      },
      "credentials": { "llm": "ANTHROPIC_API_KEY" },
    },
    {
      "id": "completeness",
      "kind": "task",
      "parent": "research",
      "type": "flowaid.decision.batch",
      "typeVersion": "1.0.0",
      "name": "Complete?",
      "config": {
        "questions": {
          "complete": {
            "kind": "boolean",
            "instructions": "Does the answer fully address the question with adequate evidence?",
            "criteria": {
              "true": "Complete and well-supported",
              "false": "Missing aspects or weak evidence",
            },
          },
          "gap": {
            "kind": "choice",
            "instructions": "What is the main gap, if any?",
            "options": {
              "none": "No gap",
              "missing_data": "Key facts missing",
              "conflicting": "Sources conflict",
              "outdated": "Evidence may be stale",
            },
          },
        },
      },
      "inputs": {
        "state": {
          "kind": "object",
          "fields": {
            "question": { "kind": "ref", "ref": "start.question" },
            "answer": { "kind": "ref", "ref": "synthesis.structured.answer" },
            "evidence_count": { "kind": "expr", "source": "len(store.result)" },
          },
        },
      },
      "credentials": { "typesafe": "TYPESAFE_API_KEY" },
    },

    {
      "id": "out_done",
      "kind": "output",
      "name": "Answer",
      "outcome": "complete",
      "value": {
        "kind": "object",
        "fields": {
          "answer": { "kind": "ref", "ref": "research.result.answer" },
          "evidence": { "kind": "ref", "ref": "research.carry.evidence" },
          "complete": { "kind": "ref", "ref": "research.result.complete" },
          "rounds": { "kind": "ref", "ref": "research.iterations" },
        },
      },
    },
    {
      "id": "out_partial",
      "kind": "output",
      "name": "Best effort",
      "outcome": "partial",
      "value": {
        "kind": "object",
        "fields": {
          "answer": { "kind": "expr", "source": "coalesce(research.result.answer, '')" },
          "evidence": { "kind": "ref", "ref": "research.carry.evidence" },
          "complete": { "kind": "literal", "value": false },
          "rounds": { "kind": "ref", "ref": "research.iterations" },
        },
      },
    },
  ],
  "edges": [
    { "id": "c1", "from": { "node": "research", "port": "done" }, "to": { "node": "out_done" } },
    {
      "id": "c2",
      "from": { "node": "research", "port": "exhausted" },
      "to": { "node": "out_partial" },
    },
  ],
}
```

Bounds in play: `maxIterations 5`, the `max_rounds` input inside `exitWhen`, a confident completeness decision, loop `maxCostUsd/timeoutMs`, run `maxCostUsd/maxTokens`; the foreach caps items at 4 with `collect` failure policy; retries only on the idempotent GET. Evidence accumulates in `$scope.carry.evidence` (loop state, replay-safe), never in durable KV. Every body node references `start.question`, so `research` inherits a hoisted dependency on `start`. The trace shows each round as a collapsible scope (`research#0`, `research#1`, …) with nested per-query scopes (`research#0/search_all#2`) and the judge's two scores per result.

---

## 12. Implementation plan and design decisions

### 12.1 Plan

The work packages, definitions of done and required tests are `IMPLEMENTATION_PLAN.md`; their sequencing is the phase list in `docs/UPGRADE_PLAN.md` (machine-readable copy `docs/upgrade-plan.json`), which supersedes the plan's wave order. Critical path: `workflow-core` → `workflow-compiler` + `database` + `node-sdk` → `workflow-runtime` + `provider-typesafe` + `nodes-core` slice 1 → `apps/api` + `apps/worker` → `apps/web` builder/runs/trace → acceptance test on `docker compose up`.

### 12.2 Design decisions with rationale

| #   | Decision                                                                                                                                                                        | Rationale                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Event log as truth; projections in the same transaction                                                                                                                         | Queryable history and replayability without dual-write drift; avoids O(n²) JSON-blob rewrites.                                                                                                                               |
| D2  | Single writer with fenced appends; API only enqueues                                                                                                                            | `seq` dense and total; zombie workers cannot write after a takeover; cancel/resume/human input never race.                                                                                                                   |
| D3  | Pure `reduce/ready/step` with effects after commit                                                                                                                              | Deterministic replay; crash recovery is re-reduction; duplicated effects after a crash are harmless.                                                                                                                         |
| D4  | Bindings only for data, explicit control edges, data-activation without control edges                                                                                           | One wiring mechanism (no edge-vs-template desync), exact typed dependency graph, an honest canvas, and no 26-edges-for-10-nodes tax.                                                                                         |
| D5  | One small FlowExpr with a closed function set                                                                                                                                   | Branch conditions, loop exits, transforms and templates need computation; a fixed LL(1) grammar with a typer is small enough to be correct and keeps the runtime interpreter-free of `eval`.                                 |
| D6  | Flat containers with `parent`; outward refs hoisted onto the container; `$scope.carry`                                                                                          | Maps 1:1 to XYFlow parent nodes, unique ids per workflow, no body input/output plumbing, previous-iteration access without cycles.                                                                                           |
| D7  | Closed set of runtime kinds; plugins only route/suspend                                                                                                                         | The scheduler stays testable with golden traces; bounds and trace grouping cannot be bypassed; third parties still get branching and HITL.                                                                                   |
| D8  | Manifest-only compiler with declarative port rules                                                                                                                              | On-canvas diagnostics identical to the server's without shipping node code to the browser; the API never loads executors.                                                                                                    |
| D9  | Conservative `isSubschema` with `W_TYPE_UNVERIFIED`                                                                                                                             | Sound where decidable, never blocks authors on regex or unknown-typed HTTP bodies, and the runtime validates on delivery anyway.                                                                                             |
| D10 | Postgres queue/timers/notify as the no-Redis path; BullMQ as a scaling profile                                                                                                  | Self-hosting is a product feature; timers survive Redis loss; identical retry semantics in both modes.                                                                                                                       |
| D11 | Idempotency as a manifest contract; durable retry timers; `none` never re-executed                                                                                              | "Never blindly retry irreversible actions" as a mechanism; a crash during a retry wait is not a lost worker.                                                                                                                 |
| D12 | Immutable versions incl. ephemeral drafts; deployments as pointers; bindings per workflow × environment                                                                         | Every run (even from the canvas) is reproducible; promote is a pointer + bindings change, never a JSON rewrite.                                                                                                              |
| D13 | Exclusive-group control semantics with guard-DNF analysis                                                                                                                       | One rule covers merge, join and AND-after-branch correctly (the case the other rules got wrong), with `E_CONTROL_AMBIGUOUS` when intent cannot be proven.                                                                    |
| D14 | Run completes when the root scope drains; `earlyExit` is opt-in                                                                                                                 | Side-effect siblings are never aborted mid-flight by default; early exit stays available for fan-in-heavy flows.                                                                                                             |
| D15 | Boolean `confidence = max(p, 1−p)`, `probabilities` on every kind, score `level/levelLabel`                                                                                     | One Confidence Gate threshold is comparable across kinds; matches the spec's `DecisionResult<T>` field for field.                                                                                                            |
| D16 | Static decision batch groups in the plan                                                                                                                                        | TypeSafe's native batching used deterministically and visibly, not through a timing window.                                                                                                                                  |
| D17 | Explicit re-entry (`NodeResult.suspend` + `ctx.resume`) instead of a step journal                                                                                               | Mid-node approval and agent loops without Temporal-grade determinism rules that cannot be enforced on npm packages.                                                                                                          |
| D18 | Price snapshots on generation/decision events                                                                                                                                   | Historical cost never drifts when the catalog changes.                                                                                                                                                                       |
| D19 | Write-time redaction by data class and learned secret values                                                                                                                    | No code path can read unredacted PII or secrets from history; exports safe by construction.                                                                                                                                  |
| D20 | Envelope encryption with KEK versions and pluggable master keys                                                                                                                 | Rotation without re-encrypting data; KMS/Vault ready.                                                                                                                                                                        |
| D21 | Plugins in a separate plugin host process per package (Node permission model, scrubbed env, JSON-only ctx proxy, verified integrity); user code only in the `code` pool sandbox | A process boundary for admin-trusted plugin code (a `worker_threads` Worker shares the process and its environment, so it was never a boundary); untrusted user code stays in the sandbox pool, which holds no key material. |
| D22 | Routes declare auth + Zod schemas; OpenAPI 3.1 generated; SDK/CLI generated                                                                                                     | Default-deny auth, no docs drift, one contract for every client.                                                                                                                                                             |
| D23 | Canvas as a projection of the definition in a zustand store                                                                                                                     | Same workflow via API/SDK/YAML/AI; undo/redo via patches; no React Flow JSON in the DB.                                                                                                                                      |
| D24 | Evaluation-gated publish and add-to-evaluation from runs                                                                                                                        | The product loop (edit → run → evaluate → publish) is enforced by the API, not by discipline.                                                                                                                                |
| D25 | Human tasks are rows + events resumed through jobs; external review by single-use hashed tokens                                                                                 | Durable, restart-safe, auditable; no in-memory waits, no "latest execution for session" races.                                                                                                                               |
| D26 | Postgres only, uuid v7, Drizzle migrations applied explicitly                                                                                                                   | One migration tree, time-ordered ids, fail-fast boot.                                                                                                                                                                        |
| D27 | FlowAId importer (`@flowaid/importer`) isolated behind placeholder nodes that fail compile                                                                                      | Nothing silently degrades; attribution contained in one package.                                                                                                                                                             |

### 12.3 Judge flaws → resolutions

| Flaw (proposal)                                                                                                                      | Resolution                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body-graph outer references contradictory; nested `GraphSchema` breaks XYFlow/layout ids (runtime-first)                             | Flat containers with `parent`; outward refs legal and hoisted onto the container (§2.6, D6); ids unique per workflow.                                     |
| One-edge-per-port + node-local expressions ⇒ merge-node tax; demos would not compile (runtime-first)                                 | Bindings (`object`/`array`/`template`/`expr`) assemble state, carry, bodies and prompts (§2.2); demos rewritten and compiled in CI.                       |
| `completeOnFirstOutput` aborts side-effect siblings (runtime-first)                                                                  | Run drains the root scope; `earlyExit` opt-in per output node (§2.7, D14).                                                                                |
| Human kind declares no input ports yet the example wires them (runtime-first)                                                        | Human node has `title`, `context`, `mode.value` bindings; outputs `decision`/`value` (§2.4).                                                              |
| Step journal requires determinism no ESLint rule can enforce on npm packages; unbounded `node_run_steps` (runtime-first)             | Dropped; explicit re-entry with `NodeResult.suspend`/`ctx.resume` (§3.3, D17).                                                                            |
| Boolean lacks `probabilities`; `                                                                                                     | p−0.5                                                                                                                                                     | ·2` not comparable with choice confidence (runtime-first, devx) | Boolean carries `probabilities {true,false}` and `confidence = max(p, 1−p)` (§2.8, D15). |
| Branch requires declared inputs + projection edge + expression (runtime-first)                                                       | Branch cases reference values directly (`intent.decision.value == 'billing'`); the compiler extracts the dependency (§2.4).                               |
| Twelve bespoke kinds, `parallel` overlaps fan-out + race (runtime-first)                                                             | Kinds reduced to ten (+ `note`); `router` is a task with `controlPortsFromConfig`; race is `join{race}` with compiler-computed private subgraphs (§5.10). |
| `NodeTypeIdSchema` forbids underscores used by core ids (runtime-first)                                                              | Regex allows `_` inside segments; ids like `flowaid.decision.confidence_gate` parse (§2.1).                                                               |
| Static `controlPorts` cannot express a router; `ports(config)` functions cannot run in the browser (all three)                       | Declarative port rules + `resolveTool`/`resolveSubflow` data (§4.2, D8).                                                                                  |
| `PathSchema` cannot address keys with `-`/spaces (runtime-first)                                                                     | Paths are JSON Pointers (§2.1).                                                                                                                           |
| Cancel job routing to the lease holder unspecified; API appends terminal events while a worker holds the lease (runtime-first, devx) | Flag + control channel + heartbeat re-read; lease holder appends; control job only when no holder (§5.8).                                                 |
| Retry delays slept in-process while holding the lease (product-ops)                                                                  | All retry waits are durable timers; lease released when idle (§5.8, D11).                                                                                 |
| No zombie fencing on append (product-ops)                                                                                            | Fenced `last_seq` CAS on every worker append (§5.1).                                                                                                      |
| Checkpoint rewritten per node with inline values; single `waiting` slot (product-ops)                                                | `run_checkpoints` every 200 events with refs only; waits keyed by nodeRunId (§5.6, §5.10).                                                                |
| No pure reducer; checkpoint not regenerable from events (product-ops, devx)                                                          | Pure `reduce`; checkpoint = reduced state at `seq` (§5.3).                                                                                                |
| Four overlapping wiring mechanisms and a large expression surface (product-ops)                                                      | Bindings only; FlowExpr scoped to a closed grammar and function set; no strings-in-strings `filter/map` (lambdas parsed) (§2.2–2.3).                      |
| Control fan-in AND/OR contradiction; `labels` never runs (product-ops); early activation on independent branches (devx)              | Exclusive groups: OR within, AND across; pruned as soon as a group is dead (§2.5, §4.3, D13).                                                             |
| Durable `$state` used as loop accumulator ⇒ double-append on replay (product-ops)                                                    | Evidence carried in `$scope.carry` (§11.3).                                                                                                               |
| `InputNode.schema: {"$ref": "#/inputs"}` self-reference (product-ops)                                                                | Input node has no schema field; ports come from `inputs` (§2.4).                                                                                          |
| Default failover chain `['typesafe','llm','rule']` undefined without a configured model (product-ops)                                | Hops are typed (`llm` requires a `ModelRef`); default chain is `[typesafe]` only; `W_FAILOVER_UNCONFIGURED` (§6.2).                                       |
| Control edges only from branch ports; no plain sequencing (devx)                                                                     | Every node has `done` (+`failed`); control edges may start at any control-out (§2.4).                                                                     |
| Recovery from `node_runs` without a fold algorithm (devx)                                                                            | Recovery = checkpoint + reduce over events (§5.6).                                                                                                        |
| Demo cycle through previous-iteration refs (devx)                                                                                    | `$scope.carry` with `carry.initial` (§2.6).                                                                                                               |
| Unknown-typed HTTP body into constrained ports is an error (devx)                                                                    | `W_TYPE_UNVERIFIED` + runtime validation (§4.5, D9).                                                                                                      |
| `race` unbuildable (devx)                                                                                                            | `join{race}` with compiler-computed private subgraphs (§5.10).                                                                                            |
| Human `reject` throws and fails the run (devx)                                                                                       | `rejected` is a control port; reject is a normal outcome (§2.4).                                                                                          |
| Zod `transform` branding breaks JSON Schema emission (devx)                                                                          | Ids are plain validated strings (CONTRACTS.ts header).                                                                                                    |
| `NODE_STREAM` persisted; 10 ms batching window nondeterministic (devx)                                                               | `GENERATION_DELTA` is ephemeral (`seq 0`, never stored); batching is static (§4.4, §5.12).                                                                |
| Transform combinators unspecified (devx)                                                                                             | `flowaid.data.transform` is a FlowExpr with a declared output schema (`outputSchemaFromConfig`).                                                          |
| Restart mutates the original run (devx)                                                                                              | Restart/fork/replay always create a new run (§5.9).                                                                                                       |
| Evaluation runs stall on human nodes (runtime-first)                                                                                 | Auto-resolution from `expectations.human` (§10.4).                                                                                                        |
| `credentials` depends on `database` (runtime-first)                                                                                  | `CredentialRepository` interface injected; `observability` can import the `Redactor` (§1.1).                                                              |
| 529 mapped to rate limiting (product-ops)                                                                                            | `PROVIDER_OVERLOADED` code and `ProviderOverloadedError` (§6.3).                                                                                          |
| API keys default to `prod` (product-ops)                                                                                             | Unpinned keys must pass `environmentId`; 400 otherwise (§8).                                                                                              |
| `RUN_REVIEWED` after the terminal event (product-ops)                                                                                | Verdict stored in `runs.review` + audit, not as a run event (§10.5).                                                                                      |
| `credentials_ws_name_env_uq` with nullable environment (product-ops)                                                                 | Unique on `coalesce(environment_id, zero-uuid)` (§7).                                                                                                     |
| Package named `config` collides with the existing tooling package                                                                    | Runtime configuration lives in `@flowaid/env` (§1).                                                                                                       |

### 12.4 Acceptance test mapping

`git clone` → `cp .env.example .env` → `docker compose up` (postgres 16 + pgvector, minio, api, worker, worker-code, web; migrations run by the api entrypoint; first boot creates the owner from `FLOWAID_ADMIN_EMAIL/PASSWORD` — shipped uncommented with working values in `.env.example` — the default workspace `default` and the `dev/staging/prod` environments, §8) → login → New workflow → palette adds Input, TypeSafe Choice, Branch, HTTP, Generation Model, TypeSafe Boolean, Confidence Gate, Human Approval, Output (canvas shows diagnostics until wired; dragging data handles writes bindings) → Credentials: add TypeSafe, OpenAI, HTTP bearer; bind under Settings → Secrets → dev → Publish (v1; evaluation gate skipped when no set is linked) → `POST /v1/workflows/:id/run` with an API key pinned to `dev` → builder and Runs show live status via SSE → trace: probability ruler on the choice node, streamed text on Generate, HTTP args/result, latency and cost per node → run suspends at Human Approval (`waiting_for_human`; inbox + external link) → approve (optionally editing the reply) → `RUN_RESUMED`, output produced → Replay (`recorded`) → edit (change options) → Publish v2 → Versions → Compare (diff + both runs' metrics) → Evaluations: create a set (add both runs as cases via add-to-evaluation), run against v1 and v2, read the regression report → **Download code** for v2 → `pnpm install && pnpm validate && pnpm test && pnpm flow -- --input inputs/example.json` reproduces the server run's output shape (`CODE_EXPORT.md` §5). The journey runs in CI with `FLOWAID_PROVIDER_FIXTURES=replay` (recorded TypeSafe/OpenAI responses) and against live keys when the secrets exist.

### 12.5 Deliberately not in the first slice

Knowledge/RAG beyond pgvector scaffolding, the Agent node tool loop (uses `NodeResult.suspend`), schedules UI, OIDC, MFA, KMS providers other than env/file, Qdrant/Pinecone adapters, cost optimizer / smart routing, the AI builder/critic (the compiler diagnostics _are_ the static critic; the AI critic wraps them later), plugin marketplace commands. Excluded from navigation until real, per the quality bar (`features` map, §8/§9). **In** the slice, explicitly: evaluations (the journey ends with a regression report) and code export ("Download code"). **LangChain** (`@flowaid/langchain`, `@flowaid/nodes-langchain`) is an owner requirement but not a prerequisite of the worker or of the acceptance journey: the worker loads bundled plugins optionally (§3.5), so the two packages are built in parallel with the services phase and gated behind `features.langchain`.
