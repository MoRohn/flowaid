/**
 * `GET /v1/insights` on the Overview (FLOWAID_V2_ROADMAP 3.2, 4.1): the response types and the
 * pure helpers that turn it into "Needs attention" rows and "What changed" cards with links.
 */
import { serializeFilters } from "@flowaid/ui/data";
import type { TimeRangePreset } from "@flowaid/ui/observability";

export type InsightWindow = "24h" | "7d" | "30d";

export interface InsightEvidence {
  metric: string;
  recent: { value: number; n: number; interval?: { lo: number; hi: number } };
  baseline: { value: number; n: number; interval?: { lo: number; hi: number } };
  effect: { ratio?: number; points?: number };
  test: "fisher_exact" | "mann_whitney_u" | "novelty";
  pValue: number | null;
  qValue: number | null;
}

export interface Insight {
  id: string;
  kind: "failure_rate" | "latency" | "cost" | "confidence_drop" | "new_error";
  severity: "critical" | "warning" | "info";
  workflowId: string;
  workflowName: string;
  title: string;
  summary: string;
  evidence: InsightEvidence;
  attribution?: { versionId: string; version: number | null; share: number };
}

export interface InsightsReport {
  computedAt: string;
  window: { from: string; to: string };
  baseline: { from: string; to: string };
  attention: {
    openApprovals: { count: number; oldestAt: string | null; expiringSoon: number };
    failingWorkflows: {
      workflowId: string;
      workflowName: string;
      failed: number;
      finished: number;
    }[];
  };
  insights: Insight[];
}

/** The insight window that matches the dashboard's time range (short ranges use 24h). */
export function insightWindowFor(preset: TimeRangePreset): InsightWindow {
  return preset === "7d" ? "7d" : preset === "30d" || preset === "90d" ? "30d" : "24h";
}

/** Whether a response has the report's shape (anything else is treated as unavailable). */
export function isInsightsReport(v: unknown): v is InsightsReport {
  const r = v as Partial<InsightsReport> | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.attention?.openApprovals?.count === "number" &&
    Array.isArray(r.attention.failingWorkflows) &&
    Array.isArray(r.insights)
  );
}

/** Runs of one workflow in the report's window, optionally only failed ones. */
export function runsHref(
  ws: string,
  workflowId: string,
  window: { from: string; to: string },
  failedOnly = false,
): string {
  const query = serializeFilters({
    workflow: [workflowId],
    ...(failedOnly ? { status: ["failed", "timed_out"] } : {}),
    range: { preset: "custom", from: window.from, to: window.to },
  });
  return `/${ws}/runs?${query}`;
}

/** "3 hours", "2 days": how long ago an ISO time was, coarsely. */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (s < 90) return unit(Math.max(1, Math.round(s / 60)), "minute");
  if (s < 90 * 60) return unit(Math.round(s / 60), "minute");
  if (s < 36 * 3600) return unit(Math.round(s / 3600), "hour");
  return unit(Math.round(s / 86_400), "day");
}

const fixed = (v: number, d: number) => v.toFixed(d);
const sig = (p: number) => (p < 0.001 ? "< 0.001" : `= ${fixed(p, 3)}`);

/** The evidence as short lines a person can check: what was compared, how, and how sure. */
export function evidenceLines(e: InsightEvidence): string[] {
  const lines: string[] = [];
  const pct = (v: number) => `${fixed(v * 100, 1)}%`;
  if (e.test === "fisher_exact") {
    const ci = (s: InsightEvidence["recent"]) =>
      s.interval ? ` (95% CI ${pct(s.interval.lo)}–${pct(s.interval.hi)})` : "";
    lines.push(`Recent: ${pct(e.recent.value)} of ${e.recent.n} runs${ci(e.recent)}`);
    lines.push(`Before: ${pct(e.baseline.value)} of ${e.baseline.n} runs${ci(e.baseline)}`);
    if (e.effect.points !== undefined) lines.push(`Change: +${fixed(e.effect.points, 1)} points`);
  } else if (e.test === "mann_whitney_u") {
    lines.push(`${e.metric}: ${e.recent.n} recent against ${e.baseline.n} earlier values`);
    if (e.effect.ratio !== undefined) lines.push(`Ratio of medians: ×${fixed(e.effect.ratio, 2)}`);
  } else {
    lines.push(`${e.recent.value} of ${e.recent.n} recent runs; 0 of ${e.baseline.n} before`);
  }
  const test = {
    fisher_exact: "Fisher's exact test (one-sided)",
    mann_whitney_u: "Mann–Whitney U test (one-sided)",
    novelty: "New since the baseline (no test)",
  }[e.test];
  lines.push(
    e.pValue !== null && e.qValue !== null
      ? `${test}: p ${sig(e.pValue)}, q ${sig(e.qValue)} after Benjamini–Hochberg`
      : test,
  );
  return lines;
}
