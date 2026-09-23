# @flowaid/workflow-core

The portable flowaid contracts: the split of `docs/design/CONTRACTS.ts` (§1–15, §17) into
modules, plus the implementations the contract declares (`parseRef`/`formatRef`,
`definitionHash`, `toFlowaidError`, `DecisionResultJsonSchema`, the FlowExpr
parser/evaluator, the template scanner/renderer and the subschema checker).

Everything a browser, the API, a worker or the CLI needs to _describe_ a workflow, a plan,
a run or an event lives here. Nothing that _executes_ one does: the compiler is
`@flowaid/workflow-compiler`, the scheduler is `@flowaid/workflow-runtime`, node
implementations use `@flowaid/node-sdk`.

## What lives here

| Concern     | Modules                                                      | Highlights                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON model  | `src/json.ts`                                                | `JsonValue`, RFC 6901 pointers, RFC 6902 patches, `DataClass`, `x-ui` hints, `JsonSchema` + `JsonSchemaSchema`                                                                                                                                                                                                                          |
| Identifiers | `src/ids.ts`                                                 | node/port/edge/type/secret/variable/scope regex schemas, `RESERVED_IDS`                                                                                                                                                                                                                                                                 |
| Bindings    | `src/bindings.ts`                                            | `Ref`, `Binding`, `ExprAst`, `TemplatePart`, `CompiledTemplate`, `EvalScope`, `parseRef` / `formatRef`                                                                                                                                                                                                                                  |
| FlowExpr    | `src/expr/{functions,lexer,parser,typer,regex,evaluator}.ts` | closed function set (`FUNCTION_SIGNATURES`), `Lexer`, `parseExpression` / `parseEmbeddedExpression`, `inferExprType`, vetted regex literals (`checkRegexLiteral`, `setDefaultRegexEngine`), bounded `evaluateExpression` (`STEP_LIMIT`, `MAX_EVAL_RESULT_BYTES`, `MAX_EVAL_INPUT_BYTES`, `expressionError`, `jsonToText`, `jsonTypeOf`) |
|             | `src/expr/printer.ts`                                        | `printAst(ast)`: canonical source for an `ExprAst`, the exact inverse of `parseExpression` (property-tested)                                                                                                                                                                                                                            |
|             | `src/expr/refs.ts`                                           | `collectRefs(ast)`, `collectTemplateRefs(template)`: every `Ref` an expression or template reads, in source order                                                                                                                                                                                                                       |
|             | `src/expr/scope.ts`                                          | `createEvalScope(values: EvalScopeValues)`: a plain-data `EvalScope` (ports, vars, `$scope`, `$run`, `now`) whose paths are projected by `projectValue`                                                                                                                                                                                 |
| Templates   | `src/template.ts`                                            | `parseTemplate` / `renderTemplate` / `applyTemplateFilter`, `TEMPLATE_HOLE_FILTERS`, `TEMPLATE_CONTAINER_FILTERS`, `filterAcceptsContainers` (`{{ expr \| filter }}`, `\{{` escapes; filters below)                                                                                                                                     |
| Subschema   | `src/schema/{pointer,normalize,subset,project}.ts`           | RFC 6901 pointer utilities, `isSubschema` (conservative, `verified: false` for undecidable cases), `projectSchema`, `projectValue` (see below)                                                                                                                                                                                          |
| Manifests   | `src/manifest.ts`                                            | ports, `NodeManifest`, port rules, credential slots, idempotency spec, `NodeCatalog`                                                                                                                                                                                                                                                    |
| Policies    | `src/policy.ts`                                              | error codes, retry/backoff, privacy, node and execution policies, provider hops, bounds                                                                                                                                                                                                                                                 |
| Definition  | `src/nodes.ts`, `src/definition.ts`                          | every node kind, `ControlEdge`, variables/secrets/triggers/layout, `WorkflowDefinitionSchema`, `definitionHash`, `canonicalDefinition`                                                                                                                                                                                                  |
| Decisions   | `src/decision.ts`                                            | `DecisionResult` per kind (§2.8), `DecisionResultJsonSchema`                                                                                                                                                                                                                                                                            |
| Errors      | `src/errors.ts`                                              | `ErrorInfo`, `FlowaidError` and one subclass per `ErrorCode`, `toFlowaidError`, `ErrorEnvelopeSchema`                                                                                                                                                                                                                                   |
| Human       | `src/human.ts`                                               | `HumanRequest`, `HumanResponse`, `HumanDecision`                                                                                                                                                                                                                                                                                        |
| Runs        | `src/run.ts`                                                 | `Run`, `NodeRun`, statuses, `TERMINAL_RUN_STATUSES`                                                                                                                                                                                                                                                                                     |
| Events      | `src/events.ts`                                              | `RunEventSchema` (50 types), `TERMINAL_EVENT_TYPES`, `DurableRunEvent` / `EphemeralRunEvent`                                                                                                                                                                                                                                            |
| Diagnostics | `src/diagnostics.ts`                                         | `DiagnosticCodeSchema` (96 codes), `Diagnostic` with location and quick fix                                                                                                                                                                                                                                                             |
| Plan        | `src/plan.ts`                                                | `ExecutionPlan`, `PlanNode`, `PlanOp`, `CompiledBinding`, tool definitions, `CompileOptions` / `CompileResult`                                                                                                                                                                                                                          |
| Tools       | `src/tools.ts`                                               | `ToolResult`                                                                                                                                                                                                                                                                                                                            |
| Providers   | `src/providers.ts`                                           | decision / generation / embedding provider interfaces, `DecisionQuestion`, `ModelCatalog`, `SafeFetch`                                                                                                                                                                                                                                  |
| Store       | `src/store.ts`                                               | `RunStore`, `ArtifactStore`, `QueueDriver`, `EventBus`, `CredentialRepository`, `Job`                                                                                                                                                                                                                                                   |

