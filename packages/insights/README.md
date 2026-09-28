# @flowaid/insights

Change detection over run history: a recent window of a workflow's runs against its baseline,
reported only when a change is statistically significant after Benjamini–Hochberg, practically
large, and backed by enough data. Pure and browser-safe; the caller loads the data (the API's
`GET /v1/insights` does, see [docs/data/INSIGHTS.md](../../docs/data/INSIGHTS.md)).

```ts
import { detectChanges } from "@flowaid/insights";

const insights = detectChanges([{ workflowId, workflowName, recent, baseline }]);
// → [{ kind: "failure_rate", severity: "critical", title, summary,
//      evidence: { recent, baseline, effect, test: "fisher_exact", pValue, qValue },
//      attribution?: { versionId, share } }]
```

| export                                      | what it is                                                        |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `detectChanges`                             | failure rate, latency, cost, decision confidence, new error codes |
| `attributeVersion`                          | a version that ran most recent runs and no baseline runs          |
| `fisherExactGreater`                        | one-sided Fisher's exact test on a 2×2 table                      |
| `mannWhitney`                               | Mann–Whitney U with tie and continuity corrections                |
| `benjaminiHochberg`                         | q-values controlling the false discovery rate                     |
| `wilson`, `median`, `normalCdf`, `logGamma` | helpers                                                           |

Validated against reference values and by simulation (false-positive rate and power); the
numbers are in [docs/FLOWAID_AI_EVALUATION.md](../../docs/FLOWAID_AI_EVALUATION.md) §2.
