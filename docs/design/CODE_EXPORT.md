# flowaid — Code export ("Download code package")

Status: **authoritative addendum** to `ARCHITECTURE.md` (v1.1, 2026-09-22; routes, `runLocally` signature and the jobs model corrected by the design review — see `RFCS.md` RFC-0001). Product requirement from the owner: _the system must let a user download the full package of code for a flow built in FlowAId._ The canvas is one interface; the exported package is another, and it must run without the FlowAId server.

## 1. What the user gets

For any workflow version (published, or the current draft), one action — **Download code** — produces a zip:

```
flowaid-<workflow-slug>-v<version>/
  README.md                 what this is, how to run it locally, how to run it against a FlowAId server, how to re-import
  package.json              scripts: flow, test, validate, serve; deps pinned to the platform version
  pnpm-lock.yaml            when the server has one for the vendored set (reproducible installs)
  .env.example              one line per declared secret (TYPESAFE_API_KEY, OPENAI_API_KEY, CRM_TOKEN …) + variables with defaults
  workflow.json             canonical WorkflowDefinition (secret NAMES only, never values; layout included)
  workflow.plan.json        compiled ExecutionPlan + planHash + COMPILER_VERSION + catalogSnapshot
  src/workflow.ts           the same workflow as typed code: defineWorkflow()/ref()/obj()/tpl() builders from @flowaid/workflow-sdk
  src/run.ts                local runner: loads .env, compiles src/workflow.ts, executes with the embedded runtime, streams events to stdout, prints the trace timeline and output
  src/serve.ts              optional HTTP wrapper: POST /run (sync/async), GET /runs/:id/stream (SSE) — the same wire format as the platform API
  src/client.ts             alternative: run the workflow on a FlowAId server through @flowaid/workflow-sdk (FLOWAID_BASE_URL + FLOWAID_API_KEY)
  inputs/example.json       sample input satisfying `inputs` (generated from the schema; taken from the last successful run when the user chooses "include sample from run")
  tests/workflow.test.ts    Vitest: compiles with zero errors; runs against fake providers with recorded decisions (from the chosen run when available); asserts branches taken
  Dockerfile                node:24-alpine image running src/serve.ts
  vendor/*.tgz              (vendored mode) tarballs of the @flowaid runtime packages the flow needs
  vendor/SHA256SUMS         (vendored mode) checksums of every tarball; tests/vendor-integrity.test.ts verifies them and pnpm-lock.yaml pins their integrity
  NOTICE, LICENSE           Apache-2.0
```

Two dependency modes, chosen by the server (`FLOWAID_EXPORT_MODE=npm|vendored`, default `vendored` until the packages are published):

- **npm** — `package.json` depends on the published `@flowaid/*` packages at the platform's version.
- **vendored** — the API image carries `/opt/flowaid/vendor/*.tgz` + `SHA256SUMS` (built by the `vendor` stage of `docker/Dockerfile` with `pnpm pack` for every runtime package, which requires the packages' `dist` exports) and the export's `package.json` points at `file:./vendor/<name>.tgz` (`FLOWAID_VENDOR_DIR`, default `/opt/flowaid/vendor`). The zip is self-contained; `pnpm install && pnpm flow` works offline apart from the model providers the flow calls.

**Redaction.** The export reads only persisted, already-redacted `node_runs`/`run_events`; fields with `x-dataClass: pii | sensitive` and `{ "$redacted": true }` stubs are replaced by schema-generated placeholders that the README lists; nodes with `privacy.sensitive` are excluded from recorded runs; `environments.variables` are never exported (only `WorkflowDefinition.variables` defaults); `workflow.json` carries secret names only.

Only the packages the flow needs are included: the closure of `@flowaid/workflow-core`, `workflow-compiler`, `workflow-runtime`, `node-sdk`, `nodes-core`, `providers`, `credentials` (env master key), `observability`, plus the `provider-*` packages referenced by the plan's model refs, `mcp`/`openapi-tools`/`sandbox` when the plan uses those node types, and `workflow-sdk` for `src/client.ts`.

## 2. Embedded runtime ("library mode")

The export works because the runtime is already a library: `@flowaid/workflow-runtime` exposes `initialState/reduce/ready/step`, `Orchestrator`, `MemoryRunStore`, `MemoryQueueDriver`, `MemoryEventBus`. This addendum adds one convenience entry point:

```ts
// @flowaid/workflow-runtime — the runtime never imports node, provider or sandbox packages (ARCHITECTURE.md §1.1); the caller wires them in.
export interface LocalRunOptions {
  input: JsonValue;
  nodes: NodePackage[]; // REQUIRED: e.g. [corePackage] from @flowaid/nodes-core (+ nodePackage from @flowaid/nodes-langchain)
  providers: ProviderRegistry; // REQUIRED: built by the caller from provider-* factories + `secrets`
  sandbox?: SandboxExecutor; // optional: IsolatedVmSandbox from @flowaid/sandbox; without it a `code` node fails with SANDBOX_UNAVAILABLE
  secrets?: Record<string, string>; // default: process.env, keyed by secret name (env master key provider)
  variables?: Record<string, JsonValue>;
  onEvent?: (e: RunEvent) => void; // live stream, same events the API streams over SSE
  human?: (req: HumanRequest) => Promise<HumanResponse>; // default: prompt on the terminal (runner) / 501 (serve)
  recorded?: RecordedOutputs; // replay mode
  signal?: AbortSignal;
}
export async function runLocally(
  definition: WorkflowDefinition | ExecutionPlan,
  opts: LocalRunOptions,
): Promise<LocalRunResult>;
// LocalRunResult = { runId, status, output, outcome, events, nodeRuns, trace: Span[], usage, costUsd }
```

`runLocally` compiles (when given a definition), builds an in-process `Orchestrator` over the memory stores, executes every pool in-process with the executors of `opts.nodes` and the providers of `opts.providers` (`code` nodes through `opts.sandbox`), and resolves human nodes through `opts.human`. Timers are real timers in-process. Everything else — reducer, events, redaction, accounting — is the identical code path the worker uses, so a local run produces the same event log as a server run and can be imported back as a run fixture. There are **no defaults** for `nodes`/`providers`: the generated `src/run.ts` and `src/serve.ts` (codegen templates) and the CLI's `workflow run --local` do the wiring (`corePackage`, the `provider-*` factories for the plan's model refs, `IsolatedVmSandbox` when `@flowaid/sandbox` is installed), which is why `packages/cli` is allowed to import those packages and `packages/workflow-runtime` is not.

