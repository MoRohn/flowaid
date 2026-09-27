# @flowaid/advisor

Workflow advice (UPGRADE_PLAN P6-02). Pure functions: the API passes in run statistics, the model
catalog, a generation call and a decision call, so it alone decides which providers and
credentials are used.

- **`optimize(input) → Suggestion[]`** — the cost optimizer. From a definition, its plan and 30
  days of per-node statistics it proposes `cheaper_model` (a same-provider model that costs at
  most 70 % as much for the node's token mix), `batch_decisions` (independent TypeSafe decisions
  over one state, rewritten into one `flowaid.decision.batch` node), `cache_safe_node`
  (idempotent nodes whose inputs repeat) and `tighten_bounds` (loops far above the iterations
  runs use). Each has an estimated saving per run, a risk weighed by the linked evaluation, and
  an RFC 6902 `fix` when the change is mechanical. `suggestionDiagnostics` turns them into
  `I_COST_SUGGESTION` diagnostics (RFC-0020) for the Problems panel.
- **`generateWorkflow(input) → GeneratedWorkflow`** — the AI builder. Structured generation
  against a compact JSON Schema of `WorkflowDefinition`, with the allowed manifests in the system
  prompt; compiler errors go back to the model up to three times until nothing is an error.
- **`critique(input, judge?) → Advice[]`** — the critic. The `RUBRIC` rules (unbounded generation
  loops, irreversible tools after an ungated decision, personal data reaching a prompt, no
  evaluation set, no decision failover, no or over-budget cost bound), each with a fix when one
  is mechanical, plus an optional yes/no judge through the workspace's decision chain.
