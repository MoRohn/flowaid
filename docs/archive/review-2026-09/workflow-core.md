# Review lens: workflow-core correctness and quality

Scope: `packages/workflow-core` against `docs/design/CONTRACTS.ts`, `ARCHITECTURE.md` §2.3 and §4.5.
Method: read every `src/` module, ran the suite (22 files, 1856 tests, all green), then probed the
expression language, template scanner, subset checker, projector and hash with throw-away tsx scripts
(`pnpm --filter @flowaid/workflow-core exec tsx <script>`). Every finding below has a reproducible input.

Not reported (checked and fine): README counts (`RunEventSchema` 50 types, `DiagnosticCodeSchema` 94 codes)
match the code; contracts parity test really reads CONTRACTS.ts; `parseRef`/`formatRef` round-trip on every
edge token tried (`''`, `~`, `x/y`, `it's`, `01`, `\u0000`); printer round-trips; `isSubschema` is reflexive
and property-tested with fast-check (subset.test.ts:396-470); precedence, ternary associativity, `1--1`,
`!true == false`, escapes, `in`/`matches`, lambda scoping/shadowing and every error reason behaved per spec.

## Findings

### 1. `isSubschema`: a flat source with several types/literals never fits an `anyOf`/`oneOf` target (HIGH)

`subset.ts:119-145` requires the _whole_ source to be a subset of _one_ alternative. A source whose type set
or enum spans two alternatives fails outright, and the compiler turns that into a blocking `E_TYPE_MISMATCH`.

```
isSubschema({ type: ['string','null'] }, { anyOf: [{type:'string'},{type:'null'}] })
  → { ok:false, reason:"no alternative of the target accepts the source (type null is not accepted…)" }
isSubschema({ type:'string', nullable:true }, { anyOf:[{type:'string'},{type:'null'}] })   → ok:false
isSubschema({ enum:['a','b'] }, { anyOf:[{const:'a'},{const:'b'}] })                        → ok:false
isSubschema({ type:['integer','string'] }, { oneOf:[{type:'number'},{type:'string'}] })     → ok:false
```

These are exactly the shapes Zod 4 emits: `z.string().nullable()` → `type: ['string','null']`,
`z.union([z.literal('a'), z.literal('b')])` → `anyOf` of consts, `z.enum([...])` → `enum`. A nullable output
port wired into a `z.union([z.string(), z.null()])` input cannot be published.

Fix: in `checkNormal`, when `t.disjunctions.length > 0` and `s` is flat, slice `s` by effective type
(and, when `s.literals !== null`, by literal) and require every slice ⊆ some alternative (for `oneOf`, each
slice must also be disjoint from the other alternatives). Add table rows + a fast-check property
`S ⊆ anyOf[S restricted to t1, S restricted to t2]` for every generated multi-type S.

### 2. Typer: member/index access on `X | null` is a hard contradiction (HIGH)

`typer.ts:377-399, 416-439`. Optional properties, `first`/`last`, `arr[i]`, `sort(...)[0]` all yield
`T | null`; a member access on that union pushes a `type` issue for the `null` member, which the compiler maps
to `E_EXPR_TYPE` (blocking):

```
env: n.items = array<{name: string (required), tags?: array<string>}>
first(n.items).name                  → issue type@"": cannot read property 'name' of null
sort(n.items, x => x.name)[0].name   → same
map(n.items, x => x.tags[0])         → issue type@/args/1/body: cannot index null with a number
```

The runtime rule "member of null is an error" is a runtime failure like division by zero (the typer does not
flag `x / y` for possibly-zero `y`). Fix: in `inferMember`, `indexResult` and `inferMemberByDynamicKey`,
when the receiver is a union that has at least one container member, skip `null` members (result gets
`| null`) and only report a contradiction when _no_ member supports the access. Add typer rows for the three
expressions above.

### 3. The package is not loadable in a browser: `sha256Json` pulls `node:crypto` at import time (HIGH)

`definition.ts:6` imports `sha256Json` from `@flowaid/shared`, whose `index.ts` re-exports `hash.ts`, which
does `import { createHash } from "node:crypto"` at module load. `boundaries.json` marks workflow-core
`browserSafe: true`, `package.json` says "Browser-safe", ARCHITECTURE runs the compiler in a Web Worker.
The README admits it ("a WebCrypto path in shared is required"), but no test catches it.

