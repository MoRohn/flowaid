/**
 * Shadow-mode summary (JEV_ENGINEERING.md §11.2 `summarizeShadow`, §IX.D):
 * agreement, a production × shadow confusion matrix, accuracy of each side
 * against human labels, the would-route mix and the disagreement list.
 * Agreement is not accuracy: the production path can be wrong.
 */
import type { JevPathEconomics, JevRoute, JevShadowComparison } from "./types";

export interface SideAccuracy {
  correct: number;
  labeled: number;
  rate: number | null;
}

export interface ShadowSummary {
  total: number;
  /** Comparisons whose production answer mapped into the contract's outcomes. */
  comparable: number;
  agreed: number;
  agreementRate: number | null;
  /** Row/column order of the matrix: outcomes by production frequency, then shadow-only outcomes. */
  outcomes: string[];
  /** matrix[production][shadow] = count, over comparable comparisons. */
  matrix: Record<string, Record<string, number>>;
  unmappable: number;
  production: SideAccuracy;
  shadow: SideAccuracy;
  wouldRoute: Record<JevRoute, number>;
  /** Disagreements, most confident shadow answer first (oversampled for labeling). */
  disagreements: JevShadowComparison[];
}

function accuracy(correct: number, labeled: number): SideAccuracy {
  return { correct, labeled, rate: labeled > 0 ? correct / labeled : null };
}

export function summarizeShadowComparisons(
  comparisons: readonly JevShadowComparison[],
): ShadowSummary {
  const freq = new Map<string, number>();
  const shadowOnly = new Set<string>();
  const matrix: Record<string, Record<string, number>> = {};
  const wouldRoute: Record<JevRoute, number> = { auto: 0, improve: 0, human: 0 };
  let comparable = 0;
  let agreed = 0;
  let unmappable = 0;
  let prodCorrect = 0;
  let prodLabeled = 0;
  let shadowCorrect = 0;
  let shadowLabeled = 0;

  for (const c of comparisons) {
    wouldRoute[c.shadow.wouldRoute] += 1;
    if (c.humanLabel !== null) {
      shadowLabeled += 1;
      if (c.shadow.outcome === c.humanLabel) shadowCorrect += 1;
      if (c.production.answer !== null) {
        prodLabeled += 1;
        if (c.production.answer === c.humanLabel) prodCorrect += 1;
      }
    }
    const prod = c.production.answer;
    if (prod === null || c.agree === null) {
      unmappable += 1;
      continue;
    }
    comparable += 1;
    if (c.agree) agreed += 1;
    freq.set(prod, (freq.get(prod) ?? 0) + 1);
    shadowOnly.add(c.shadow.outcome);
    const row = (matrix[prod] ??= {});
    row[c.shadow.outcome] = (row[c.shadow.outcome] ?? 0) + 1;
  }

  const outcomes = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
  for (const k of [...shadowOnly].sort()) if (!outcomes.includes(k)) outcomes.push(k);
  const total = comparisons.length;
  const routeShare: Record<JevRoute, number> = {
    auto: total ? wouldRoute.auto / total : 0,
    improve: total ? wouldRoute.improve / total : 0,
    human: total ? wouldRoute.human / total : 0,
  };

  return {
    total,
    comparable,
    agreed,
    agreementRate: comparable > 0 ? agreed / comparable : null,
    outcomes,
    matrix,
    unmappable,
    production: accuracy(prodCorrect, prodLabeled),
    shadow: accuracy(shadowCorrect, shadowLabeled),
    wouldRoute: routeShare,
    disagreements: comparisons
      .filter((c) => c.agree === false)
      .slice()
      .sort((a, b) => b.shadow.confidence - a.shadow.confidence),
  };
}

/** Count in one matrix cell (0 when absent). */
export function matrixCount(summary: ShadowSummary, production: string, shadow: string): number {
  return summary.matrix[production]?.[shadow] ?? 0;
}

export interface EconomicsComparison {
  /** shadow / production cost per decision; < 1 is cheaper. */
  costRatio: number | null;
  /** shadow p50 − production p50, ms (negative is faster). */
  p50DeltaMs: number;
  p95DeltaMs: number;
}

export function compareEconomics(
  production: JevPathEconomics,
  shadow: JevPathEconomics,
): EconomicsComparison {
  return {
    costRatio:
      production.costUsdPerDecision > 0
        ? shadow.costUsdPerDecision / production.costUsdPerDecision
        : null,
    p50DeltaMs: shadow.p50Ms - production.p50Ms,
    p95DeltaMs: shadow.p95Ms - production.p95Ms,
  };
}
