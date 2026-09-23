/**
 * Pure helpers shared by the decision visualisations. Every component in this
 * group accepts a distribution either as the runtime's `Record<option, p>` or
 * as an explicit ordered list, and normalises it through `normalizeDistribution`.
 * The readouts take the spec-exact `DecisionResult` kinds from
 * `@flowaid/workflow-core` (CONTRACTS.ts §7).
 */
import type { BooleanDecision, DecisionResult, ScoreDecision } from "@/types";
import { assertNever } from "@/types";

export interface DistributionEntry {
  /** Option key (choice) or level index as a string (score). */
  key: string;
  /** Human label; falls back to `key`. */
  label?: string;
  /** Probability in [0, 1] after normalisation. */
  probability: number;
}

export type DistributionInput = Record<string, number> | DistributionEntry[];

export interface NormalizeOptions {
  /** Label lookup, e.g. a score legend. */
  labels?: Record<string, string>;
  /** Sort descending by probability (default true). Off keeps the input order (ordinal scales). */
  sort?: boolean;
}

function finiteOrZero(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Converts either input shape into a list whose probabilities sum to 1.
 * Non-finite or negative values count as 0; an all-zero input becomes a
 * uniform distribution so the visuals never divide by zero.
 */
export function normalizeDistribution(
  input: DistributionInput,
  opts: NormalizeOptions = {},
): DistributionEntry[] {
  const raw: DistributionEntry[] = Array.isArray(input)
    ? input.map((e) => ({ ...e, probability: finiteOrZero(e.probability) }))
    : Object.entries(input).map(([key, p]) => ({ key, probability: finiteOrZero(p) }));
  const labelled = raw.map((e) => ({
    ...e,
    label: e.label ?? opts.labels?.[e.key] ?? e.key,
  }));
  const total = labelled.reduce((s, e) => s + e.probability, 0);
  const normalised =
    total > 0
      ? labelled.map((e) => ({ ...e, probability: e.probability / total }))
      : labelled.map((e) => ({ ...e, probability: labelled.length ? 1 / labelled.length : 0 }));
  if (opts.sort === false) return normalised;
  return normalised.slice().sort((a, b) => b.probability - a.probability);
}

/** Key of the most probable entry, or undefined for an empty distribution. */
export function argmax(entries: DistributionEntry[]): string | undefined {
  let best: DistributionEntry | undefined;
  for (const e of entries) if (!best || e.probability > best.probability) best = e;
  return best?.key;
}

/** Probability ramp token for a segment: the chosen one is `--p-1`, the rest descend `--p-2..4`. */
export function rampVar(rank: number, chosen: boolean): string {
  if (chosen) return "var(--p-1)";
  return `var(--p-${Math.min(4, Math.max(2, rank + 2))})`;
}

/**
 * Ordered level labels for a score decision. Accepts the runtime's ordered
 * `levels[]` as is, or a legend keyed by level index (older fixtures, JSON
 * views) which is sorted numerically.
 */
function isLevelList(
  levels: readonly string[] | Record<string, string>,
): levels is readonly string[] {
  return Array.isArray(levels);
}

export function scoreLevels(
  levels: readonly string[] | Record<string, string> | undefined,
): string[] {
  if (!levels) return [];
  if (isLevelList(levels)) return [...levels];
  const legend = levels;
  return Object.keys(legend)
    .map((k) => [Number(k), legend[k] ?? k] as const)
    .filter(([i]) => Number.isFinite(i))
    .sort((a, b) => a[0] - b[0])
    .map(([, label]) => label);
}

/** Legend (`"0".."n-1"` → label) for a score decision's `levels[]`, the shape `normalizeDistribution` labels with. */
export function scoreLegend(levels: readonly string[]): Record<string, string> {
  const legend: Record<string, string> = {};
  levels.forEach((label, i) => {
    legend[String(i)] = label;
  });
  return legend;
}

/** Boolean readout: which answer, and how likely it is. */
export function noulReadout(pYes: number): { answer: "yes" | "no"; probability: number } {
  const p = Number.isFinite(pYes) ? Math.min(1, Math.max(0, pYes)) : 0.5;
  return p >= 0.5 ? { answer: "yes", probability: p } : { answer: "no", probability: 1 - p };
}

/** Score decision helpers: the numeric value and the level label it rounds to. */
export function scoreReadout(result: Pick<ScoreDecision, "value" | "levels">): {
  score: number;
  level: string | undefined;
  levels: string[];
} {
  const levels = scoreLevels(result.levels);
  const score = Number(result.value);
  const idx = Math.round(score);
  const level = Number.isFinite(idx) ? levels[idx] : undefined;
  return { score, level, levels };
}

/** Compact inline text for a decision: "security 0.81", "yes 0.96", "3.7 High". */
export function decisionSummary(result: DecisionResult): { value: string; number: string } {
  switch (result.kind) {
    case "boolean": {
      const r = noulReadout(noulProbability(result));
      return { value: r.answer, number: r.probability.toFixed(2) };
    }
    case "score": {
      const { score, level } = scoreReadout(result);
      return { value: level ?? "", number: Number.isFinite(score) ? score.toFixed(1) : "—" };
    }
    case "choice":
      return { value: result.value, number: result.confidence.toFixed(2) };
    default:
      return assertNever(result, "decision kind");
  }
}

/** P(yes) for a boolean result: the runtime stores it as `pYes` (`confidence = max(pYes, 1 − pYes)`). */
export function noulProbability(result: Pick<BooleanDecision, "pYes">): number {
  const p = result.pYes;
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5;
}