Fix: implement a synchronous pure-TS SHA-256 in `shared/src/hash.ts` (≈60 lines over `Uint8Array` +
`TextEncoder`; WebCrypto is async and `definitionHash` is sync per contract) and delete the `node:` import;
add a bundle smoke test (`esbuild --bundle --platform=browser packages/workflow-core/src/index.ts` in
`scripts/`, failing on any `node:` specifier) so the boundary is enforced transitively, not per package.

### 4. `matches` / `regex_test` / `regex_match` are unbounded (ReDoS) and recompiled per call (HIGH)

`evaluator.ts:179-191` compiles `new RegExp(pattern)` on every invocation and never bounds it. The
"total and bounded" guarantee (ARCHITECTURE §2.3) does not hold: one AST step can run for minutes.

```
n.p = 'a'.repeat(26) + '!';   n.p matches "^(a+)+$"   → 300 ms   (20 a's: 35 ms, 24: 80 ms; ×2 per char)
```

A hung worker loses its lease, the run is recovered by another worker and re-runs the same expression.
Fix: (a) reject patterns with nested/adjacent unbounded quantifiers on a repeatable group (the `safe-regex`
star-height > 1 check) at parse time when the pattern is a literal (`E_EXPR_SYNTAX`) and at runtime
(`INVALID_REGEX`); (b) cap pattern length (1 KiB) and subject length (64 KiB) with `INVALID_ARGUMENT`;
(c) memoise compiled regexes per `Evaluator` in a `Map<string, RegExp>` keyed by `pattern\0flags` (50×
`filter(2000, x => x.name matches …)` costs 30 ms vs 20 ms for `starts_with`).

### 5. `format_date` output depends on the worker's time zone (HIGH)

`evaluator.ts:212-216` uses `new Date(string)`. ISO strings without an offset are parsed as _local_ time and
non-ISO strings are implementation-defined:

```
format_date("2024-01-02T00:00", "HH")   → "05"  (TZ=America/New_York)   "00"  (TZ=UTC)
format_date("1/2/2024")                 → "2024-01-02T05:00:00.000Z"    vs "…T00:00:00.000Z"
```

Runs are meant to be replayable and workers are fungible. Fix: accept only epoch milliseconds, `YYYY-MM-DD`
(UTC), or RFC 3339 with `Z`/offset (regex-gated), else `INVALID_DATE`; run the evaluator suite under two
`TZ` values in CI (vitest `env` or a second `test:tz` script).

### 6. Parser, typer and evaluator disagree on depth (MEDIUM)

The parser's depth counter (`parser.ts:88-95`) only counts parenthesised/call/unary/lambda nesting; a
left-associative chain nests the AST one level per operator without being counted. The typer
(`typer.ts:312`) and evaluator (`evaluator.ts:268`) count AST height.

```
'1 + 1 + … + 1' (101 terms): parseExpression → ok
  inferExprType → 2× "expression nested deeper than 100 levels" + 99× "operand of '+' has unknown type"
  evaluateExpression → DEPTH_LIMIT
```

Fix: track AST height in the parser (increment in the `while` loops of `parseOr/And/Add/Mul` and in
`parsePostfix`), reject with one `E_EXPR_SYNTAX`; make the typer emit a single issue and stop cascading
`untyped` warnings after a depth failure.

### 7. `1e999` is a valid literal that evaluates to `Infinity` (MEDIUM)

`lexer.ts:88-105` accepts any JSON-shaped number; `parser.ts:200` does `Number(token.text)`.

```
parseExpression('1e999')   → ok, literal Infinity        ExprAstSchema.safeParse(ast).success → false
1e999 > 5 → true          json(1e999) → "null"          printAst → "Infinity" (does not re-parse)
```

So a plan containing it fails `ExprAstSchema` after compile succeeded. Fix: `scanNumber` rejects when
`!Number.isFinite(Number(text))` ("number literal out of range"); evaluator `literal` case applies
`finite()` for hand-built ASTs; add lexer/parser/printer rows.

### 8. Deeply nested _values_ escape as raw `RangeError` (MEDIUM)

