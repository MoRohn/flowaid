# RFC-0018: FlowExpr gains `concat`

- Status: accepted (2026-09-23)
- Raised by: the workflow compiler (P1-01) rejecting the research-agent demo's `$scope.carry.evidence + filter(…)` with `E_EXPR_TYPE`
- Implemented by: P1-01
- Affects: `CONTRACTS.ts` §2 `RESERVED_IDS` (one added name); ARCHITECTURE.md §2.3 (function list); `@flowaid/workflow-core` 0.3.0 → 0.3.1

## Motivation

A loop that accumulates results across iterations needs to append to an array held in `$scope.carry`. FlowExpr's `+` is defined for two numbers or two strings only (the evaluator raises `TYPE` otherwise), and the closed function set had no way to join arrays. The research-agent demo wrote `$scope.carry.evidence + filter(…)`, which the compiler correctly rejects and the runtime would fail on. There was no correct way to write it.

## Change

- New built-in `concat(array, …)`: one or more arguments, every argument an array; returns a new array holding the items of each argument in order. Non-array arguments are a runtime `TYPE` error and a compile-time `E_EXPR_TYPE`.
- Budget: charges one evaluation step per item copied, like the other array built-ins (RFC-0003).
- Typer: the result is `array<union of the arguments' item types>`.
- `concat` joins `EXPRESSION_FUNCTION_NAMES` and therefore `RESERVED_IDS` (`CONTRACTS.ts` §2).
- `+` keeps its meaning; array concatenation is only ever spelled `concat`.

## Compatibility

- Additive for expressions: nothing that compiled before changes meaning.
- A node whose id is `concat` is now `E_RESERVED_ID`. No shipped fixture, template or document uses that id.
- Stored plans are unaffected.

## Tests

- `expr/functions.test.ts`: evaluation rows (two and three arrays, empty arrays, nested arrays kept as items, a non-array argument failing with `TYPE`, step charging), typer rows (item union, `E_EXPR_TYPE` on a non-array argument).
- `contracts.test.ts`: the function count moves from 37 to 38.
