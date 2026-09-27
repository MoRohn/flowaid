# @flowaid/evaluation

Evaluation of workflows against case sets (ARCHITECTURE.md §10.4). The API routes and the worker's
`evaluation.run` job only wire this package in.

- **`ExpectationSchema`.** Output matchers (`equals`, `contains`, `regex` with the vetted-pattern
  check, `schema`, `range`, and `judge`, a boolean decision over `{ input, expected?, actual }`
  through any `DecisionProvider`), per-node decision expectations (`value`, `valueIn`, `range`,
  `minConfidence`; score decisions also match their level or label), fired branch ports,
  required/forbidden nodes and tools, status, outcome, latency and cost ceilings, human
  auto-responses and `humanExpected`.
- **`runEvaluation`.** One run per case through an injected `RunLauncher` (origin `evaluation`,
  labels `{ evaluationRunId, caseId }`, human nodes auto-resolved, default approve), with bounded
  concurrency and cancellation. Each case is scored as it finishes (`onResult` writes
  `evaluation_results`), and a launch failure fails its case, never the evaluation.
- **`summarize`.** Pass and completion rates, per-node decision accuracy and calibration (ECE over
  ten equal-width bins), branch correctness, schema and tool success, human review rate,
  p50/p95/p99 latency, and cost.
- **`compare` / `reportToMarkdown`.** Deltas, per-case and per-check flips (including changed
  decisions), the publish-gate verdict (`minPassRate`) and `W_REGRESSION` warnings (pass rate
  −2 pt, p95 +30 %, cost +20 %), rendered as Markdown for the publish dialog, CLI and PR comments.

The end-to-end run of the support-triage template through `runLocally` lives with the worker's
evaluation job (P3-03), the first package allowed to import the runtime, the core nodes and this
package together.
