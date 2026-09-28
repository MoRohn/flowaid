/**
 * Change detection per workflow: a recent window against a baseline window. An insight is
 * reported only when it is statistically significant after Benjamini–Hochberg across every test
 * in the call *and* practically large, and only above minimum sample sizes. Every insight carries
 * the numbers it rests on.
 *
 * | kind              | question                                   | test                         |
 * | ----------------- | ------------------------------------------ | ---------------------------- |
 * | `failure_rate`    | do more finished runs fail?                | Fisher's exact, one-sided    |
 * | `latency`         | are runs slower (runs without human waits)? | Mann–Whitney U, one-sided   |
 * | `cost`            | does a run cost more?                      | Mann–Whitney U, one-sided    |
 * | `confidence_drop` | are decisions less confident?              | Mann–Whitney U, one-sided    |
 * | `new_error`       | is there an error code the baseline never had? | novelty (count threshold) |
 */
import { benjaminiHochberg, fisherExactGreater, mannWhitney, median, wilson } from "./stats.js";

/** What one window of one workflow looked like. Samples may be capped by the caller. */
export interface WindowData {
  /** finished runs (completed, failed, timed out) */
  finished: number;
  /** runs that failed or timed out */
  failed: number;
  /** wall-clock duration (ms) of completed runs that never waited for a person */
  durationsMs: readonly number[];
  /** cost (USD) of finished runs */
  costsUsd: readonly number[];
  /** decision confidence (0..1) of decision nodes */
  confidences: readonly number[];
  /** error code → runs */
  errorCodes: Readonly<Record<string, number>>;
  /** workflow version id → runs */
  versions: Readonly<Record<string, number>>;
}

export interface WorkflowWindows {
  workflowId: string;
  workflowName: string;
  recent: WindowData;
  baseline: WindowData;
}

export type InsightKind = "failure_rate" | "latency" | "cost" | "confidence_drop" | "new_error";
export type InsightSeverity = "critical" | "warning" | "info";

export interface WindowSummary {
  /** the compared statistic: failure proportion, median ms, median USD, median confidence, count */
  value: number;
  n: number;
  /** 95% interval where one is defined (Wilson, for proportions) */
  interval?: { lo: number; hi: number };
}

export interface InsightEvidence {
  metric: string;
  recent: WindowSummary;
  baseline: WindowSummary;
  /** recent ÷ baseline for medians; percentage points for proportions */
  effect: { ratio?: number; points?: number };
  test: "fisher_exact" | "mann_whitney_u" | "novelty";
  pValue: number | null;
  /** Benjamini–Hochberg q-value over every test in this call */
  qValue: number | null;
}

export interface Insight {
  /** stable across calls for the same finding (kind, workflow, and error code) */
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  workflowId: string;
  workflowName: string;
  title: string;
  summary: string;
  evidence: InsightEvidence;
  /** a version that most recent runs ran and the baseline never did */
  attribution?: { versionId: string; share: number };
}

export interface DetectOptions {
  /** false discovery rate (default 0.05) */
  alpha?: number;
  /** minimum finished runs in each window for the failure test (default 20) */
  minRuns?: number;
  /** minimum values in each sample for the rank tests (default 20) */
  minSamples?: number;
  /** failure rate: minimum increase in points (default 5) and ratio (default 1.5) */
  minFailurePoints?: number;
  minFailureRatio?: number;
  /** latency and cost: minimum ratio of medians (default 1.25) */
  minMedianRatio?: number;
  /** confidence: minimum drop of the median (default 0.05) */
  minConfidenceDrop?: number;
  /** new error code: minimum recent runs with it (default 3) */
  minNewErrorCount?: number;
}

const DEFAULTS: Required<DetectOptions> = {
  alpha: 0.05,
  minRuns: 20,
  minSamples: 20,
  minFailurePoints: 5,
  minFailureRatio: 1.5,
  minMedianRatio: 1.25,
  minConfidenceDrop: 0.05,
  minNewErrorCount: 3,
};

