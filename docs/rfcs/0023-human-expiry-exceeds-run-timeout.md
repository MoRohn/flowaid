# RFC-0023: `W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT`

- Status: accepted (2026-10-05)
- Raised by: the October 2026 product audit, finding R4 (roadmap item B-11 in
  `docs/project/PRODUCT_ROADMAP_2026-10.md`)
- Implemented by: B-11
- Affects: `CONTRACTS.ts` §12 `DiagnosticCode` (one code added); `@flowaid/workflow-core` 0.9.x →
  the next minor release (the `@flowaid/*` packages share one version)

## Motivation

A run's time limit (`execution.timeoutMs`, default 15 minutes) counts the time the run spends
waiting for a person. A human step whose `expiresInMs` is longer than that limit, or that has no
expiry at all, is cancelled when the run times out, while its card still promises the full expiry.
The shipped support-triage template had a 3-minute run limit and a 2-hour approval; a flow with a
20-second limit and a 2-hour approval compiled with zero diagnostics, and its task was cancelled at
20 seconds. Two of four tasks in one real workspace ended this way. Nothing in the builder said so.

No existing code fits: `E_HUMAN_CONFIG` is an error about the step's own settings (and this is not
an error: the run works if the person answers in time), `W_LOOSE_BOUNDS` is about loop bounds.

## Change

`DiagnosticCodeSchema` gains `W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT` (severity `warning`), placed
after `E_HUMAN_CONFIG`:

```ts
  // decisions, human, agent, policy
  'E_DECISION_CONFIG', 'E_HUMAN_CONFIG', 'W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT', 'E_AGENT_UNBOUNDED', …
```

The compiler's structure pass emits it for a `human` node when `expiresInMs` is greater than
`execution.timeoutMs` (location: the node and `/nodes/<i>/expiresInMs`) or when `expiresInMs` is
unset (location: the node). The message names both durations and the two ways out: raise the run's
time limit, or shorten the expiry. Additive; the parity test pins 98 codes.

## Compatibility

- Stored data: none. Diagnostics are computed; stored plans and definitions are unchanged.
- Wire: the code appears in compile responses and the Problems panel; a consumer that switches
  exhaustively over `DiagnosticCode` gains one case (a warning).
- Design docs: `ARCHITECTURE.md` §4 (structure pass) lists the code.
- Templates: support-triage's run limit becomes 3 hours (its approval expires after 2 hours).

## Tests

- `packages/workflow-compiler/src/humanExpiry.test.ts`: the warning for a longer expiry and for no
  expiry, none when the run outlasts the step, and none for any shipped template with a human step.
- `codes.test.ts` covers the code once (`fixtures/diagnostics/codes.json`).
- `contracts.test.ts` and `contracts-parity.test.ts` keep `CONTRACTS.ts` and the package in step.

## Alternatives considered

- Stop counting waiting time toward the run limit. That changes the runtime's timeout semantics
  for every run and the meaning of `execution.timeoutMs` (ARCHITECTURE.md); the warning makes the
  current behaviour visible first.
- Reuse `E_HUMAN_CONFIG` as a warning. Codes carry their severity in their prefix, and the
  Problems panel and the publish gate treat `E_` codes as blockers.
