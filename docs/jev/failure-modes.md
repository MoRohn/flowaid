# Failure modes and corrections

> "Many apparent model defects originate elsewhere in the harness." (Table IX caption)

FlowAId makes the handbook's failure modes **executable**. One catalog in
[`packages/jev/src/catalog/`](../../packages/jev/src/catalog/) feeds compiler diagnostics, runtime
route reasons, TraceReviewer signals and the advisor's critic rules. The normative design is
[`JEV_ENGINEERING.md` §13](../design/JEV_ENGINEERING.md).

## The catalog

`FAILURE_MODES` has 31 rows. Rows 1–12 are the handbook's own §X.A–§X.L. Rows 13–31 are
synthesized from warnings elsewhere in the handbook; each row cites its source section. Every row
links to the diagnostic codes that detect it statically and the route reasons that reveal it at
run time (`failureModesForCode`, `failureModesForReason`).

| #   | Failure mode                                                          | Correction                                                                          | Source        |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| 1   | Conclusions stored as evidence                                        | Store observable evidence: counts, types, verified and unresolved claims, freshness | §X.A, §IV.B   |
| 2   | No escape hatch                                                       | Add none, other, stop or review whenever the menu can be incomplete                 | §X.B, §II.A   |
| 3   | One threshold for every consequence                                   | Thresholds by action class; irreversible actions review-gated                       | §X.C, §V.A    |
| 4   | Stale options                                                         | Rebuild the option set from live state; version every decision                      | §X.D, §VIII   |
| 5   | Blind retries                                                         | Each retry adds evidence, changes the contract, narrows the menu or escalates       | §X.E, §V.B    |
| 6   | Winner-only logging                                                   | Store a complete decision receipt                                                   | §X.F, §III.D  |
| 7   | Policy inside the classifier                                          | Permissions, budgets, scopes and side effects in deterministic policy               | §X.G, §VII.B  |
| 8   | Exact rules delegated to Jev                                          | "Use code."                                                                         | §X.H, Table I |
| 9   | Unknown values hidden inside a label                                  | Use extraction or a tool, then return to Jev when the outcome set is known          | §X.I, §II.A   |
| 10  | Multi-step plan compressed into one answer                            | Decompose: run the tool that creates evidence, update state, ask again              | §X.J, §VI.B   |
| 11  | Verifier checks transport success                                     | Verify the goal: artifact, structure, evidence, destination, approvals              | §X.K, §VII.C  |
| 12  | Contract changes without evaluation                                   | Version, replay history, compare shadow behaviour, keep rollback                    | §X.L, §III.C  |
| 13  | Transcript as state                                                   | Compact evidence packet                                                             | §IV.A         |
| 14  | Over-privileged state                                                 | Field-level access rules and projections                                            | §IV.C         |
| 15  | Early flattening                                                      | Route on the distribution                                                           | §V.A          |
| 16  | Decorative confidence                                                 | Name the state-improving action                                                     | §V.B          |
| 17  | Demo-set thresholds become policy                                     | Threshold governance record                                                         | §V.C          |
| 18  | Global-average calibration                                            | Segment by version, consequence, language, rare option                              | §V.D          |
| 19  | Stale calibration                                                     | Re-estimate after contract, schema or population changes                            | §V.F          |
| 20  | Dependent questions batched, mixed versions, evaluation after a write | Snapshot discipline; new evidence means a new state version                         | §VI.G, §VI.C  |
| 21  | Mixed latency or privacy class in a batch                             | Batch only within one class                                                         | §VI.D         |
| 22  | Unlocked execution after parallel decisions                           | Serialize or lock by deterministic resource policy                                  | §VI.F         |
| 23  | Evaluating risk from command names                                    | Normalize the tool proposal                                                         | §VII.D        |
| 24  | Jev at every edge; exact conditions; open-ended content               | Placement discipline                                                                | §VII.F        |
| 25  | Faulty menu builder blamed on Jev                                     | Test the builder separately                                                         | §VIII.D       |
| 26  | TTL-only cache for permissions, budgets, controls                     | Event-driven invalidation                                                           | §VIII.H       |
| 27  | Praise-style option descriptions                                      | Evidence conditions; review or none where options overlap                           | §VIII.F       |
| 28  | No stop outcome                                                       | Declared stop with criteria                                                         | §VIII.G       |
| 29  | Primitive mismatch                                                    | Pick the primitive by answer shape; decompose                                       | §II.G         |
| 30  | Fake Score precision                                                  | Treat the score as an ordinal position                                              | §II.B         |
| 31  | Guardrails that depend on Jev confidence                              | Deterministic guardrails, independent of confidence                                 | §IX.I         |

## Where each failure is caught

- **Statically.** The contract lint and the workflow analyzers emit 45 Jev diagnostic codes
  (`JEV_DIAGNOSTIC_CODES`; errors start with `E_`, warnings with `W_`). Examples: `W_JEV_NO_ESCAPE_HATCH`
  (a Choice without an escape), `W_JEV_SINGLE_THRESHOLD`, `W_JEV_EXACT_RULE` (an exact comparison
  written as a question), `W_JEV_PRIMITIVE_MISMATCH`, `W_JEV_CONCLUSION_AS_EVIDENCE`,
  `W_JEV_OPTIONS_UNDISTINGUISHED`, `W_JEV_NO_STOP`, `E_JEV_IRREVERSIBLE_AUTO` and
  `E_JEV_AUTHORITY_EXCEEDED` (an auto route to an action outside the contract's allowed actions).
- **At run time.** Every routing decision records reasons such as `stale_option`,
  `blind_retry_blocked`, `provider_uncalibrated`, `packet_over_budget` and `state_race`. Each
  reason maps back to catalog rows, so a trace names the failure mode rather than "low confidence".
- **In review.** TraceReviewer reads the same signals, and the drift alarms point at what to
  inspect first ([calibration.md](calibration.md)).

## Inspect the harness before the model

When a decision is wrong, check in this order (§X.I Distinguish Model and Contract Error):

1. Did the state contain the necessary evidence?
2. Was the option set valid?
3. Did the instructions distinguish the outcomes?
4. Did the threshold map to the correct route?
5. Only then: model capability.

"This diagnostic order avoids compensating for harness errors with larger models, longer prompts,
or repeated calls" (§X.I). Table IX gives the same idea by symptom:

| Observed symptom              | Inspect first                            |
| ----------------------------- | ---------------------------------------- |
| High confidence, wrong branch | Evidence, menu completeness, calibration |
| Review rate rising            | State freshness and new option classes   |
| Costs rising                  | Wrong routes and recovery work           |
| Repeated loops                | Stop option and retry evidence           |
| Unsafe action                 | Authority boundary and policy order      |
| Schema valid, meaning wrong   | Criteria and representative tests        |

## Incident review

Reconstruct **state, contract, distribution, threshold, policy, action, outcome** from the receipt
([receipts.md](receipts.md)). "Identify the earliest incorrect boundary rather than the final
visible failure" (§X.O). Fix at the right place: state construction, menu generation, contract
wording, calibration, policy or execution. "Store representative incident states as permanent
regression fixtures. A fix is incomplete until the revised system produces the intended judgment
and route on those fixtures without weakening unrelated cases" (§X.O).

## Status

- **Built** (`@flowaid/jev`): the 31-row catalog, the 45 diagnostic codes with severities, reason and code lookups, the contract lint and the text lints. All are covered by tests.
- **Waiting on other packages**: the workflow-level analyzers inside the compiler, the TraceReviewer integration (observability) and the incident workbench (web).
