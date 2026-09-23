# Confidence and consequence

> "Most systems flatten probability into a label too early. A result of 0.51 and a result of 0.99
> may both become yes, even though they should not receive the same authority." (§V.A)

In FlowAId a decision's distribution changes what the harness does next. This page describes the
routing engine (`route` in [`packages/jev/src/routing/`](../../packages/jev/src/routing/)), the
three zones, the improve-state path and how thresholds are governed. The normative design is
[`JEV_ENGINEERING.md` §6](../design/JEV_ENGINEERING.md).

## Consequence before confidence

The handbook's routing precedence (§V.E Confidence Is Not Authority) checks consequence **before**
any confidence test:

```
if consequence == 'irreversible':  return HUMAN_REVIEW
if confidence >= auto_threshold:   return selected_choice
if confidence >= evidence_threshold: return COLLECT_MORE_EVIDENCE
return HUMAN_REVIEW
```

FlowAId names the three outcomes `auto`, `improve` and `human`, the same values the receipt
records in `route` (Table III).

## Thresholds belong to the consequence class

"The same confidence should not control an internal queue and a public statement" (§V.A). Every
contract declares its consequence class (`low`, `medium`, `high`, `irreversible`) and zone
thresholds per class. The handbook's Table V is explicitly illustrative ("must be calibrated per
action class"); FlowAId ships it as conservative defaults and marks any decision routed on them
with the reason `thresholds_illustrative`:

| Consequence  | Auto at | Improve at | Default behaviour                                 |
| ------------ | ------- | ---------- | ------------------------------------------------- |
| low          | 0.90    | 0.70       | may automate the declared branch                  |
| medium       | none    | 0.70       | collect evidence or review; never auto by default |
| high         | none    | none       | human review                                      |
| irreversible | never   | never      | human review at every confidence                  |

A route node may **raise** a decision's consequence class, never lower it.

## What the routing confidence is

`routingSignal` reads the confidence the contract routes on: the provider's confidence for choice
and score, `max(pYes, 1 − pYes)` for Noul (so one threshold means the same across primitives), and
optionally the top-two **margin** for choice (`minMargin`). A decision whose margin is below
`minMargin` cannot auto-act even above `autoAt` (`margin_below_min`).

## The routing engine

`route(input)` is pure and deterministic: equal inputs give an equal route and equal reasons. It
applies, in order:

1. No evaluation (hops exhausted, over budget) → the contract's **fallback outcome**, never a
   silent default (`fallback_outcome`).
2. Escape outcomes (`none`, `other`, `review`, `escalate`) route by `escapeRoutes`; `stop` may
   auto-act when declared automatable (`escape_outcome`, `stop_outcome`).
3. `irreversible` → `human` (`consequence_irreversible`).
4. The zone from the thresholds of the class (`zone_auto`, `zone_improve`, `zone_human`).
5. Outcomes not declared automatable cannot auto-act (`outcome_not_automatable`).
6. Uncalibrated providers (a non-TypeSafe hop, or a fuzzy-mapped LLM label) route to `human`
   unless the contract explicitly allows them (`provider_uncalibrated`).
7. A resolved model that differs from the one the thresholds were calibrated on follows
   `onModelChange` (`model_version_changed`).
8. Rollout disposition (shadow, holdback, canary scope) can only lower authority
   ([shadow-mode-and-rollout.md](shadow-mode-and-rollout.md)).
9. An `auto` route names the one control port it authorises; if there is none, it cannot act.

Every reason is recorded in the receipt, so "why did this decision go to a human?" has an exact
answer ([receipts.md](receipts.md)).

## The improve zone must change the evidence

"Confidence without a different next action is decoration" (§V.B). A contract that has an improve
zone declares its improve actions: fetch a source, run a deterministic check, verify a file, ask
the user a precise question, narrow the option set, or consult a stronger model. Without declared
actions, or when `maxRounds` is used up, `improve` becomes `human`
(`improve_budget_exhausted`).

**Blind retries are blocked.** "Repeated evaluation with unchanged evidence can create false
reassurance" (§V.B). `blindRetryKey` hashes the contract, the packet and the option-set version;
the `BlindRetryGuard` refuses to re-ask the same contract on the same packet in the same lineage
and reuses the earlier result (`blind_retry_blocked`).

## Authority stays in code

"Calibration makes automation measurable; it does not transfer authority to the model" (§V.E). A
contract declares its **allowed actions**; the compiler proves that no `auto` route reaches an
action outside them, and every receipt records the safe order: judge → policy → execute → record.
Tool calls add a deterministic tool policy after Jev's risk judgment
([harness-patterns.md](harness-patterns.md), pattern B).

## Threshold governance

A threshold is production configuration, not a prompt setting. Its record carries an **owner,
rationale, evaluation window, consequence class and rollback condition** (§V.C Threshold
Governance). "A threshold chosen from a small demo set should never silently become permanent
policy." FlowAId's calibration job recommends thresholds from labeled data but never applies them;
accepting one creates a contract draft that goes through review
([calibration.md](calibration.md)).

Watch the traffic near each boundary: "A large mass just above an automation boundary makes the
system sensitive to small calibration drift. In that case, improve the contract or widen the review
zone before increasing autonomy" (§V.C). The `near_threshold_mass` alarm fires at 15 %.

## Status

- **Built** (`@flowaid/jev`): the routing engine, routing signals, the illustrative defaults, the blind-retry key and guard, and the receipt routing records. It is covered by tests.
- **Waiting on other packages**: enforcement at run time (runtime and nodes-core) and the compile-time authority proofs (compiler).
