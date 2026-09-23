# Jev engineering in FlowAId: overview

FlowAId treats TypeSafe AI's Jev as its decision layer. Jev is a System One model: you give it
structured state and typed questions, and it returns constrained answers with probability
distributions. This folder shows how FlowAId applies the practices of _Jev Engineering for
Production Agents: A Practical Handbook on Typed Semantic Decisions_ (September 2026, an
independent study edition that is not affiliated with TypeSafe AI) to designing, running,
evaluating and explaining decisions.

- Handbook: [`docs/research/jev/jev-engineering-for-production-agents.pdf`](../research/jev/jev-engineering-for-production-agents.pdf) (text extraction alongside it)
- Study guide: [`docs/research/jev/JEV_EXPERT_GUIDE.md`](../research/jev/JEV_EXPERT_GUIDE.md)
- Normative design: [`docs/design/JEV_ENGINEERING.md`](../design/JEV_ENGINEERING.md)
- Live API: [`docs/design/TYPESAFE_API.md`](../design/TYPESAFE_API.md)
- Harness templates: [`packages/jev/templates/`](../../packages/jev/templates/)

**How citations work.** Handbook citations use the form `§<Roman>.<Letter> <Title>`. The title
is always included because ten sections print one subsection letter twice. For example, §III.D
covers both _Review the Contract Like Code_ and _The Decision Receipt_ (study guide §15 item 1).
Figures and tables are cited by their numbers (Fig. 1, Table I–IX).

## The division of labour

Fig. 1 of the handbook has four boxes: **STATE** (facts + evidence) → **LLM** (creates work) →
**JEV** (typed judgment) → **CODE** (enforces policy). Its caption reads: _"Generation, semantic
judgment, and authority are separate responsibilities."_ The conclusion puts it in one line:
_"The LLM turns context into new work. Jev turns state into typed judgment. Code turns judgment
into controlled action."_ (§XI.D Conclusion).

The figure is a separation of duties. It does not fix an execution order: Jev can run before the
model, before a tool, after a tool or around retrieval (§VII). The execution order the handbook
does require is the **safe operating order** (below).

| Owner          | Owns                                                                                  | FlowAId construct                                                                                                |
| -------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| State          | Facts, evidence, artifacts, constraints, live options, the snapshot version           | The run's event log and node outputs, projected into a [state packet](evidence-packets.md)                       |
| Generative LLM | Output that must be written: text, code, plans, tool arguments                        | `flowaid.ai.*` nodes, the agent tool loop                                                                        |
| Jev            | Ambiguous meaning when the answer shape is known: one winner, ordered quality, yes/no | Contract-bound `flowaid.jev.*` nodes (legacy `flowaid.decision.*` nodes keep working and get implicit contracts) |
| Code           | Exact invariants: counts, dates, balances, allowlists, permissions, budgets           | `branch`, FlowExpr, bounds, credential scopes, tool policy, rollout guardrails                                   |
| Code + human   | Consequential side effects                                                            | `human` nodes, inline escalation, approvals                                                                      |

Table I (§I.D Three Owners Inside the Agent) gives the reasoning: _"Workload ownership follows
output shape and authority, not model capability alone."_ To draft a research summary, use the
LLM. To choose the next worker or rate evidence quality, use Jev. To stop after three attempts,
use code. To approve a payment, use code plus a human. To verify a report, use Jev plus code.

### The operational boundary test

§I.G An Operational Boundary Test asks three questions about every branch:

1. Must the output itself be written? Use a generative model.
2. Is the meaning ambiguous while the answer shape is already known? Use Jev.
3. Must the condition be obeyed exactly? Use code.

A branch that seems to need all three gets split into generation, judgment and enforcement
steps. A failure can then be traced to one of them instead of being _"attributed vaguely to the
agent"_. In FlowAId, three lints enforce the test:

