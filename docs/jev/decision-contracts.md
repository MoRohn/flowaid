# Decision contracts

> "A production Jev question is a decision contract." (§III.A A Question Is Part of the Program)

A decision contract is a versioned specification of one semantic question. It covers:

- which state fields are visible
- what the instructions mean
- which outcomes exist and which escape path is safe
- how confidence is interpreted and what action may follow
- which model answers
- who owns it

A contract turns a hidden judgment into production logic that _"can be evaluated, logged,
reviewed, and rolled back"_ (Abstract). In FlowAId, a contract is a `DecisionContractBody`
stored in a registry that is separate from workflow versions and identified as `key@version`,
for example `support.router@4`.

Handbook: §II (primitives), §III.A–§III.G. Design: JEV_ENGINEERING §4. Library:
`@flowaid/jev` `contract.ts` (`DecisionContractBodySchema`, `contractHash`, `interfaceOf`,
`outcomePorts`).

## 1. Pick the primitive by answer shape

Table II (§II.D Selection Discipline): _"Primitive selection begins with the declared answer
shape."_

| Answer shape        | Primitive | Design requirement                                | FlowAId `question.kind`                     |
| ------------------- | --------- | ------------------------------------------------- | ------------------------------------------- |
| One winner          | Choice    | Describe each option; add an escape hatch         | `choice` (static or dynamic menu)           |
| Ordered quality     | Score     | Define verbal anchors; avoid fake precision       | `score` (with optional `bands`)             |
| Yes or no           | Noul      | Read the probability as uncertainty, not severity | `boolean` (sent as TypeSafe `noul`)         |
| Unknown free string | Not Jev   | Use extraction or generation                      | `flowaid.ai.*`, then Jev over the known set |
| Exact arithmetic    | Not Jev   | Use deterministic code                            | `branch`, FlowExpr                          |

**Choice** (§II.A Choice): _"The important design work is not the option label but the option
description."_ Each description states the evidence that separates its outcome from its
neighbours. Closed menus need an escape hatch (`none`, `other`, `stop`, `escalate`, `review`).
Without one, probability _"is forced onto the least-wrong option. The result remains type-valid
but can be operationally false."_ Choice never invents an identifier, URL, number or name that
is not on the menu.

**Score** (§II.B Score, §II.G Rubric Design): the levels are verbal descriptions of observable
differences in evidence. Prefer three to five well-separated levels. A score of 1.6 is _"a
position between two descriptions. It is not automatically 80 percent good"_. FlowAId therefore
treats `ScoreDecision.normalized` as display-only. To route on a score, the contract declares
**bands**, contiguous level ranges that each fire a port:

```json
"bands": [
  { "port": "drop",    "minLevel": 0, "maxLevel": 1 },
  { "port": "partial", "minLevel": 2, "maxLevel": 2 },
  { "port": "direct",  "minLevel": 3, "maxLevel": 3 }
]
```

**Noul** (§II.C Noul): a probability near one means likely yes, near zero likely no, and near
one half means the evidence does not separate the two. _"It does not mean medium severity or
partial permission. Ordered risk categories belong in Score."_ In FlowAId, `yesAt` sets the
application-defined band for `value`. The routing confidence is `max(pYes, 1 − pYes)`.
Calibration uses the raw `pYes` (see [calibration.md](calibration.md)).

**Composition and anti-patterns** (§II.F Primitive Composition, §II.G Primitive
Anti-Patterns): primitives that inspect the same snapshot can be asked together (see
[parallel-questions.md](parallel-questions.md)). Avoid these mismatches:

- a multi-label problem modelled as a Choice
- Score over unordered categories
- a Noul probability read as severity

When the required output does not match one primitive cleanly, divide the question. A risk
workflow might _"use Noul to detect the presence of an external side effect, Score to rate
consequence, and Choice to select the permitted route"_. The
[`jev-escalation-triage`](../../packages/jev/templates/jev-escalation-triage.json) template
follows this decomposition. The lint for these mistakes is `W_JEV_PRIMITIVE_MISMATCH`.