The two counts above (50 event types, 96 diagnostic codes) are pinned by
`src/contracts.test.ts`, so a member added or removed fails that test until the count and
this table are updated together; every other closed enum is checked member-by-member
against `docs/design/CONTRACTS.ts` by `src/contracts-parity.test.ts`.

`src/index.ts` re-exports every module. Not exported from this package: `compile()` /
`validate()` (owned by `@flowaid/workflow-compiler`) and §16 of CONTRACTS.ts (owned by
`@flowaid/node-sdk`; only `SafeFetch` is defined here because `ProviderFactory` needs it).
`src/contracts-parity.test.ts` enforces this split: it reads `docs/design/CONTRACTS.ts` at
test time and fails on any missing, renamed or extra-excluded contract name and on any
drift in the closed enums.

## The browser-safety rule

This package runs in the browser (the canvas validates, compiles and type-checks with it in
a Web Worker). Therefore:

- `src/` imports only `zod`, `@flowaid/shared` and `recheck` (its pure-JS build,
  `recheck/lib/browser.js`, so the ReDoS check is one synchronous function with the same
  verdicts in Node and in the browser — the package's Node entry would spawn a worker thread
  and a native binary); no Node built-ins (`node:fs`, `crypto`, `path`, …), no DOM globals. The rule is enforced by ESLint (`boundaryConfig("workflow-core")`
  from `eslint.boundaries.js`; `boundaries.json` marks the package `browserSafe`) and by
  the root boundaries test.
- Test files (`*.test.ts`) may use Node built-ins to read fixtures and design documents
  from disk. They never ship: `tsconfig.build.json` excludes them, and
  `testBoundaryConfig("workflow-core")` lifts only the built-in ban for them.
- `definitionHash` hashes through `@flowaid/shared`'s `sha256Json` (stable stringify +
  SHA-256 from `@noble/hashes`: pure JS and synchronous, so the hash contract stays sync
  and nothing touches `node:crypto`). `@flowaid/shared` is marked `browserSafe` too.
- Bundle-smoke guarantee: `scripts/check-browser-bundle.test.ts` (root Vitest project,
  `pnpm boundaries`) bundles `packages/workflow-core/src/index.ts` and
  `packages/shared/src/index.ts` with esbuild `--platform=browser`, fails on any Node
  built-in specifier anywhere in the transitive graph (third-party dependencies included),
  runs the bundle with only Web platform globals, and hashes
  `fixtures/example-support-reply.json` through the bundled `definitionHash` under
  happy-dom, comparing against an independent `node:crypto` digest. The rule therefore
  holds transitively, not just per package.
- `z.toJSONSchema(schema, { target: 'draft-2020-12' })` succeeds unchanged for
  `WorkflowDefinitionSchema`, `NodeManifestSchema`, `ExecutionPlanSchema` and
  `RunEventSchema`; no overrides are needed (verified in `src/fixtures.test.ts`).

## FlowExpr limits (ARCHITECTURE.md §2.3, RFC-0003)

- Budget: 1 000 000 steps per evaluation — one per AST node visited (lambda bodies on every
  invocation) plus one per element for the array built-ins (`sort` n·log₂n; `join`, `in`,
  `contains`, `sum`, `avg`, `min`, `max`, `keys`, `values`, `split`, `len` n). `STEP_LIMIT`.
