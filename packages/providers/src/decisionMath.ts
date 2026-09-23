/**
 * Shared decision math for the non-TypeSafe decision providers (ARCHITECTURE.md §6.4, §6.5):
 * building spec-exact DecisionResults from probabilities, renormalisation, and the fuzzy option
 * match used when a model paraphrases an option key.
 */
import type {
  BooleanDecision,
  ChoiceDecision,
  JsonValue,
  ScoreDecision,
  TokenUsage,
} from "@flowaid/workflow-core";

export interface ResultMeta {
  provider: string;
  model: string;
  latencyMs: number;
  costUsd: number;
  usage?: TokenUsage;
  requestId?: string;
  raw?: JsonValue;
}

function meta(m: ResultMeta) {
  const out: Omit<BooleanDecision, "kind" | "value" | "pYes" | "probabilities" | "confidence"> = {
    provider: m.provider,
    model: m.model,
    latencyMs: Math.max(0, Math.round(m.latencyMs)),
    costUsd: Math.max(0, m.costUsd),
    attempts: [],
  };
  if (m.usage) out.usage = m.usage;
  if (m.requestId !== undefined) out.requestId = m.requestId;
  if (m.raw !== undefined) out.raw = m.raw;
  return out;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Boolean: `value = pYes ≥ threshold`, `confidence = max(pYes, 1 − pYes)`. */
export function booleanDecision(pYes: number, m: ResultMeta, threshold = 0.5): BooleanDecision {
  const p = clamp01(pYes);
  return {
    kind: "boolean",
    value: p >= threshold,
    pYes: p,
    probabilities: { true: p, false: 1 - p },
    confidence: Math.max(p, 1 - p),
    ...meta(m),
  };
}

/** Choice: `value` is the most probable key (ties: first in option order), `confidence` its probability. */
export function choiceDecision(
  probabilities: Record<string, number>,
  m: ResultMeta,
  opts: { value?: string; confidenceFactor?: number } = {},
): ChoiceDecision {
  const entries = Object.entries(probabilities);
  let best = entries[0]?.[0] ?? "";
  let bestP = -1;
  for (const [key, p] of entries) {
    if (p > bestP) {
      best = key;
      bestP = p;
    }
  }
  const value = opts.value ?? best;
  const confidence = clamp01((probabilities[value] ?? 0) * (opts.confidenceFactor ?? 1));
  return { kind: "choice", value, probabilities: { ...probabilities }, confidence, ...meta(m) };
}

/** Score over n levels: `value = Σ i·pᵢ`, `level = round(value)`, `confidence = max pᵢ`. */
export function scoreDecision(
  probabilities: readonly number[],
  levels: readonly string[],
  m: ResultMeta,
): ScoreDecision {
  const n = levels.length;
  const value = probabilities.reduce((sum, p, i) => sum + i * p, 0);
  const level = Math.min(n - 1, Math.max(0, Math.round(value)));
  const keyed: Record<string, number> = {};
  probabilities.forEach((p, i) => (keyed[String(i)] = p));
  return {
    kind: "score",
    value,
    normalized: n > 1 ? value / (n - 1) : 0,
    level,
    levelLabel: levels[level] ?? "",
    levels: [...levels],
    probabilities: keyed,
    confidence: clamp01(Math.max(0, ...probabilities)),
    ...meta(m),
  };
}

/** Renormalises when the sum is plausibly a rounding error (∈ [0.9, 1.1]); null otherwise. */
export function renormalise(values: readonly number[]): number[] | null {
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum < 0.9 || sum > 1.1) return null;
  return values.map((v) => v / sum);
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j] ?? 0;
      prev[j] = Math.min(above + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = above;
    }
  }
  return prev[b.length] ?? 0;
}

/** Similarity in [0, 1] (1 − normalised edit distance) over lowercase letters and digits only. */
export function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const x = norm(a);
  const y = norm(b);
  if (x.length === 0 && y.length === 0) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** The option key a model's answer means: exact, or the best fuzzy match with similarity ≥ 0.9. */
export function matchOption(
  answer: string,
  keys: readonly string[],
): { key: string; fuzzy: boolean } | null {
  if (keys.includes(answer)) return { key: answer, fuzzy: false };
  let best: { key: string; score: number } | null = null;
  for (const key of keys) {
    const score = similarity(answer, key);
    if (!best || score > best.score) best = { key, score };
  }
  return best && best.score >= 0.9 ? { key: best.key, fuzzy: true } : null;
}