**Type safety is not truth** (§II.E Type Safety Is Not Truth): _"Type safety removes parsing
and schema failures. It does not remove the need to test the meaning of the decision."_ This
is why everything else on this page exists.

## 2. Identifiers are not instructions

§III.A: _"A field named safe_to_publish helps application code but does not teach the model
what safe means."_

```text
# weak
safe_to_publish = Noul('Is this safe?')

# stronger
safe_to_publish = Noul(
  'Does the draft contain only verified claims with citations, avoid private information, and
   require no unresolved legal or financial approval?'
)
```

FlowAId flags the weak form with `W_JEV_INSTRUCTIONS_WEAK`: short instructions built on a vague
predicate such as _safe_, _good_, _ok_ or _valid_, or instructions that only restate an
identifier. Outcome descriptions that are near-duplicates, praise-only or multi-step get
`W_JEV_OPTIONS_UNDISTINGUISHED` (§VIII.F Option Descriptions).

## 3. The ten fields and where they live

§III.B Contract Fields lists the minimal contract. FlowAId adds an owner and tests:

| Handbook field                | `DecisionContractBody` path                                                             | Enforced by                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| State schema                  | `state` (fields, roles, schemas, data classes, budget, privacy/latency class)           | Packet builder; the node's `state` port schema                                      |
| Instructions                  | `question.instructions`                                                                 | `W_JEV_INSTRUCTIONS_WEAK`                                                           |
| Option descriptions or rubric | `question.menu.outcomes` / `escapes` / `levels` / `bands` / boolean `outcomes`          | `W_JEV_OPTIONS_UNDISTINGUISHED`, `W_JEV_RUBRIC_*`                                   |
| Fallback outcome              | `fallbackOutcome` (an escape key, or null for human)                                    | `W_JEV_NO_ESCAPE_HATCH`, `E_JEV_DYNAMIC_MENU_NO_ESCAPE`                             |
| Confidence thresholds         | `routing.thresholds` per consequence class, `routing.governance`                        | `E_JEV_THRESHOLDS_UNMAPPED`, `W_JEV_THRESHOLDS_ILLUSTRATIVE`                        |
| Consequence class             | `routing.consequenceClass` plus overrides per outcome or band                           | Routing precedence ([confidence-and-consequence.md](confidence-and-consequence.md)) |
| Allowed action                | `allowedAction` (kinds, capabilities, `maxConsequence`, external effects)               | `E_JEV_AUTHORITY_EXCEEDED`, `E_JEV_IRREVERSIBLE_AUTO`                               |
| Escalation path               | `escalation` (assignees, mode, expiry, written rubric) plus the node's `human` route    | `E_JEV_ESCALATION_UNWIRED`                                                          |
| Model version                 | `model.primary` / `failover` / `expectResolved`; the resolved model is on every receipt | `onModelChange`, drift alarm `model_version_changed`                                |
| Contract version              | `key@version` plus a content hash                                                       | Registry, receipts, deployments                                                     |
| Owner (FlowAId)               | `owner`, `routing.governance.owner`                                                     | Review, notifications                                                               |
| Tests (FlowAId)               | `tests.requiredCategories`, `minPerCategory`, `minAccuracy`, `requireMonotonicity`      | Contract test runner                                                                |