- Sizes: values the expression builds ≤ 1 MiB of compact JSON (`RESULT_TOO_LARGE`); values
  read through a reference ≤ 8 MiB (`INPUT_TOO_LARGE`); value nesting ≤ 512 (`DEPTH_LIMIT`,
  iterative measurement — hostile inputs never overflow the stack); AST height ≤ 100.
- Regex: the pattern (and flags) of `matches` / `regex_test` / `regex_match` must be string
  literals (`E_EXPR_REGEX_DYNAMIC`, runtime `INVALID_ARGUMENT`), vetted with `recheck`
  (`E_EXPR_REGEX_UNSAFE`, runtime `INVALID_REGEX`; polynomial patterns count as unsafe —
  anchor them), pattern ≤ 1 024 and subject ≤ 65 536 characters. Compiled regexes are
  memoised per evaluation; `setDefaultRegexEngine` lets a worker install `re2`.
- Dates: `format_date` accepts epoch milliseconds, `YYYY-MM-DD` (UTC midnight) or RFC 3339
  with `Z`/`±HH:MM`; nothing depends on the process time zone. `pnpm test:tz` re-runs the
  date and function suites under `TZ=America/New_York` (the `tz-new-york` Vitest project,
  which `pnpm test` also runs).
- Literals: non-finite number literals (`1e999`) and duplicate object-literal keys are syntax
  errors.

## Compact reference grammar

`parseRef` accepts the compact form used in templates, expressions and the SDK and
normalises it to the JSON `Ref`:

```
node.port                 → { kind: 'port', node, port }
node.port.a.b[0]['x-y']   → { kind: 'port', node, port, path: '/a/b/0/x-y' }
$vars.name                → { kind: 'var', name }
$scope.item.title         → { kind: 'scope', field: 'item', path: '/title' }
$run.id                   → { kind: 'run', field: 'id' }
```

Dotted and bracketed segments after the port (or `$scope` field) map to RFC 6901 pointer
tokens (`~` → `~0`, `/` → `~1`). `formatRef` is the exact inverse, with one caveat: a
`path` of `''` (the empty pointer, which addresses the whole port or `$scope` field) is
treated as absent — `formatRef({ …, path: '' })` prints `node.port` and `parseRef` gives a
`Ref` without `path`, so `path: ''` round-trips to _no_ `path`. Every other pointer
round-trips exactly, including `/` (one empty token), `~`, quotes and control characters
(`a.b['']`, `a.b['a/b']`, `a.b['it\'s']`, `a.b['\u0001']`); `src/bindings.test.ts` proves
it with fast-check over generated tokens for both `parseRef(formatRef(ref))` and
`parseExpression(formatRef(ref))`.

## `isSubschema` / `projectSchema` / `projectValue`

`src/schema/` implements ARCHITECTURE.md §4.5. `normalize.ts` flattens a schema level (local `$ref`/`$defs`/`definitions` resolved, `allOf` intersected, missing `type` = any, `enum`/`const` as a literal set with object/array members turned into structure, OpenAPI `nullable` folded into the type set, `anyOf`/`oneOf` kept for distribution, every undecidable keyword recorded).

`isSubschema(S, T)` returns `{ ok: true, verified }` or `{ ok: false, reason, path }` where `path` is a _value-space_ JSON Pointer (`/name`, `/0`, `/*` for any item or additional property). Rules, in order: `T` unconstrained ⇒ ok; `S` `anyOf`/`oneOf` ⇒ every alternative; `T` `anyOf`/`oneOf` ⇒ the flat `S` is sliced by literal (when it has an `enum`/`const`) or by effective type (`type: ['string', 'null']` gives a `string` and a `null` slice, each keeping the other constraints) and every slice must fit some alternative (`oneOf` also needs that slice provably disjoint from the other alternatives, else unverified), so Zod's `type: ['string', 'null']` fits `anyOf: [{ type: 'string' }, { type: 'null' }]` and `enum: ['a', 'b']` fits `anyOf: [{ const: 'a' }, { const: 'b' }]`; `S` unconstrained ⇒ ok unverified; then type sets (`integer ⊆ number`, `number` + integral `multipleOf` ⊆ `integer`), literal sets (literals are checked against the target's bounds and even its `pattern`), numeric intervals with integer refinement of exclusive bounds, `multipleOf` divisibility, string length bounds, `pattern`/`format` equal-or-absent-on-`T` (differing ⇒ unverified), arrays (`prefixItems` positional, `items`, bounds, `uniqueItems`), objects (`required`, `properties`, `additionalProperties`; an _undeclared_ open source into `additionalProperties: false` is unverified, a declared property or a typed `additionalProperties` schema is a failure). `not`, `if`/`then`/`else`, `patternProperties`, `dependentSchemas`, `contains`, unknown keywords, a handled keyword whose value has an unexpected shape (draft-4 boolean `exclusiveMinimum`/`exclusiveMaximum`, draft-7 array `items`, a string `minimum`, an unknown `type` name, … ⇒ `keyword '<name>' has an unexpected value`), unresolvable/external/recursive `$ref`s, cross products over 64 alternatives and nesting deeper than 32 ⇒ `verified: false`. A failure on a decidable keyword always wins over an unverified one.

