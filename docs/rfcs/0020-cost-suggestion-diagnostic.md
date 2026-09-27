# RFC-0020: `I_COST_SUGGESTION` diagnostics from the cost optimizer

- Status: accepted (2026-09-27)
- Raised by: P6-02 (`@flowaid/advisor`), whose suggestions render as quick-fixes in the builder's Problems panel
- Implemented by: P6-02
- Affects: `CONTRACTS.ts` §12 `DiagnosticCode` (one code added); `@flowaid/workflow-core` 0.3.3 → 0.3.4

## Motivation

The cost optimizer (`POST /v1/workflows/:id/optimize`) finds changes that make a workflow
cheaper — a cheaper model of the same provider, batching independent decisions over one state,
memoising a repeatable node, tightening loop bounds to what runs actually use. Each comes with
an RFC 6902 fix against the definition. The Problems panel already renders diagnostics with a
`fix`, so the natural carrier is a diagnostic, but `DiagnosticCode` is a closed enum and no code
fits: `W_COST_ESTIMATE` means "no cost bound", not "here is a saving".

## Change

- `DiagnosticCode` gains `I_COST_SUGGESTION` (severity `info`). The compiler never emits it; the
  advisor does, with `location.nodeId` set to the first node the suggestion concerns and, when
  the change can be made automatically, `fix: { title, patch }`.
- The message states the change and its estimated saving per run.

## Compatibility

Additive. Stored plans and definitions are unaffected; a consumer that switches exhaustively over
`DiagnosticCode` gains one case (an info).

## Tests

- `contracts-parity.test.ts` keeps `CONTRACTS.ts` and `@flowaid/workflow-core` in step.
- `@flowaid/advisor` `suggestions.test.ts` builds the diagnostics and checks they parse against
  `DiagnosticSchema`.
