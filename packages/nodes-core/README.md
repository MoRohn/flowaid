# @flowaid/nodes-core

The built-in node package (ARCHITECTURE.md §3, §6.3). Every node declares its idempotency,
capabilities, credential slots and port rules; `manifest.json` holds all manifests (regenerate with
`pnpm --filter @flowaid/nodes-core manifest`; a test fails when it is stale), and
`@flowaid/nodes-core/manifest` exports them as data without loading any executor.

| group    | nodes                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| decision | `boolean`, `choice`, `score`, `batch`, `confidence_gate`, `router`, `consensus`, `validator`                |
| ai       | `generate` (streams deltas), `structured_generate` (native JSON Schema or validated fallback), `embeddings` |
| tools    | `http` (SafeFetch, credential auth, `Idempotency-Key` on keyed methods, binary bodies as artifacts)         |
| data     | `transform`, `template`, `json`, `schema_validate`, `merge`, `filter`, `map`, `split`, `extract`            |
| dev      | `log`, `assert`, `mock`, `metric`                                                                           |
| state    | `get`, `set` (run, session or workspace scope)                                                              |
| safety   | `guard`, `moderation`, `pii_detector`                                                                       |

Decision nodes call `ctx.providers.decision(chain)`. When every hop fails and the chain ends in
`human`, the node suspends with a human task (`origin: decision_failover`) and, on resume, returns
the person's answer as a decision with provider `human` and confidence 1.

`confidence_gate` implements the §6.3 semantics once (`gateOutcome`): two-way (`pass`/`review`)
without `reviewBand`, three-way (`pass`/`review`/`fail`) with it. `consensus` asks 2–5 distinct
voters, mixes their distributions (confidence-weighted when asked), and reports
`agreement × mean confidence`; fewer than two, repeated or human voters fail with
`E_DECISION_CONFIG`.

`filter` and `map` take a FlowExpr evaluated per item with `$scope.item` and `$scope.index`.

`templates/` holds the three demos (support triage, GitHub issue triage, research agent) with a
`*.resources.json` listing the MCP servers each needs; the compiler's test suite compiles them
against `manifest.json`.
