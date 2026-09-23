/**
 * Builders that produce spec-exact `DecisionResult`s (CONTRACTS.ts §7) from
 * the few numbers a gallery, a test or a fixture cares about. Every derived
 * field (`confidence`, `pYes`, `probabilities`, `normalized`, `level`,
 * `levelLabel`, `attempts`) is computed the way the providers compute it, so
 * the decision components always render the real shape.
 */
import type {
  BooleanDecision,
  ChoiceDecision,
  DecisionResult,
  ProviderAttempt,
  ScoreDecision,
  TokenUsage,
} from "@flowaid/workflow-core";

interface DecisionBaseInput {
  /** "typesafe" | "llm" | "rule" | "human" | custom id. Default "typesafe". */
  provider?: string;
  /** Resolved model id. Default "jev-1.13.0". */
  model?: string;
  latencyMs?: number;
  usage?: TokenUsage;
  costUsd?: number;
  requestId?: string;
  /** Failover chain actually walked. Defaults to one successful hop of `provider`/`model`. */
  attempts?: ProviderAttempt[];
}

const DEFAULT_PROVIDER = "typesafe";
const DEFAULT_MODEL = "jev-1.13.0";

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

interface DecisionBase {
  confidence: number;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: TokenUsage;
  costUsd: number;
  requestId?: string;
  attempts: ProviderAttempt[];
}

/** Optional keys are left out (not set to `undefined`) so the result is plain JSON, as on the wire. */
function base(input: DecisionBaseInput, confidence: number): DecisionBase {
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const model = input.model ?? DEFAULT_MODEL;
  const latencyMs = Math.max(0, Math.round(input.latencyMs ?? 0));
  const out: DecisionBase = {
    confidence: clamp01(confidence),
    provider,
    model,
    latencyMs,
    costUsd: Math.max(0, input.costUsd ?? 0),
    attempts: input.attempts ?? [{ provider, model, outcome: "ok", latencyMs }],
  };
  if (input.usage) out.usage = input.usage;
  if (input.requestId !== undefined) out.requestId = input.requestId;
  return out;
}

export interface BooleanDecisionInput extends DecisionBaseInput {
  /** P(yes) in [0, 1]. `value` is `pYes >= 0.5`, `confidence = max(pYes, 1 − pYes)`. */
  pYes: number;
}

export function makeBooleanDecision(input: BooleanDecisionInput): BooleanDecision {
  const pYes = clamp01(input.pYes);
  return {
    ...base(input, Math.max(pYes, 1 - pYes)),
    kind: "boolean",
    value: pYes >= 0.5,
    pYes,
    probabilities: { true: pYes, false: round(1 - pYes) },
  };
}

export interface ChoiceDecisionInput extends DecisionBaseInput {
  /** Option → probability. Normalised to sum to 1; the winner is the highest. */
  probabilities: Record<string, number>;
  /** Override the winner (defaults to the argmax). */
  value?: string;
}

export function makeChoiceDecision(input: ChoiceDecisionInput): ChoiceDecision {
  const entries = Object.entries(input.probabilities).map(([k, p]) => [k, clamp01(p)] as const);
  const total = entries.reduce((s, [, p]) => s + p, 0);
  const probabilities: Record<string, number> = {};
  let best: string | undefined;
  let bestP = -1;
  for (const [k, p] of entries) {
    const n = total > 0 ? round(p / total) : entries.length ? round(1 / entries.length) : 0;
    probabilities[k] = n;
    if (n > bestP) {
      best = k;
      bestP = n;
    }
  }
  const value = input.value ?? best ?? "";
  const confidence = probabilities[value] ?? bestP;
  return { ...base(input, Math.max(0, confidence)), kind: "choice", value, probabilities };
}

export interface ScoreDecisionInput extends DecisionBaseInput {
  /** Ordered level labels (2–10). */
  levels: string[];
  /** Probability per level index (keyed "0".."n-1" or positional). Defaults to all mass on `value`. */
  probabilities?: Record<string, number> | number[];
  /** Fractional score in [0, levels.length − 1]; defaults to the probability-weighted mean. */
  value?: number;
  /** Provider confidence; defaults to the winning level's probability. */
  confidence?: number;
}

export function makeScoreDecision(input: ScoreDecisionInput): ScoreDecision {
  const levels = input.levels;
  const n = levels.length;
  const raw: number[] = new Array<number>(n).fill(0);
  if (Array.isArray(input.probabilities)) {
    input.probabilities.forEach((p, i) => {
      if (i < n) raw[i] = clamp01(p);
    });
  } else if (input.probabilities) {
    for (const [k, p] of Object.entries(input.probabilities)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < n) raw[i] = clamp01(p);
    }
  } else if (input.value !== undefined) {
    const i = Math.min(n - 1, Math.max(0, Math.round(input.value)));
    raw[i] = 1;
  }
  const total = raw.reduce((s, p) => s + p, 0);
  const dist = raw.map((p) => (total > 0 ? round(p / total) : n > 0 ? round(1 / n) : 0));
  const probabilities: Record<string, number> = {};
  dist.forEach((p, i) => {
    probabilities[String(i)] = p;
  });
  const weighted = dist.reduce((s, p, i) => s + p * i, 0);
  const value =
    input.value !== undefined
      ? Math.min(Math.max(0, n - 1), Math.max(0, input.value))
      : round(weighted);
  const level = Math.min(n - 1, Math.max(0, Math.round(value)));
  const winner = dist.reduce((bi, p, i) => (p > (dist[bi] ?? -1) ? i : bi), 0);
  const confidence = input.confidence ?? dist[winner] ?? 0;
  return {
    ...base(input, confidence),
    kind: "score",
    value,
    normalized: n > 1 ? round(value / (n - 1)) : 0,
    level,
    levelLabel: levels[level] ?? String(level),
    levels,
    probabilities,
  };
}

/** A failover chain: every earlier hop errored (or was skipped) and the last one answered. */
export function failoverAttempts(
  hops: Array<{
    provider: string;
    model: string;
    latencyMs?: number;
    errorCode?: ProviderAttempt["errorCode"];
    skipped?: boolean;
  }>,
): ProviderAttempt[] {
  return hops.map((h, i) => {
    const last = i === hops.length - 1;
    const attempt: ProviderAttempt = {
      provider: h.provider,
      model: h.model,
      outcome: last ? "ok" : h.skipped ? "skipped_unhealthy" : "error",
      latencyMs: Math.max(0, Math.round(h.latencyMs ?? 0)),
    };
    if (!last && !h.skipped) attempt.errorCode = h.errorCode ?? "PROVIDER_ERROR";
    return attempt;
  });
}

/** Whether a result is one of the three decision kinds (a type guard for unknown JSON). */
export function isDecisionResult(value: unknown): value is DecisionResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === "boolean" || v.kind === "choice" || v.kind === "score") &&
    typeof v.confidence === "number" &&
    typeof v.provider === "string" &&
    typeof v.model === "string" &&
    Array.isArray(v.attempts)
  );
}