`SizeEstimator.measure` (evaluator.ts:116-134), `deepEqual` and `JSON.stringify` recurse over values.
With a port value nested 20 000 deep:

```
n.p → RAW RangeError: Maximum call stack size exceeded     (also n.p == n.p, json(n.p), len(n.p))
```

The header comment promises "Nothing escapes as a raw TypeError"; the existing "hostile depth" test only
covers AST depth. Fix: iterative `measure` with an explicit stack that also enforces a value-depth cap
(e.g. 512 → `DEPTH_LIMIT`), and a `try/catch` of `RangeError` around `deepEqual`/`JSON.stringify` that
rethrows `DEPTH_LIMIT`. Add a test with a 20 000-deep port value.

### 9. 10 000 AST steps makes `map`/`filter` over ≥ 5 000 items impossible while 1-step builtins are free (MEDIUM)

Every AST node visited costs one step, so a lambda body `x.id` costs 2 per element:

```
map(n.p, x => x.id)   4000 items → ok     5000 items → STEP_LIMIT
```

Meanwhile `sort(arr)`, `join(arr)`, `x in arr`, `contains`, `sum`, `split` over a 1 MiB array cost one step.
Fix: charge array builtins per element (sort: n·log n, others: n), keep per-node charging inside lambdas,
raise `MAX_EVAL_STEPS` to 1 000 000 (≈ tens of ms of work) and update ARCHITECTURE §2.3 / CONTRACTS.ts:316
through the RFC path. The bound then measures real work instead of AST shape.

### 10. Template filter set disagrees with the frozen contract (MEDIUM)

`CONTRACTS.ts:232` and `bindings.ts:29` define `TemplateFilterSchema` with `upper | lower | trim`;
`applyTemplateFilter` (template.ts:99-118) implements them; the scanner (`TEMPLATE_HOLE_FILTERS`,
template.ts:32) rejects them:

```
parseTemplate('a {{ n.p.s | upper }} b')  → error@13 "unknown template filter (expected json, json_pretty, join_lines, join_comma)"
```

Fix: derive `TEMPLATE_HOLE_FILTERS` from `TemplateFilterSchema.options` minus `'string'`; add the three to the
ARCHITECTURE §2.3 grammar line and the template tests; typer/compiler treat them as scalar-coercing
(`E_TEMPLATE_OBJECT_COERCION` still applies for containers).

### 11. Three JSON-pointer walkers with three semantics; compile-time and runtime disagree on `null` (MEDIUM)

- `createEvalScope` (scope.ts:54-56) uses `getPointer` → a path into a scalar or `null` yields `null`.
- `projectValue` (project.ts:249-267), the runtime twin the runtime actually uses, yields `ok:false`.
- `projectSchema({ type:['object','null'], properties:{a:…} }, '/a')` → `ok:true, typed:true`.

```
n.p = { a: 'str' }:  n.p.a.b → null (scope)      projectValue({a:'str'}, '/a/b') → ok:false
projectValue(null, '/a') → ok:false               projectSchema(nullable object, '/a') → ok, typed
```

So the playground/tests/SDK harness show `null` where the worker fails, and a nullable producer (zod
`.nullable()`) that returns `null` fails at runtime on every reference the compiler accepted with no warning.
Fix: `createEvalScope.project` uses `projectValue` (`ok:false` → `ExpressionError` TYPE; `undefined` → `null`);
`projectValue` treats a `null` level like an absent property (`value: undefined`, so the binding `default`
applies) since `projectSchema` admits it; `projectSchema` additionally reports `nullable: true` when any
level on the path admitted `null`, so the compiler can emit `W_REF_PATH_UNTYPED`-class advice to add a
default. Add an agreement test that runs both walkers over a table of (schema, value, pointer).

### 12. `definitionHash` depends on Zod defaults and on input parsing state (MEDIUM)