`projectSchema(S, pointer)` walks `properties` / `prefixItems` / `items` / `additionalProperties` (union over `anyOf`/`oneOf` alternatives that admit the path; recursive `$ref`s are followed because a pointer is finite). A property missing under `additionalProperties: false`, an index past a closed tuple or `maxItems`, or a step into a scalar is `{ ok: false, reason }` (`E_REF_PATH_INVALID`); a step through an unconstrained level, `additionalProperties: true` or a level with undecidable keywords keeps `typed: false` (`W_REF_PATH_UNTYPED`). When the projected sub-schema still uses local `$ref`s the root's `$defs`/`definitions` are attached (refs into other parts of the root are redirected to a `$defs/__root__` copy) so the result is self-contained. A walk whose pointer steps _through_ a level that admits `null` (`type: ['object', 'null']`, an `anyOf` with a `null` alternative) is admitted and reports `nullable: true`, so the compiler can advise a binding `default` (a `null` in the last position is a value, not an absence, and is visible in `schema` instead). `projectValue(value, pointer)` is the runtime twin: missing properties, indexes past the end and a `null` level along the way yield `value: undefined` (the binding `default` applies); descending into a string, number or boolean, or a non-index token on an array, is `ok: false` with the same reason wording. `createEvalScope` resolves reference paths with `projectValue`, so the playground, the SDK harness and the worker agree: absence is `null`, a structure violation is an `ExpressionError` (`TYPE`). `src/schema/agreement.test.ts` runs all three walkers over one table of (schema, value, pointer) triples.

## Template filters

A hole is `{{ expr }}` or `{{ expr | filter }}`. The eight `TemplateFilter` members
(`TemplateFilterSchema`, CONTRACTS.ts §2) are:

| Filter                           | Accepts  | Renders                                                                |
| -------------------------------- | -------- | ---------------------------------------------------------------------- |
| `string` (a hole with no filter) | scalars  | text; `null` → `''`; a container falls back to compact JSON at runtime |
| `json`                           | anything | compact JSON                                                           |
| `json_pretty`                    | anything | two-space-indented JSON                                                |
| `join_lines`                     | arrays   | items as text joined with `\n` (a non-array is a runtime `TYPE` error) |
| `join_comma`                     | arrays   | items as text joined with `, `                                         |
| `upper` / `lower` / `trim`       | scalars  | text (as `string`) upper-cased / lower-cased / trimmed                 |

`TEMPLATE_HOLE_FILTERS` (the seven a hole may name) is derived from
`TemplateFilterSchema.options` minus `string` (RFC-0009), so the scanner accepts every
member the contract declares. `filterAcceptsContainers(filter)` is true only for `json`,
`json_pretty`, `join_lines` and `join_comma`: a hole whose static type is object/array with
any other filter (or none) is `E_TEMPLATE_OBJECT_COERCION` at compile time.

## `definitionHash`

`definitionHash(def: unknown)` (RFC-0008) first parses `def` with `WorkflowDefinitionSchema`
— idempotent on already parsed input, a `ZodError` on anything else — then hashes the
canonical definition with SHA-256: `layout` and `metadata` removed, `nodes` and `edges`
sorted by id, `undefined` properties dropped, keys sorted at every depth. A raw JSON
document and its parsed form therefore hash identically, and every resolved schema default
(`execution.concurrency`, `description: ''`, trigger defaults, …) is part of the hash whether
the author wrote it or not. Key order, node/edge order, layout and metadata never change the
hash; every other edit does. Duplicate node or edge ids have no canonical order and throw a
`TypeError` (`canonicalDefinition` too).