- `W_JEV_GENERATION_FOR_DECISION` flags an LLM node used as a classifier.
- `W_JEV_EXACT_RULE` flags a Jev question that is really an exact rule.
- `W_JEV_FREE_VALUE` flags a Jev question that asks for an undeclared name, URL, id or number.

The critic action **Map hidden decisions** applies the boundary test to a whole workflow
(JEV_ENGINEERING §14.1).

### The safe operating order

> "Jev judges; code checks policy; the tool executes; the trace records." (§I.E Authority Remains
> Outside the Model, §X.N Safe Operating Order)

FlowAId treats this order as a runtime invariant:

1. **Judge.** A contract node evaluates one immutable packet.
2. **Policy.** The routing engine and deterministic policy produce a route and a verdict. The
   policy includes allowed actions proven at compile time, rollout guardrails, tool policy,
   budgets and approvals.
3. **Execute.** The runtime fires only the port that the policy authorised.
4. **Record.** The [receipt](receipts.md) links all three steps.

No side effect runs because a decision _said_ so without step 2 in between.
`E_JEV_AUTHORITY_EXCEEDED` and `E_JEV_IRREVERSIBLE_AUTO` enforce this statically. At run time,
the runtime fires only authorised ports. See
[confidence-and-consequence.md](confidence-and-consequence.md).

## What Jev returns (live API)

The handbook's code is pseudocode. The live API is `POST /v1/systemone` (see
[`TYPESAFE_API.md`](../design/TYPESAFE_API.md)):

| Handbook                       | Live API question                                                            | Answer                                                               | FlowAId `DecisionResult`                                      |
| ------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `Choice(...)`                  | `{"type":"choice","instructions","criteria":{key: desc}}`, up to 255 options | `choice`, `confidence`, `probabilities`                              | `kind: 'choice'`, `value`, `confidence`, `probabilities`      |
| `Score(...)`                   | `{"type":"score","instructions","criteria":[levels]}`, 2–10 levels           | fractional `score` in `[0, levels-1]`, `confidence`, `probabilities` | `kind: 'score'`, `value`, `level`, `levelLabel`, `levels`     |
| `Noul(...)`                    | `{"type":"noul","instructions","criteria"?:{true,false}}`                    | `noul` = P(yes), with no separate confidence                         | `kind: 'boolean'`, `pYes`, `confidence = max(pYes, 1 − pYes)` |
| `system_one(state, questions)` | One request with a `questions` map                                           | One answer per question                                              | Bundles (see [parallel-questions.md](parallel-questions.md))  |

The handbook's Score sketch leaves out `instructions`, but the live API requires them.

## Map: handbook → FlowAId

| Handbook                           | What FlowAId does                                                                                                                                | Read                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| §II Choice, Score, Noul            | Choose the primitive by answer shape; escape hatches; verbal rubrics with score bands; Noul read as uncertainty, never as severity               | [decision-contracts.md](decision-contracts.md)                 |
| §III Decision contracts as code    | A versioned `DecisionContractBody` (`support.router@4`) with ten fields, reviewed like code, deployed per environment, rolled back independently | [decision-contracts.md](decision-contracts.md)                 |
| §IV State packets and evidence     | `StatePacket` built from declared fields only, with evidence instead of conclusions, data classes, freshness, a budget and a hash                | [evidence-packets.md](evidence-packets.md)                     |
| §V Confidence, consequence         | Consequence before confidence; auto / improve / human zones per consequence class; governed thresholds; blind-retry guard                        | [confidence-and-consequence.md](confidence-and-consequence.md) |
| §V Calibration                     | Per-contract, segmented reliability, Brier on raw P(yes), sampled labels, drift alarms, threshold recommendations that are never auto-applied    | [calibration.md](calibration.md)                               |
| §VI Parallel questions             | Bundles share one `stateVersion`, go out as one TypeSafe request per packet, never mix privacy or latency classes                                | [parallel-questions.md](parallel-questions.md)                 |
| §VII Harness placement             | `flowaid.jev.*` nodes and templates for before-model, before-tool, after-tool, retrieval and escalation                                          | [harness-patterns.md](harness-patterns.md)                     |
| §VIII Live menus                   | Option sets built immediately before evaluation, with counts, a version, escapes and `stop`                                                      | [live-menus.md](live-menus.md)                                 |
| §IX Evaluation and rollout         | Shadow nodes and shadow candidates, canary on one outcome, deterministic guardrails, rollback triggers set before launch                         | [shadow-mode-and-rollout.md](shadow-mode-and-rollout.md)       |
| §X Failure modes                   | A 31-row catalog that compiler lints, runtime route reasons and TraceReviewer signals are built from; incident review in the diagnostic order    | [failure-modes.md](failure-modes.md)                           |
| §III.D The Decision Receipt, §VI.H | An immutable receipt per decision that makes the semantic transaction replayable                                                                 | [receipts.md](receipts.md)                                     |

