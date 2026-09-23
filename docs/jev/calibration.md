# Calibration

> "Calibration asks whether events predicted near a probability occur at roughly that frequency on
> the target workload." (§V.C Calibration)

Automation depends on "whether higher confidence actually identifies safer cases" (§V.C). FlowAId
measures that per contract version, per segment, on labeled production data. It raises drift
alarms and recommends thresholds for people to accept. The implementation is in
[`packages/jev/src/calibration/`](../../packages/jev/src/calibration/); the normative design is
[`JEV_ENGINEERING.md` §7](../design/JEV_ENGINEERING.md).

## Never a global number

"Segment metrics by contract version, consequence class, language, and rare option; a global
average can hide the branch that matters most" (§V.D). A calibration snapshot is keyed by contract
key **and version** plus a segment: environment, consequence class, language, outcome, resolved
model, mode (`live` or `shadow`) and rollout disposition. Changing the contract version, the state
spec or the resolved model starts new segments. "Moving the same contract to a new language,
product area, or user population may invalidate the previous curve" (§V.F).

## Labels

Labels come from reviewers working a queue with the contract's written rubric, from in-run human
review (a confirmation or an override), from sampled review of automated receipts, and from
adjudication. Fixture labels never mix with production calibration.

**Sampling with correction.** "Oversample rare, consequential, and near-threshold examples. Random
samples alone may produce a reassuring aggregate while leaving the automation boundary poorly
measured" (§V.F). `matchStrata` finds the strata a decision belongs to (near threshold, rare
outcome, high consequence, escape outcome, auto route, new version, shadow disagreement), and
`sampleForLabel` includes it with the highest matching rate. The draw is deterministic, taken from
a hash of the receipt id. The inclusion probability π is stored with the label, and every metric
weights labeled receipts by 1/π (Horvitz–Thompson), so oversampling sharpens the boundary without
biasing the totals.

**Adjudication.** "If reviewers disagree systematically, the contract may be ambiguous rather than
the model inaccurate. Preserve disagreement instead of forcing premature consensus" (§IX.E).
`adjudicate` folds a receipt's labels into `single`, `agreed`, `disputed` or `adjudicated`.
Disputed receipts are left out of accuracy until adjudicated but always count towards inter-rater
disagreement. For consequential branches reviewers also label the **permitted route**, which
"distinguishes a correct judgment from an unsafe automation policy" (§IX.E).

## Metrics

`calibrationMetrics(observations, options)` computes, for one segment:

| Metric                 | Definition                                                                      | Handbook                             |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| Reliability bins       | 10 equal-width bins; weighted mean confidence and accuracy per bin              | Fig. 2 reliability diagram           |
| ECE / ACE / MCE        | Weighted gap between confidence and accuracy (equal-width, equal-mass, maximum) | FlowAId's; the handbook names no ECE |
| Brier (Noul)           | Mean squared error of raw P(yes) against the label                              | §V.D                                 |
| Classwise ECE (Choice) | Per option: p_k against label = k, with support                                 | §V.D "rare options"                  |
| Multiclass Brier       | Σ_k (p_k − 1[label = k])²                                                       | FlowAId's                            |
| RPS (Score)            | Ranked probability score over ordered levels                                    | FlowAId's                            |
| Auto precision         | Accuracy of `auto`-routed labeled receipts, with a Wilson 95 % lower bound      | §IX.F "strong calibration"           |
| Route correctness      | Share of labeled receipts whose route equals the permitted route                | §IX.E dual labels                    |
| Near-threshold mass    | Share of decisions just above and just below `autoAt`                           | §V.C Threshold Governance            |
| PSI                    | Shift of the confidence histogram against a baseline                            | §IX.H drift                          |
| Operational rates      | Route shares, escape, override, stale option, blind retry blocked, disagreement | §IX.E, §IX.H                         |

Noul is measured on raw P(yes) against `label = true`, because "Noul is interpreted as yes-or-no
uncertainty" (§XI.B launch checklist). Score is ordinal: 1.6 on a five-level scale is a position,
not "80 percent good" (§II.B).

## Drift alarms

`driftAlarms(window, baseline)` compares a 7-day window with a baseline. The handbook gives no
numbers, so these defaults are FlowAId's. Each alarm names what to **inspect first**, following
Table IX: "Many apparent model defects originate elsewhere in the harness."

| Alarm                   | Fires when                                      | Inspect first                            |
| ----------------------- | ----------------------------------------------- | ---------------------------------------- |
| `ece_rise`              | ECE +0.03 with ≥ 50 labeled (+0.06 is critical) | evidence, menu completeness, calibration |
| `review_rate_rise`      | human share × 1.5 with ≥ 200 decisions          | state freshness, new option classes      |
| `escape_rate_rise`      | escape share × 2 with ≥ 200 decisions           | a new option class                       |
| `near_threshold_mass`   | ≥ 15 % just above `autoAt`                      | calibration, contract wording            |
| `confidence_shift`      | PSI ≥ 0.2 (0.3 is critical)                     | state freshness                          |
| `override_rate`         | overrides ≥ 5 % of ≥ 50 automated decisions     | evidence, calibration, policy order      |
| `model_version_changed` | resolved model differs from the baseline        | recompute segments                       |
| `label_disagreement`    | inter-rater disagreement ≥ 20 %                 | contract wording                         |
| `stale_options`         | stale-option decisions ≥ 1 %                    | menu construction                        |
| `monotonicity`          | fixture ladders violated > 10 %                 | contract wording, evidence               |

## Threshold recommendations

`recommendThresholds` searches `autoAt` from 0.50 to 0.99 and picks the smallest threshold whose
Wilson 95 % lower bound on precision meets the target for the consequence class: 0.95 for low,
0.98 for medium, 0.995 for high. It also needs enough labeled decisions in the automated region
(100, 200 or 400), segment ECE of at most 0.05, and near-threshold mass of at most 15 %. It never
recommends automation for irreversible consequences. It can also suggest an `improveAt` below
which evidence collection is unlikely to help.

Recommendations are **never applied automatically**. Accepting one creates a contract draft with
the threshold governance record filled in (owner, rationale citing the numbers, window, rollback
condition). The draft then goes through review and rollout like any other change.

## When calibration is measured

"Calibration should be estimated in shadow mode, checked again after automation, and recalculated
after material contract or state-schema changes" (§V.F). Shadow snapshots gate promotion (see
[shadow-mode-and-rollout.md](shadow-mode-and-rollout.md)). Promotion freezes them as the version's
`shadow_baseline`, and canary snapshots are compared against that baseline.

## Status

- **Built** (`@flowaid/jev`): label, sampling, metric, segment, alarm and snapshot schemas; `calibrationMetrics`, `reliabilityBins`, ECE/ACE/MCE, Brier, RPS, `wilsonLower`, `psi`; `matchStrata`, `sampleForLabel`, `adjudicate`, `interRaterDisagreement`; `driftAlarms`; `recommendThresholds`. All are covered by tests.
- **Waiting on other packages**: the hourly `jev.calibrate` job and the calibration tables (worker, database).
