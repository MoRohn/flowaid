# RFC-0003: FlowExpr evaluation budget, input cap and vetted regex literals

- Status: accepted (2026-09-23)
- Raised by: `wc-step-budget-shape`, `wc-quality-perf-small`, `wc-regex-unbounded`, `flowexpr-redos` (docs/review/workflow-core.md §4, §9, §16; docs/review/security.md §21)
- Implemented by: P0-12
- Affects: `CONTRACTS.ts` §3 (`evaluateExpression` bound comment), §12 (`DiagnosticCodeSchema`), `@flowaid/workflow-core` 0.1.0 → 0.2.0

## Motivation

`evaluateExpression` charged one step per AST node visited with a 10 000-step budget. A lambda body of two nodes therefore capped `map`/`filter` at ~5 000 elements while one-step built-ins (`sort`, `join`, `in`, `contains`, `sum`, `split`) ran unbounded over a 1 MiB array: the bound measured AST shape, not work. The 1 MiB result limit was also applied to _resolved references_, so `len(n.p)` on a 1.1 MiB port value failed with `RESULT_TOO_LARGE`. Separately, `matches`/`regex_test`/`regex_match` compiled any string — including run input — on every call with no vetting, so `(a+)+$` against 26 characters pinned a worker for seconds (workflow-core review §4, security review §21).

## Change

`CONTRACTS.ts` §3, the `evaluateExpression` comment:

```ts
/**
 * Total, bounded (RFC-0003): 1 000 000 steps — one per AST node visited, plus one per element
 * for the array built-ins (`sort` n·log₂n) — a 1 MiB result, an 8 MiB input (values read
 * through refs), value nesting ≤ 512; regex patterns are string literals vetted for linear
 * time. Throws ExpressionError.
 */
export declare function evaluateExpression(ast: ExprAst, scope: EvalScope): JsonValue;
```

`CONTRACTS.ts` §12, `DiagnosticCodeSchema` (additive, two new members in the expressions group):

```ts
'E_EXPR_SYNTAX', 'E_EXPR_TYPE', 'W_EXPR_UNTYPED', 'E_EXPR_NOT_BOOLEAN', 'E_EXPR_REGEX_DYNAMIC', 'E_EXPR_REGEX_UNSAFE',
```

Semantics (ARCHITECTURE.md §2.3): `MAX_EVAL_STEPS = 1 000 000`; array built-ins charge per element through `charge(n)` (`sort` ⌈n·log₂n⌉; `join`, `in`, `contains`, `sum`, `avg`, `min`, `max`, `keys`, `values`, `split`, `len` n) before doing the work; lambda bodies keep per-node charging; `bounded()` no longer measures resolved refs — they are measured against a separate `MAX_EVAL_INPUT_BYTES = 8 MiB` (`INPUT_TOO_LARGE`, a new `ExpressionErrorReason`); values nested deeper than 512 levels are `DEPTH_LIMIT`. Regex pattern and flags operands must be string literals (`E_EXPR_REGEX_DYNAMIC` / `INVALID_ARGUMENT`), vetted with `recheck` 4.5.0 (`E_EXPR_REGEX_UNSAFE` / `INVALID_REGEX`), pattern ≤ 1 024 and subject ≤ 65 536 characters (`INVALID_ARGUMENT`). The change is additive for the contract's signatures: `evaluateExpression(ast, scope)` keeps its arity; the parity test now pins 96 diagnostic codes.

## Compatibility

- Stored data: no table holds a step count or a diagnostic list keyed by this enum yet (`compile_results`/plan diagnostics are produced fresh on each compile). Existing plans evaluate under the larger budget; an expression that previously failed with `STEP_LIMIT` may now succeed, and `len`/`sum` over very large arrays (≥ 1 M elements) now fail where they previously succeeded — both are intended.
- Wire: the two diagnostic codes appear in `CompileResult.diagnostics` and the OpenAPI enum; clients that switch on codes should treat unknown `E_` codes as errors (they already must, per API.md).
- Design docs: ARCHITECTURE.md §2.3 (budget, regex rules, date forms) updated by P0-12; the compiler pass that emits the codes is P0-15's.

## Tests

`packages/workflow-core/src/expr/evaluator.test.ts` (exact per-node budget boundary, per-element charging incl. `sort` over 2 000 000 items → `STEP_LIMIT` before sorting, `map` over 100 000 items, 2 MiB input through `len`, 8 MiB → `INPUT_TOO_LARGE`, 20 000-deep values → `DEPTH_LIMIT` for ref/`==`/`json`/`len`/`parse_json`, `(a+)+$` rejected in < 50 ms, pattern/subject caps, single compile per evaluation via an engine spy); `typer.test.ts` (`regex_dynamic`/`regex_unsafe` issues); `functions.test.ts`; `contracts.test.ts` / `contracts-parity.test.ts` (96 codes, verbatim enum).

## Alternatives considered

- Keeping one budget and raising it without per-element charging: `sort`/`join` over multi-megabyte arrays would still cost one step, so the bound would still not measure work.
- Measuring refs against a bigger _result_ cap instead of a separate input cap: a bare `n.p` and `[n.p]` would then be indistinguishable; the input cap keeps "values the expression builds" at 1 MiB (templates and bindings depend on it) while letting expressions read larger inputs.
- Allowing polynomial-time (degree 2) patterns because the subject is capped: measured at 1.5 s for `\d+-\d+` against 64 KiB of digits on a 2026 laptop — too slow for an orchestrator's worker; authors anchor their patterns instead.
- A hand-written star-height check instead of `recheck`: misses polynomial cases (`\d+-\d+`) and overlapping alternations; `recheck`'s automaton checker is deterministic and runs in the browser bundle (pure-JS build).
