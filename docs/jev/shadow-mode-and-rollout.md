# Shadow mode and staged rollout

> "In shadow mode the existing production path remains authoritative. Jev evaluates the same
> decision but does not act." (§IX.D)

A new contract never starts by acting. It runs in shadow beside the existing path (an LLM prompt,
a rule, code or a person), and FlowAId measures it before any branch is automated. Automation then
starts with **one low-consequence outcome** under deterministic guardrails, with a rollback trigger
defined before launch. The shadow module is in
[`packages/jev/src/shadow/`](../../packages/jev/src/shadow/); the normative design is
[`JEV_ENGINEERING.md` §11](../design/JEV_ENGINEERING.md).

## Start with one decision

"Select one high-volume, low-consequence semantic decision whose correct answer can be labeled
later. Internal ticket routing, worker selection, retrieval filtering, and completion checks are
common starting points. Payment approval without human review is not" (§IX.A). Write the contract
before calling the model: "If the team cannot agree on those fields, the branch is not ready for
automation" (§IX.B). The `jev-first-contract-shadow` template does exactly this for
`support.ticket_router`.

## The shadow record

Every shadow evaluation writes a receipt and a `ShadowComparison`:

| Field         | Meaning                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `contract`    | Contract key, version and hash (`ticket-router@3` in the handbook)                                      |
| `stateHash`   | The packet hash the shadow evaluated                                                                    |
| `jevModel`    | The resolved model (`jev-1.13.0`), not only the alias                                                   |
| `shadow`      | Outcome, confidence, **full distribution** and the route it would take                                  |
| `production`  | Source (`llm`, `rule`, `code`, `human`, `jev`), node and the answer mapped into the contract's outcomes |
| `agree`       | Whether the two answers match; `null` when the production answer cannot be mapped                       |
| `humanLabel`  | Joined later from labels                                                                                |
| `actionTaken` | Always `false`                                                                                          |

The handbook's example record omits the distribution, but its prose says to log it, and so does
failure mode 6 ([failure-modes.md](failure-modes.md)). FlowAId stores it.

`mapProductionAnswer` maps free-form production answers into the outcome space by exact key, then
by a normalized key (case, spaces, hyphens), then by declared aliases. Anything else is
unmappable. It is never guessed.

## Agreement is not accuracy

`summarizeShadow` reports agreement, a production × shadow confusion matrix, the would-route shares,
and the list of disagreements. Disagreements are oversampled for labeling through the
`shadow_disagreement` stratum. It also reports **each side's accuracy against human labels**,
because the production path can be wrong. Shadow evaluation produces "the data needed to test
whether higher confidence actually corresponds to higher accuracy" (§IX.D). Calibration is first
estimated here ([calibration.md](calibration.md)).

## Deployment stages

Contracts are deployed per environment, independently of workflow versions:

| Stage                                 | What decisions do                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| candidate `shadow`, no active version | Candidate writes receipts only; the existing path carries the traffic                                |
| candidate `canary`                    | Sampled, eligible decisions are automated by the candidate; the rest stay on the old path (holdback) |
| active                                | Routes normally within the guardrails                                                                |
| active + candidate `shadow`           | Active acts; the candidate is evaluated alongside                                                    |
| paused                                | No Jev authority; the old path or a human handles everything, and receipts are still written         |

## Guardrails are deterministic

"Limit the first automated branch by traffic share, tenant, language, and consequence. Sample
automated cases for review, retain the old path as a fallback, and define a rollback trigger before
launch. Guardrails should be deterministic and independent of Jev confidence" (§IX.I). FlowAId's
guardrails are the traffic share (sampled by a salted hash), tenant and language allow-lists, a
maximum consequence class, the one outcome to automate first, and a review sample rate. A version
cannot act until at least one rollback trigger exists.

## Promotion rules

| Step                   | Requirement (protected environments)                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| draft → approved       | Lints clean, fixtures cover the required categories, contract test passed, reviewer ≠ author                                                                                                 |
| → candidate `shadow`   | Approved version whose interface is compatible with deployed workflows                                                                                                                       |
| shadow → `canary`      | ≥ 200 labeled shadow decisions per automated outcome with segment ECE ≤ 0.05, governed thresholds, ≥ 1 rollback trigger, traffic share ≤ 0.05; the shadow numbers are frozen as the baseline |
| canary share increases | No open critical alarm; canary no worse than the baseline; steps 0.05 → 0.25 → 1.0                                                                                                           |
| candidate → active     | Canary at 1.0 for ≥ 7 days and a rollout report with verdict `pass`                                                                                                                          |

**Rollback** restores the previous active version in one step. **Pause** removes Jev's authority
immediately. A rollout-check job evaluates the rollback triggers against fresh calibration
snapshots every five minutes.

## The rollout is complete only on task outcomes

"A rollout is complete only when the team can compare end-to-end task outcomes, not merely
classifier agreement. The expected gain should appear in latency, cost, review load, or
completed-task rate without an offsetting increase in recovery work" (§IX.I). The rollout report
compares the shadow baseline window with the canary or active window on completed-task rate, cost
and latency per completed task, human review rate and recovery cost (Table VIII).

## Then the next boundary

"Expand one boundary at a time": internal routing, then retrieval filtering, completion
verification, model selection and low-risk tool gating (§IX.G). Monitor drift: "Treat semantic
drift like software drift: inspect, test, version, and roll back" (§IX.H).

## Status

- **Built** (`@flowaid/jev`): the `ShadowComparison` schema, `mapProductionAnswer`, `compareShadow` and `summarizeShadow`, plus the rollback-trigger schema on contracts. All are covered by tests.
- **Waiting on other packages**: the deployment and promotion API, the rollout-check job, the `flowaid.jev.shadow` node and the rollout report (api, worker, nodes-core, database).