The CLI gains `flowaid workflow run --local <file|dir> --input input.json` on top of this.

## 3. Generated code (`@flowaid/codegen`)

New package `packages/codegen` (deps: `workflow-core`, `workflow-compiler`, `shared`):

- `generateWorkflowTs(def): string` — emits `src/workflow.ts` using the SDK builders fixed in `API.md` §8.1 (`defineWorkflow, input, output, task, branch, join, loop, foreach, subflow, wait, human, note, edge, ref, lit, tpl, expr, obj, arr, secret, variable, trigger`). Every node kind, binding kind (`literal | ref | template | expr | object | array`), policy, container, control edge, secret, variable, trigger and the layout is representable; the generator is total over `WorkflowDefinitionSchema` (a fast-check property over random valid definitions proves it). Output is formatted with Prettier's standalone API.
- `generateRunner(def, plan, mode)`, `generateServe()`, `generateClient()`, `generateReadme()`, `generateEnvExample(def)`, `generateExampleInput(inputsSchema, sampleFromRun?)`, `generateTests(def, plan, recordedRun?)`, `generateDockerfile()`, `generatePackageJson(def, plan, { mode, platformVersion, vendorList })`.
- `packageClosure(plan): string[]` — the `@flowaid/*` packages the flow needs (`provider-*` by model refs, `mcp`/`openapi-tools`/`sandbox` by node types, `langchain`/`nodes-langchain` when `langchain.*` nodes or `langchain:*` providers are used).
- `buildExportBundle(input): Promise<ExportBundle>` — assembles the file map above; `ExportBundle.toZip(): Uint8Array`.
- **Round-trip guarantee** (tested in CI on the example and the three demo templates, and enforced at export time): evaluating the generated `src/workflow.ts` with the SDK builders yields a definition with the same `definitionHash` as the source. If it does not, the export fails with `CODEGEN_ROUNDTRIP` (never ships a package that differs from what the user built).

## 4. API, CLI, UI

- `POST /v1/workflow-versions/:versionId/export/package` `{ mode?: 'npm' | 'vendored', includeSampleFromRunId?: string, includeRecordedRunId?: string }` → `202 { job_id }` (a `jobs` row plus a `Job { type: 'export.package' }` on the worker's `jobs` queue, RFC-0001) then `GET /v1/jobs/:id` → `{ status, artifact_id?, error? }`; `GET /v1/artifacts/:id/download` streams the zip (`artifacts.kind = 'export'`, `expires_at = 24 h`, authorised by `workflows:read` on `artifacts.workflow_id`; `Content-Disposition: attachment; filename="flowaid-<slug>-v<version>.zip"`). Draft: `POST /v1/workflows/:id/draft/export/package` (compiles the current draft first; 422 with diagnostics when it has errors). `:versionId` is always a uuid. Scope `workflows:read`. Audited (`workflow.exported`).
- `GET /v1/workflow-versions/:versionId/export?format=json|yaml|ts` and `GET /v1/workflows/:id/draft/export?format=…` return the single file (`ts` = generated `src/workflow.ts`, produced synchronously in the API).
- CLI: `flowaid workflow export <id> [--version n|draft] [--format json|yaml|ts]` and `flowaid workflow package <id> [--version n|draft] [--out ./flow.zip] [--mode npm|vendored]` (`--version n` resolves the version id and calls `/v1/workflow-versions/:versionId/…`; `draft` calls `/v1/workflows/:id/draft/…`); `flowaid workflow run --local`.
- UI: **Download code** in the builder overflow menu and on every row of the versions page; a small dialog (version, mode, "include sample input from last run", "include recorded run for tests") → progress → browser download of the zip. `ExportDialog` in `@flowaid/ui/builder`.
- SDK: `client.workflows.exportPackage(id, { version, mode })` → `Uint8Array`.

## 5. Acceptance test addition

After "Publish version 2" in `ARCHITECTURE.md` §12.4: **Download code** for v2 → unzip → `pnpm install` → `pnpm validate` (zero diagnostics) → `pnpm test` (green with fake providers) → `pnpm flow -- --input inputs/example.json` with real keys from `.env` → the same output shape as the server run, and the printed trace shows the TypeSafe probabilities.

## 6. Work package

**WP-17b `@flowaid/codegen` + export** (upgrade plan Phase 4, needs WP-09 runtime, WP-12 nodes-core, WP-15 api, WP-17 sdk/cli, and the `dist` package exports from Phase 0): `packages/codegen`, `runLocally` in `workflow-runtime`, the API routes + `jobs` table/queue + artifact, CLI commands, `ExportDialog`, the `vendor` stage in `docker/Dockerfile`, `FLOWAID_EXPORT_MODE`/`FLOWAID_VENDOR_DIR` in `@flowaid/env`, round-trip tests on all fixtures, and the acceptance step above. It is part of the first-slice release gate (ARCHITECTURE.md §12.4).