**The allowed action matters most.** It _"prevents a classification result from silently
expanding into authority"_ (§III.B). The compiler computes, for each auto-capable port, the
nodes it can reach before a human node, a tool gate or another router. Any capability, external
side effect or consequence class above `allowedAction` is a compile error. See
[confidence-and-consequence.md §Authority](confidence-and-consequence.md#authority-stays-in-code).

## 4. A complete contract

This is `support.ticket_router@1`, shipped with the rollout templates. Some descriptions are
shortened here:

```json
{
  "key": "support.ticket_router",
  "version": 1,
  "title": "Support ticket router",
  "purpose": "Routes an inbound ticket to one team queue. Internal routing only: no customer-visible action.",
  "owner": "team:support-ops",
  "question": {
    "kind": "choice",
    "instructions": "Which team queue should receive this support ticket? Judge only from the customer's message and the channel; the queue must be able to resolve the request without handing it on.",
    "menu": {
      "source": "static",
      "outcomes": {
        "billing": {
          "description": "Invoices, charges, refunds or subscription changes on an account the customer can already access."
        },
        "account_access": {
          "description": "The customer cannot sign in, lost a second factor, or reports a takeover; any request whose resolution needs identity verification."
        },
        "technical": {
          "description": "A product defect, error message, outage or integration failure with observable symptoms."
        },
        "general": {
          "description": "A clear request that fits none of the teams above and needs no specialist."
        },
        "none": {
          "description": "The message is not a support request, is empty, or no listed queue can act on it.",
          "escape": "none",
          "automatable": false
        }
      }
    }
  },
  "fallbackOutcome": "none",
  "state": {
    "goal": "Route the ticket to the queue that can resolve it without a hand-off.",
    "fields": {
      "message": {
        "role": "evidence",
        "description": "Customer message as received: the evidence being judged.",
        "schema": { "type": "array" },
        "dataClass": "pii",
        "selection": { "maxItems": 1 }
      },
      "channel": {
        "role": "fact",
        "description": "Inbound channel; chat messages are shorter and less formal than email.",
        "schema": { "type": "string", "enum": ["email", "chat", "api"] },
        "required": false
      }
    },
    "maxTokens": 4000,
    "privacyClass": "pii",
    "latencyClass": "interactive"
  },
  "routing": {
    "consequenceClass": "low",
    "thresholds": { "low": { "autoAt": 0.9, "improveAt": null, "minMargin": 0.2 } }
  },
  "allowedAction": {
    "kinds": ["internal_routing"],
    "capabilities": ["tracker.assign_ticket"],
    "maxConsequence": "low",
    "externalSideEffects": false
  },
  "escalation": {
    "assignees": ["role:support_lead"],
    "mode": "choice",
    "rubric": "Pick the queue that can resolve the ticket end to end. Use none when no queue can act."
  },
  "model": { "primary": { "provider": "typesafe", "model": "jev-latest" } }
}
```

The contract has no `routing.governance`, so its thresholds are illustrative. It can act in
non-protected environments. Protected environments first need shadow calibration and a
governance record ([shadow-mode-and-rollout.md](shadow-mode-and-rollout.md)).

## 5. Versioning

§III.C Contract Versioning: _"A semantic edit can alter production behavior even when no
application code changes."_ In FlowAId:

- **One version per semantic change.** Bodies never change after creation. The handbook's
  `router@1` (broad options) → `@2` (adds none-of-the-above) → `@3` (separates billing from
  account access) → `@4` (consequence-specific thresholds) is the worked example in
  JEV_ENGINEERING §4.7. `changelog` is required for `version > 1`.
- **Interface versus body.** The _interface_ is the part a workflow is compiled against: the
  kind, the routable ports, the escape keys, the level count, the menu source and the state
  field names, roles and schemas. `interfaceHash` covers it. Instructions, descriptions,
  thresholds, governance, model and tests are _not_ interface. They change behaviour without
  changing wiring, which is why they are versioned, reviewed and rolled out on their own.
- **Binding.** Contract nodes hold `contract: { key, version: 'deployed' | <n> }`. `'deployed'`
  follows the environment's contract deployment, so a new version rolls out without a new
  workflow version. The plan embeds the resolved body, so `planHash` covers the exact semantic
  program and exported code runs offline.
- **Lifecycle.** An editable draft → `in_review` → `approved` or `rejected` → deployed per
  environment → `deprecated` once superseded. Deprecated versions can still be resolved for
  replay.

## 6. Review the contract like code

§III.D Review the Contract Like Code. FlowAId's review checklist (`ReviewCheckSchema`) mirrors
the handbook item by item:

| Check                      | Handbook                                                 | Pre-filled from                                                                 |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `fields_necessary`         | "every state field is necessary"                         | Packet ablation sensitivity, field descriptions                                 |
| `outcomes_distinguishable` | "every outcome is distinguishable"                       | `W_JEV_OPTIONS_UNDISTINGUISHED`                                                 |
| `escape_hatch`             | "every open menu has an escape hatch"                    | `W_JEV_NO_ESCAPE_HATCH`                                                         |
| `ranges_routed`            | "every confidence range maps to an explicit route"       | `E_JEV_THRESHOLDS_UNMAPPED`                                                     |
| `action_narrower`          | "the allowed action is narrower than the model judgment" | Authority proofs                                                                |
| `exact_rules_in_code`      | "exact constraints remain in code"                       | `W_JEV_EXACT_RULE`                                                              |
| `regression_replayed`      | "Re-run labeled examples from the previous version"      | Counterfactual replay report ([receipts.md](receipts.md#counterfactual-replay)) |
| `changes_explained`        | "require an explanation for behavior changes"            | `changelog`, semantic diff                                                      |

_"A shorter prompt is not automatically a safer or more maintainable contract."_ The diff view
shows shortened instructions as a behaviour change that needs replay evidence. A version
deployed to a protected environment must be approved by someone other than its author.

## 7. Lifecycle: four stages, none hidden

§III.E Contract Lifecycle: define → evaluate against one immutable snapshot → route through
consequence-aware thresholds and deterministic policy → record the receipt and the resulting
action. FlowAId keeps the stages separate:

- `flowaid.jev.decide` evaluates the contract.
- The routing engine (inline, or in a separate `flowaid.jev.route` node) applies the policy.
- The runtime fires the authorised port.
- The receipt records each stage.

Because evaluation is separate from routing, one distribution can serve several policies. An
internal queue may automate at a lower threshold than a public statement. Each policy appends
its own `routings[]` entry to the same receipt.

## 8. Testing contracts

§III.F Testing Contracts: tests cover _"ordinary cases, ambiguous cases, missing evidence,
adversarial language, stale options, and examples where no option fits"_. They check both the
answer and _"whether confidence changes monotonically with evidence quality"_.

- Fixture categories: `normal`, `ambiguous`, `missing_evidence`, `adversarial`,
  `stale_options` (dynamic menus), `rare_class`, `no_fit`, plus `incident` (promoted from
  incident review, and mandatory once they exist) and `ladder` (the same case with rising
  evidence quality, used for monotonicity).
- `tests.requiredCategories` and `minPerCategory` gate approval. The contract test runner
  (`jev.contract_test`) evaluates fixtures directly against a contract version, with no
  workflow run. It reports accuracy per category, route correctness, ladder monotonicity and
  packet ablation sensitivity.
- _"A contract that is accurate only on easy examples is not ready to control a branch."_

## 9. Legacy decision nodes

`flowaid.decision.{boolean,choice,score,batch,consensus,validator}` keep their configuration
and wire behaviour. FlowAId synthesises an **implicit contract**
(`implicit.<nodeId>[.<question>]@1`) for each of them, purely from the plan. They still write
receipts, and existing plan hashes do not change. At publish, `W_JEV_IMPLICIT_CONTRACT`
suggests the quick fix _Extract to decision contract_. The fix creates a registry draft and
rewrites the node to `flowaid.jev.decide` with external routing, so existing gates keep
working.

## Checklist

- [ ] The branch is semantic: not generative, not exact (§I.G An Operational Boundary Test).
- [ ] The primitive matches the answer shape (Table II).
- [ ] The instructions define meaning; descriptions state distinguishing evidence.
- [ ] The Choice has an escape hatch, and `fallbackOutcome` names it.
- [ ] The Score has three to five verbal levels, with bands if it routes.
- [ ] The allowed action is narrower than the judgment.
- [ ] Every consequence class the contract can reach has zones (or is `irreversible`).
- [ ] Fixtures cover the required categories, including no-fit and ambiguous cases.
- [ ] `changelog` explains the behaviour change, and replay evidence is attached for `version > 1`.