interface Candidate {
  insight: Omit<Insight, "severity" | "title" | "summary" | "attribution">;
  p: number;
  practical: boolean;
  windows: WorkflowWindows;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ms = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const usd = (v: number) => `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
const total = (r: Readonly<Record<string, number>>) => Object.values(r).reduce((a, b) => a + b, 0);

/** Detects changes in each workflow's recent window against its baseline. */
export function detectChanges(
  workflows: readonly WorkflowWindows[],
  options: DetectOptions = {},
): Insight[] {
  const o = { ...DEFAULTS, ...options };
  const candidates: Candidate[] = [];
  const novel: Insight[] = [];

  for (const w of workflows) {
    const base = { workflowId: w.workflowId, workflowName: w.workflowName };
    const { recent: r, baseline: b } = w;

    if (r.finished >= o.minRuns && b.finished >= o.minRuns) {
      const pr = r.failed / r.finished;
      const pb = b.failed / b.finished;
      const points = (pr - pb) * 100;
      candidates.push({
        windows: w,
        p: fisherExactGreater(r.failed, r.finished - r.failed, b.failed, b.finished - b.failed),
        practical:
          points >= o.minFailurePoints && (pb === 0 ? pr > 0 : pr / pb >= o.minFailureRatio),
        insight: {
          ...base,
          id: `failure_rate:${w.workflowId}`,
          kind: "failure_rate",
          evidence: {
            metric: "failure rate of finished runs",
            recent: { value: pr, n: r.finished, interval: wilson(r.failed, r.finished) },
            baseline: { value: pb, n: b.finished, interval: wilson(b.failed, b.finished) },
            effect: { points, ...(pb > 0 ? { ratio: pr / pb } : {}) },
            test: "fisher_exact",
            pValue: null,
            qValue: null,
          },
        },
      });
    }

    const shift = (
      kind: "latency" | "cost" | "confidence_drop",
      metric: string,
      x: readonly number[],
      y: readonly number[],
    ) => {
      if (x.length < o.minSamples || y.length < o.minSamples) return;
      const mr = median(x);
      const mb = median(y);
      const drop = kind === "confidence_drop";
      const test = mannWhitney(x, y, drop ? "less" : "greater");
      const ratio = mb > 0 ? mr / mb : mr > 0 ? Infinity : 1;
      candidates.push({
        windows: w,
        p: test.p,
        practical: drop ? mb - mr >= o.minConfidenceDrop : ratio >= o.minMedianRatio,
        insight: {
          ...base,
          id: `${kind}:${w.workflowId}`,
          kind,
          evidence: {
            metric,
            recent: { value: mr, n: x.length },
            baseline: { value: mb, n: y.length },
            effect: Number.isFinite(ratio) ? { ratio } : {},
            test: "mann_whitney_u",
            pValue: null,
            qValue: null,
          },
        },
      });
    };
    shift(
      "latency",
      "median run duration (runs without human waits)",
      r.durationsMs,
      b.durationsMs,
    );
    shift("cost", "median cost per finished run", r.costsUsd, b.costsUsd);
    shift("confidence_drop", "median decision confidence", r.confidences, b.confidences);

    // An error code the baseline never produced, over a baseline large enough to have shown it.
    if (b.finished >= o.minRuns) {
      for (const [code, count] of Object.entries(r.errorCodes)) {
        if (count < o.minNewErrorCount || (b.errorCodes[code] ?? 0) > 0) continue;
        novel.push(
          finish(
            {
              ...base,
              id: `new_error:${w.workflowId}:${code}`,
              kind: "new_error",
              evidence: {
                metric: `runs failing with ${code}`,
                recent: { value: count, n: r.finished },
                baseline: { value: 0, n: b.finished },
                effect: {},
                test: "novelty",
                pValue: null,
                qValue: null,
              },
            },
            w,
            code,
          ),
        );
      }
    }
  }

  const q = benjaminiHochberg(candidates.map((c) => c.p));
  const significant = candidates.flatMap((c, i) => {
    const qi = q[i] ?? 1;
    if (!c.practical || qi > o.alpha) return [];
    c.insight.evidence.pValue = c.p;
    c.insight.evidence.qValue = qi;
    return [finish(c.insight, c.windows)];
  });

  const rank: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...significant, ...novel].sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.evidence.qValue ?? 1) - (b.evidence.qValue ?? 1) ||
      a.id.localeCompare(b.id),
  );
}

/** The version most recent runs ran that the baseline never ran, if it carries ≥ half of them. */
export function attributeVersion(
  recent: Readonly<Record<string, number>>,
  baseline: Readonly<Record<string, number>>,
): { versionId: string; share: number } | undefined {
  const n = total(recent);
  if (n === 0) return undefined;
  let best: { versionId: string; share: number } | undefined;
  for (const [versionId, count] of Object.entries(recent)) {
    if ((baseline[versionId] ?? 0) > 0) continue;
    const share = count / n;
    if (share >= 0.5 && (!best || share > best.share)) best = { versionId, share };
  }
  return best;
}

function finish(i: Candidate["insight"], w: WorkflowWindows, code?: string): Insight {
  const e = i.evidence;
  const attribution = attributeVersion(w.recent.versions, w.baseline.versions);
  const since = attribution ? " since a new version" : "";
  let severity: InsightSeverity;
  let title: string;
  let summary: string;
  switch (i.kind) {
    case "failure_rate":
      severity = e.recent.value >= 0.5 || (e.effect.points ?? 0) >= 20 ? "critical" : "warning";
      title = `${w.workflowName} fails more often${since}`;
      summary = `${pct(e.recent.value)} of ${e.recent.n} finished runs failed, against ${pct(e.baseline.value)} of ${e.baseline.n} before.`;
      break;
    case "latency":
      severity = (e.effect.ratio ?? 0) >= 2 ? "warning" : "info";
      title = `${w.workflowName} got slower${since}`;
      summary = `The median run took ${ms(e.recent.value)} (${e.recent.n} runs), against ${ms(e.baseline.value)} (${e.baseline.n} runs) before.`;
      break;
    case "cost":
      severity = (e.effect.ratio ?? 0) >= 2 ? "warning" : "info";
      title = `${w.workflowName} costs more per run${since}`;
      summary = `The median run cost ${usd(e.recent.value)} (${e.recent.n} runs), against ${usd(e.baseline.value)} (${e.baseline.n} runs) before.`;
      break;
    case "confidence_drop":
      severity = "warning";
      title = `${w.workflowName}'s decisions are less confident${since}`;
      summary = `Median decision confidence is ${e.recent.value.toFixed(2)} over ${e.recent.n} decisions, against ${e.baseline.value.toFixed(2)} over ${e.baseline.n} before.`;
      break;
    case "new_error":
      severity = "warning";
      title = `${w.workflowName} has a new error: ${code ?? "unknown"}`;
      summary = `${e.recent.value} of ${e.recent.n} recent runs failed with ${code ?? "it"}; none of the ${e.baseline.n} earlier runs did.`;
      break;
  }
  return { ...i, severity, title, summary, ...(attribution ? { attribution } : {}) };
}