Because defaults are in the hash, changing a default in `src/policy.ts` / `src/definition.ts`
/ `src/nodes.ts` changes the hash of every stored definition that omitted it: that is a
hash-changing release (`docs/design/VERSIONS.md`, "Hash-changing releases").
`src/fixtures-roundtrip.test.ts` pins the hash of each of the four golden fixtures as a
constant (`GOLDEN_HASHES`) and checks raw ≡ parsed ≡ re-parsed for each, so such a change
shows up as a reviewed diff of those constants.

## Fixtures

`fixtures/` is documentation you can run:

| Path                                                                | Contents                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures/example-support-reply.json`                               | ARCHITECTURE.md §2.9 verbatim (the acceptance-test workflow)                                                                                                                                                                                                                                                                                                                                                           |
| `fixtures/{support-triage,github-issue-triage,research-agent}.json` | the §11 demo outlines expanded into complete definitions, using first-slice nodes only (demo 2 finds similar issues with the GitHub MCP `search_issues` tool); workspace resources are sentinels (`"serverId": "$template.mcp.github"`), never uuids                                                                                                                                                                   |
| `fixtures/templates/<template>.resources.json`                      | the `requiredResources` block of each template (`{ mcpServers: [{ key, description, requiredTools }], knowledgeSources: [{ key, description }] }`); every sentinel key is declared there and every declaration is used                                                                                                                                                                                                 |
| `fixtures/variants/github-issue-triage.retrieval.json`              | the knowledge-slice variant of demo 2 (`flowaid.retrieval.retriever` over `$template.knowledge.github_issues`); parsed by the suite, excluded from first-slice compile tests                                                                                                                                                                                                                                           |
| `fixtures/events/<TYPE>.json`                                       | exactly one example per `RunEvent` type, in story order of one run of the example workflow (`seq` increases; ephemeral events carry `seq: 0`)                                                                                                                                                                                                                                                                          |
| `fixtures/manifests/<type>.json`                                    | hand-written `NodeManifest`s for `flowaid.decision.choice` (port rule `controlPortsFromConfig{/options}`), `flowaid.tools.http` (`byConfig` idempotency), `flowaid.decision.confidence_gate` (`pass`/`review`/`fail`, optional `reviewBand`, `outcome` output; its `configSchema.description` is the ARCHITECTURE.md §6.3 gate semantics verbatim, checked by the suite) and the two other node types the example uses |
| `fixtures/plans/example-support-reply.plan.json`                    | a minimal hand-written `ExecutionPlan` for the example workflow: guards of §2.9, resolved policies, compiled templates/expressions, embedded manifests, `planHash` = `sha256Json(plan without planHash)`                                                                                                                                                                                                               |

Adding an event type without an example, or a fixture that stops parsing, fails the suite.

## Changing a diagnostic code or an event type

`DiagnosticCodeSchema` (§12) and `RunEventSchema` (§11) are closed enums in
`docs/design/CONTRACTS.ts`. CONTRACTS.ts is frozen at the end of Wave 0
(`IMPLEMENTATION_PLAN.md`); every later change goes through an RFC:

1. Write `docs/rfcs/NNNN-<slug>.md`: the new code or event, who emits it, what consumes it
   (compiler pass, runtime reducer, projections, SSE clients, UI), and the migration for
   stored rows (`run_events` are append-only, so a removed event type must stay parseable
   or be migrated).
2. Edit `docs/design/CONTRACTS.ts` first, then mirror it here:
   - diagnostic code → `src/diagnostics.ts` (`DiagnosticCodeSchema`, same position and
     comment group), plus the pass that emits it in `@flowaid/workflow-compiler` and a
     fixture-per-diagnostic there;
   - event type → `src/events.ts` (`RunEventSchema` member with `EventBase` or
     `NodeEventBase`, `TERMINAL_EVENT_TYPES` if it ends a run), a
     `fixtures/events/<TYPE>.json` example, the runtime reducer/projection in
     `@flowaid/workflow-runtime` and the database projection in `@flowaid/database`.
3. Bump the version of `@flowaid/workflow-core` (minor for additions, major for renames or
   removals) and update `src/contracts.test.ts` counts. `src/contracts-parity.test.ts`
   fails until CONTRACTS.ts and the package agree, and `src/events.test.ts` fails until the
   example exists.

## Scripts

`pnpm --filter @flowaid/workflow-core typecheck | lint | test | test:tz | build` (`build`
emits `dist/` from `tsconfig.build.json`; tests and fixtures are excluded from the build;
`test` runs both Vitest projects, `test:tz` only the `TZ=America/New_York` one).
