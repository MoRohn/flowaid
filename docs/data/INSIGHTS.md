# Insights: data and statistics

`GET /v1/insights` answers two questions for the Overview (and for Ask FlowAId's `get_insights`
tool): **what needs attention now**, and **what changed**. It uses data the runtime already
records. V2 adds no tables and no collection.

## Data used

| source                           | columns                                                                                                                                          | used for                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `runs`                           | `workflow_id`, `workflow_version_id`, `environment_id`, `origin`, `status`, `error->>'code'`, `cost_usd`, `created_at`, `started_at`, `ended_at` | failure rate, error codes, cost, latency, version attribution        |
| `node_runs`                      | `decision_confidence`, `started_at`                                                                                                              | decision confidence                                                  |
| `human_tasks`                    | `status`, `created_at`, `expires_at`, `run_id`                                                                                                   | open approvals; excluding runs that waited for a person from latency |
| `workflows`, `workflow_versions` | `name`, `version`                                                                                                                                | labels                                                               |

**Only production traffic counts.** The origins `api`, `ui`, `webhook`, `schedule`, `mcp` and
`subflow` are included. Evaluation runs would inflate volume, and replays, restarts and forks
reuse recorded results, which pulls latency and cost toward zero. The dashboard metrics use the
same default since V2; pass `origin=all` to include every run.

## Windows

The recent window is 24 hours, 7 days or 30 days. The baseline is the four windows just before
it, for example the last 7 days against the 4 weeks before. Runs are placed in a window by
`created_at`.

For each workflow and window the API loads:

- exact counts: finished runs, failed or timed-out runs, error codes, versions;
- samples capped at the newest 1,000 values: durations of completed runs that never waited for a
  person, and costs of finished runs;
- decision confidences, capped the same way.

## Detection (`@flowaid/insights`)

| kind              | test                             | reported when                                                                   | severity                                      |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| `failure_rate`    | Fisher's exact, one-sided        | at least 20 finished runs in each window, q < 0.05, +5 points and ×1.5          | critical at ≥ 50% or +20 points, else warning |
| `latency`         | Mann–Whitney U, one-sided        | at least 20 samples each, q < 0.05, ratio of medians ≥ 1.25                     | warning at ×2, else notice                    |
| `cost`            | Mann–Whitney U, one-sided        | same                                                                            | warning at ×2, else notice                    |
| `confidence_drop` | Mann–Whitney U, one-sided (less) | same, median drop ≥ 0.05                                                        | warning                                       |
| `new_error`       | novelty                          | at least 3 recent runs with a code never seen in a baseline of at least 20 runs | warning                                       |

- **Multiple comparisons.** Benjamini–Hochberg runs across every test in one request: all
  workflows and all four metrics. With many workflows, chance findings stay rare. In simulation
  the false-positive rate is 3.5%; see [FLOWAID_AI_EVALUATION.md](../FLOWAID_AI_EVALUATION.md) §2.
- **Evidence.** Each insight carries the compared values, the sample sizes, Wilson 95% intervals
  for proportions, the effect (points or ratio), the test, and the p- and q-values. The Overview
  shows them under "Evidence".
- **Attribution.** When one version ran at least half the recent runs and no baseline runs, the
  insight names it. The UI states it as a coincidence, not a cause.

## Attention

- **Open approvals:** the count, the oldest one, and how many expire within 24 hours.
- **Workflows with failed production runs** in the recent window: the top 5 by number of failures.

## Performance

Six aggregate queries run in parallel. All of them filter `runs` by workspace and `created_at`,
which the existing `(workspace_id, created_at)` and `(workflow_id, created_at)` indexes serve.
Sample queries use `row_number()` per workflow and window to cap the rows returned. The Overview
refetches every 60 seconds. There is no server-side cache: for local-first workloads (thousands
to low millions of runs) the queries are cheap. A daily rollup table is the planned step if a
workspace outgrows that.

## Data lifecycle

The retention sweep, which runs since V2, deletes `run_events` and `node_runs` after their
retention class (90 days for standard) but keeps `runs` rows. Failure-rate, latency and cost
baselines therefore survive retention. Decision-confidence baselines older than the `node_runs`
retention do not.

## Not done, on purpose

- **No trained models.** Per-workflow samples on one machine are small. Classical tests give
  honest, explainable answers, and a model trained on them would not be more accurate.
- **No forecasting.** Planned when a workspace has at least 30 days of history, together with
  daily rollups.
- **Calibration of Jev decisions in the product.** `@flowaid/jev` has the statistics, but it
  needs a labelling workflow first.
