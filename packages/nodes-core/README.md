# @flowaid/nodes-core

The built-in node package (ARCHITECTURE.md §3, §6.3). Every node declares its idempotency,
capabilities, credential slots and port rules; `manifest.json` holds all manifests (regenerate with
`pnpm --filter @flowaid/nodes-core manifest`; a test fails when it is stale), and
`@flowaid/nodes-core/manifest` exports them as data without loading any executor.

| group     | nodes                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| decision  | `boolean`, `choice`, `score`, `batch`, `confidence_gate`, `router`, `consensus`, `validator`                |
| ai        | `generate` (streams deltas), `structured_generate` (native JSON Schema or validated fallback), `embeddings` |
| tools     | `http` (SafeFetch, credential auth, `Idempotency-Key` on keyed methods, binary bodies as artifacts)         |
| data      | `transform`, `template`, `json`, `schema_validate`, `merge`, `filter`, `map`, `split`, `extract`            |
| dev       | `log`, `assert`, `mock`, `metric`                                                                           |
| state     | `get`, `set` (run, session or workspace scope)                                                              |
| safety    | `guard`, `moderation`, `pii_detector`                                                                       |
| pageindex | `index` (waits durably for the build), `retrieve` (navigates section trees with choice decisions), `cite`   |

Decision nodes call `ctx.providers.decision(chain)`. When every hop fails and the chain ends in
`human`, the node suspends with a human task (`origin: decision_failover`) and, on resume, returns
the person's answer as a decision with provider `human` and confidence 1.

`confidence_gate` implements the §6.3 semantics once (`gateOutcome`): two-way (`pass`/`review`)
without `reviewBand`, three-way (`pass`/`review`/`fail`) with it. `consensus` asks 2–5 distinct
voters, mixes their distributions (confidence-weighted when asked), and reports
`agreement × mean confidence`; fewer than two, repeated or human voters fail with
`E_DECISION_CONFIG`.

`filter` and `map` take a FlowExpr evaluated per item with `$scope.item` and `$scope.index`.

PageIndex nodes (RFC-0022) read document indexes through `ctx.documents`. A node's `scope`
(knowledge sources and documents, at most 20 ids) is its allowlist: pinned `index_ids` outside it
are refused before any lookup, and what the host resolves is filtered through it again.
`retrieve` asks one TypeSafe choice per level of a document's outline and reads the chosen pages
(`@flowaid/pageindex` `retrieveEvidence`); `prompt_context` numbers the excerpts [E1]… as
delimited document text. `cite` checks each cited claim (a yes/no decision per claim, at most 20,
or a lexical test) and routes `sufficient`, `partial` or `insufficient`. `index` never outputs a
queued build: it suspends on the event `pageindex.index.<indexId>` and re-reads the index when it
arrives. With a `documents` scope, `flowaid.ai.agent` gets three read-only tools
(`document_outline`, `document_read_pages`, `document_search`) that run in the node over the same
allowlist and count against the agent's own limits.

`templates/` holds the three demos (support triage, GitHub issue triage, research agent), the
knowledge-base variant of the GitHub triage and three PageIndex templates (document Q&A, document
comparison, a document agent), each with a `*.resources.json` listing the MCP servers and
knowledge sources it needs; the compiler's test suite compiles them against `manifest.json`.