## The playbook (§XI.A Ten-Step Implementation Sequence) in FlowAId

| Step                                                                                       | FlowAId mechanism                                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 1. Map the agent loop and mark every hidden choice, score, yes/no judgment, retry and stop | Critic **Map hidden decisions** (`inventoryHiddenDecisions`)                                                |
| 2. Keep open-ended creation in the LLM and exact invariants in code                        | Boundary lints `W_JEV_GENERATION_FOR_DECISION`, `W_JEV_EXACT_RULE`, `W_JEV_FREE_VALUE`                      |
| 3. Pick one repeated, low-consequence semantic branch                                      | `firstContractScore` ranks candidates: high volume, low consequence, can be labeled later                   |
| 4. Define the decision contract                                                            | A registry draft, reviewed like code ([decision-contracts.md](decision-contracts.md))                       |
| 5. Build compact evidence packets                                                          | `StateSpec` plus the packet builder ([evidence-packets.md](evidence-packets.md))                            |
| 6. Batch independent questions against one snapshot                                        | `flowaid.jev.bundle` and compiler batch groups ([parallel-questions.md](parallel-questions.md))             |
| 7. Route confidence into automate, improve-state and human-review paths                    | `flowaid.jev.decide` / `flowaid.jev.route` ([confidence-and-consequence.md](confidence-and-consequence.md)) |
| 8. Run shadow mode and measure calibration                                                 | `flowaid.jev.shadow`, shadow candidates, calibration snapshots                                              |
| 9. Automate the safest branch and keep rollback                                            | Canary with `guardrails.outcomes`, rollback triggers, one-step rollback                                     |
| 10. Expand one boundary at a time and watch completed-task economics                       | Critic expansion order; Table VIII dashboards and the rollout report                                        |

The handbook's **launch checklist** (§XI.B Launch Checklist, §XI.C Checklist, Continued) has
sixteen items. FlowAId turns each one into an automated check in the `ReadinessReport` that the
publish dialog shows (JEV_ENGINEERING §14.2). Deploying to a protected environment is refused
while any contract node on an auto-capable path fails a check.

The handbook's **suggested agent prompt**: _"Map every hidden choice, score, yes-or-no
judgment, and side-effect boundary in this repository. Propose one low-consequence decision
contract to run in shadow mode first."_ The same prompt is built into the critic. Its
FlowAId-native walkthrough is the `jev-first-contract-shadow` template
([shadow-mode-and-rollout.md](shadow-mode-and-rollout.md)).

## Honest economics

TypeSafe reports about 70–500 ms of latency for Jev-shaped requests and $0.042 per million input
tokens, with output tokens not metered. The broader 20–200x speed and 40–400x cost figures come
from favourable workflow evaluations. The handbook says to read them as _"workload-dependent
ceilings rather than promises for every integration"_ (Abstract). FlowAId shows these figures
only with the label _vendor-reported_. Its own savings and latency numbers come from measurements.

The unit of analysis is _"the completed task, not the isolated call"_ (§I.C Latency, Cost, and
Integration). FlowAId's headline KPIs are therefore:

- cost and reliability per completed task
- human review rate
- recovery cost
- generative calls removed

The number of Jev calls is never a success metric. _"A small graph with high-quality boundaries
is better than a dense graph of low-value classifiers"_ (§IX.H Monitor Drift). _"The goal is
not to maximize Jev usage. The goal is to remove generative calls from decisions that never
required a sentence."_ (Abstract).

## Templates

Each template in [`packages/jev/templates/`](../../packages/jev/templates/) is a
`WorkflowDefinition` with a `<name>.contracts.json` beside it. At instantiation, FlowAId
provisions those contracts in the workspace (JEV_ENGINEERING §9.8).

| Template                    | Handbook pattern                                                                                            | Contracts                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `jev-tool-gate`             | Pre-tool authorization check (§VII.B Before the Tool, §VII.D Tool Semantics)                                | `ops.tool_risk@1`                                                      |
| `jev-verified-builder`      | Post-generation verification (§VII.C After the Tool, §VII.D Builder and Verifier)                           | `research.report_verifier@1`                                           |
| `jev-retrieval-relevance`   | Retrieval relevance filter over a live source menu (§VII.E Around Retrieval, §VIII)                         | `research.next_source@1`, `research.source_relevance@1`                |
| `jev-escalation-triage`     | Choice + Score + Noul over one snapshot with consequence-aware escalation (§VI.A, §II.G, §V.A)              | `ops.alert_needs_owner@1`, `ops.alert_impact@1`, `ops.alert_runbook@1` |
| `jev-first-contract-shadow` | First contract in shadow beside an LLM classifier (§IX.A, §IX.D)                                            | `support.ticket_router@1`                                              |
| `jev-classifier-rollout`    | Shadow → canary → active through contract deployments, with the old path kept as the fallback (§IX.F–§IX.I) | `support.ticket_router@1`                                              |

Thresholds in every template are illustrative, as Table V says of its own values, and no
template ships threshold governance. Protected environments require shadow calibration and a
governance record before a contract can act.

## Implementation status

The design is complete ([`JEV_ENGINEERING.md`](../design/JEV_ENGINEERING.md)). Delivery runs as
track J of [`docs/UPGRADE_PLAN.md`](../UPGRADE_PLAN.md):

- **J-01…J-07, library core built:** the browser-safe library `@flowaid/jev` has schemas, the
  packet builder, bundle planner, routing engine, calibration math, receipts with hash chains,
  live menus, shadow comparison, contract lints and the failure-mode catalog, covered by 183
  tests. Still to come in the library: the tool-proposal normalizer and tool policy, receipt
  reconstruction and replay planning, the workflow analyzers and incident review.
- **J-09…J-12:** compiler, database, provider and runtime integration.
- **J-13:** the `flowaid.jev.*` node types, which make the templates runnable.
- **J-15…J-18:** API and UI surfaces.

Until then, legacy decision nodes (`flowaid.decision.*`) are the runnable path. When the runtime
integration lands they get implicit contracts and receipts.

## Vocabulary

| Term              | Meaning                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Decision contract | A versioned specification of one semantic question (`key@version`)                                     |
| State packet      | The compact JSON sent as TypeSafe `state`, built from declared fields                                  |
| `stateVersion`    | `<runId>:<scope>@<seq>`: the exact snapshot a packet was built from                                    |
| Bundle            | All questions evaluated against one snapshot                                                           |
| Consequence class | `low` · `medium` · `high` · `irreversible`: the stakes of the action a judgment may authorise          |
| Route             | `auto` · `improve` · `human`                                                                           |
| Disposition       | What rollout allowed: `active` · `canary` · `holdback` · `shadow`                                      |
| Escape outcome    | `none` · `other` · `stop` · `review` · `escalate`: absorbs probability when reality is not on the menu |
| Receipt           | An immutable record of judgment, snapshot, policy and action for one question                          |