`canonicalDefinition` hashes whatever object it is given: the raw fixture and its parsed form hash differently
(`0e5ca803…` vs `d86f4019…`), `execution` is hashed with every `prefault`/`default` expanded
(`concurrency: 8` explicit ≡ omitted), so changing any default in `policy.ts` silently changes the hash of every
stored definition that omitted it; duplicate node ids hash order-dependently (stable sort on equal ids).
Fix: `definitionHash` parses through `WorkflowDefinitionSchema` first (idempotent) and documents that resolved
defaults are part of the hash; pin the four fixture hashes as golden constants in `fixtures-roundtrip.test.ts`
so a default change is a reviewed diff + `VERSIONS.md` entry; throw on duplicate node/edge ids.

### 13. Typer accepts provably-never-equal comparisons (MEDIUM)

`typer.ts:453-455`: `==`/`!=` never check operands. `n.val == 1` when `n.val` is `enum ['billing','other']`,
or `len(x) == "3"`, type-check clean and are always `false` at runtime — the most common author mistake with
TypeSafe choice keys. Fix: when both sides are typed and their kind sets are disjoint (after `integer ⊆ number`),
emit a `type` issue "'==' can never be true: string vs integer"; keep `unknown` silent.

### 14. Parser accepts duplicate object-literal keys; `has(arr, "0")` vs `arr["0"]` (LOW)

`{a: 1, a: 2}` → `{"a":2}` silently (parser.ts:238-253); the typer types it as the last entry. Reject duplicate
keys with `E_EXPR_SYNTAX`. `arr["0"]` reads index 0 (evaluator.ts:339) but `has(arr, "0")` is a TYPE error
(evaluator.ts:500); accept canonical integer strings in `has` for arrays.

### 15. `isSubschema` silently ignores ill-typed values of handled keywords (LOW)

`ownConstraints` (normalize.ts:415-434) type-checks each numeric/string keyword and drops mismatches:

```
isSubschema({ type:'number', minimum:0 }, { type:'number', minimum:0, exclusiveMinimum:true /* draft-4 */ })
  → { ok:true, verified:true }     // T actually requires > 0
```

`JsonSchemaSchema` would reject the boolean, but `isSubschema` takes raw `JsonSchema`. Fix: a handled keyword
whose value has the wrong JS type is pushed to `unverified` (`keyword 'exclusiveMinimum' has unexpected value`).

### 16. Small quality/perf items (LOW)

- `RUN_FIELDS`/`SCOPE_FIELDS` are duplicated in `bindings.ts:141-142`, `parser.ts:31-34`, `scope.ts:18-20`
  and the `RefSchema` enums; `RESERVED_IDS` (ids.ts:43-48) duplicates `EXPRESSION_FUNCTION_NAMES ∪
EXPRESSION_KEYWORDS` (a test asserts equality instead of deriving). Derive from one source.
- `isExpressionFunction` is `Array.includes` over 37 names and runs on every identifier in the parser and every
  call in the evaluator; use a `Set` (or `Object.hasOwn(FUNCTION_SIGNATURES, name)`).
- `len(str)` allocates `Array.from(str)`; count code points with a loop.
- Every `RESULT_TOO_LARGE` measurement also applies to _inputs_: `len(n.p)` with a 1.1 MiB port value throws
  `RESULT_TOO_LARGE` (evaluator.ts:283 measures the resolved ref). Exempt `ref` results (or use a separate,
  larger input cap) so large node outputs can at least be summarised.
- README: `src/expr/{…}` omits `printer.ts`, `refs.ts`, `scope.ts`; "formatRef is the exact inverse" should
  note `path: ''` is treated as absent; the "browser-safety rule" section contradicts `package.json`'s
  "Browser-safe" until #3 lands; the template section should list the eight filters once #10 lands.

### 17. Test-suite shape and gaps (LOW)

The 1856 tests are ~75 % table rows (`functions` 304, `typer` 273, `evaluator` 241, `subset` 226, `parser`
176, `events` 159). The rows are distinct inputs, not duplicated tables, and the property tests are real
(printer round-trip, subset reflexive/transitive). Missing, and each of the findings above adds one:
TZ-varying `format_date`; parser/typer/evaluator depth agreement; `parseRef ∘ formatRef` with _generated_
pointer tokens (the printer's arbitrary uses a fixed `PATH_TOKENS` list); `createEvalScope` vs `projectValue`
agreement; hostile _value_ depth; flat-S-into-`anyOf`-T; regex time bound; golden `definitionHash` constants;
a browser bundle smoke test.
