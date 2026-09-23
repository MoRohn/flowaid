/**
 * `FailoverChain` (ARCHITECTURE.md §6.2): a DecisionProvider over `[primary, ...failover]`.
 *
 * - Advances to the next hop on a retryable ProviderError, rate limiting, overload, timeout,
 *   network failure, or an open circuit (recorded as `skipped_unhealthy`).
 * - Fails immediately on anything else (a 401 credential or 422 criteria error is a
 *   configuration bug and must surface, never silently degrade).
 * - A `rule` hop without rules and a hop whose provider is not configured are skipped with a
 *   warning. Reaching a `human` hop throws `HumanFallbackSignal`.
 * - Every hop tried is recorded in `DecisionResult.attempts`; each hand-over is reported through
 *   `onFailover` (the runtime emits PROVIDER_FAILOVER).
 */
import {
  NetworkError,
  ProviderError,
  ProviderOverloadedError,
  ProviderRateLimitedError,
  TimeoutError,
  toFlowaidError,
  type BooleanQuestion,
  type ChoiceQuestion,
  type DecisionCallContext,
  type DecisionProvider,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
  type FlowaidError,
  type ProviderAttempt,
  type ProviderHealth,
  type ProviderHop,
  type ScoreQuestion,
} from "@flowaid/workflow-core";
import type { HealthTracker } from "./health.js";
import {
  CircuitOpenError,
  HumanFallbackSignal,
  systemClock,
  type ProviderClock,
} from "./signals.js";

export interface ChainHop {
  hop: ProviderHop;
  /** The resolved provider; absent for `human`, for a `rule` hop without rules, or when not configured. */
  provider?: DecisionProvider;
  /** Why an absent provider is absent (for the warning). */
  skipReason?: string;
  /** Health key (provider, model, credential); defaults to `provider/model`. */
  healthKey?: string;
}

export interface FailoverOptions {
  health?: HealthTracker;
  clock?: ProviderClock;
  onFailover?: (event: { from: string; to: string; error: FlowaidError }) => void;
  warn?: (message: string) => void;
}

export function hopLabel(hop: ProviderHop): string {
  switch (hop.provider) {
    case "typesafe":
      return `typesafe/${hop.model}`;
    case "llm":
      return `llm/${hop.model.provider}/${hop.model.model}`;
    case "custom":
      return `custom/${hop.id}${hop.model ? `/${hop.model}` : ""}`;
    case "rule":
    case "human":
      return hop.provider;
  }
}

/** Errors that mean "this provider cannot answer right now; try the next one". */
export function advancesChain(error: FlowaidError): boolean {
  if (error instanceof CircuitOpenError) return true;
  if (error instanceof ProviderRateLimitedError || error instanceof ProviderOverloadedError)
    return true;
  if (error instanceof TimeoutError || error instanceof NetworkError) return true;
  return error instanceof ProviderError && error.retryable;
}

type Attempted<T> = { value: T; attempts: ProviderAttempt[] };

export class FailoverChain implements DecisionProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: DecisionProvider["capabilities"];
  private readonly clock: ProviderClock;

  constructor(
    private readonly hops: readonly ChainHop[],
    private readonly options: FailoverOptions = {},
  ) {
    if (hops.length === 0) throw new RangeError("a failover chain needs at least one hop");
    const primary = hops.find((h) => h.provider)?.provider;
    this.id = primary?.id ?? hops[0]?.hop.provider ?? "failover";
    this.model = primary?.model ?? "";
    this.capabilities = primary?.capabilities ?? {
      batch: false,
      maxQuestions: 1,
      maxStateTokens: 0,
      kinds: ["boolean", "choice", "score"],
      text: true,
      images: false,
    };
    this.clock = options.clock ?? systemClock;
  }

  private keyOf(hop: ChainHop): string {
    return hop.healthKey ?? `${hop.provider?.id ?? hop.hop.provider}/${hop.provider?.model ?? ""}`;
  }

  private async walk<T>(call: (provider: DecisionProvider) => Promise<T>): Promise<Attempted<T>> {
    const attempts: ProviderAttempt[] = [];
    let lastError: FlowaidError | undefined;
    let previous: string | undefined;
    for (const hop of this.hops) {
      const label = hopLabel(hop.hop);
      const provider = hop.provider;
      if (hop.hop.provider !== "human" && !provider) {
        this.options.warn?.(
          `Skipping decision hop ${label}: ${hop.skipReason ?? "not configured"}`,
        );
        continue;
      }
      if (previous !== undefined && lastError)
        this.options.onFailover?.({ from: previous, to: label, error: lastError });
      if (hop.hop.provider === "human" || !provider) throw new HumanFallbackSignal(attempts);
      const key = this.keyOf(hop);
      const gate = this.options.health?.allow(key);
      if (gate && !gate.allowed) {
        attempts.push({
          provider: provider.id,
          model: provider.model,
          outcome: "skipped_unhealthy",
          latencyMs: 0,
        });
        lastError = new CircuitOpenError(provider.id, gate.reopensAt);
        previous = label;
        continue;
      }
      const started = this.clock.now();
      try {
        const value = await call(provider);
        const latencyMs = Math.max(0, Math.round(this.clock.now() - started));
        this.options.health?.record(key, { ok: true, latencyMs });
        attempts.push({ provider: provider.id, model: provider.model, outcome: "ok", latencyMs });
        return { value, attempts };
      } catch (thrown) {
        if (thrown instanceof HumanFallbackSignal) throw thrown;
        const error = toFlowaidError(thrown);
        const latencyMs = Math.max(0, Math.round(this.clock.now() - started));
        this.options.health?.record(key, {
          ok: false,
          latencyMs,
          code: error.code,
          retryable: error.retryable,
        });
        attempts.push({
          provider: provider.id,
          model: provider.model,
          outcome: "error",
          errorCode: error.code,
          latencyMs,
        });
        if (!advancesChain(error)) throw error;
        lastError = error;
        previous = label;
      }
    }
    throw (
      lastError ??
      new ProviderError("No decision provider in the chain is configured", false, this.id)
    );
  }

  private withAttempts<R extends DecisionResult>(
    result: R,
    attempts: readonly ProviderAttempt[],
  ): R {
    // Attempts the provider itself recorded (e.g. an inner retry) come first, then the chain's hops.
    const walked = attempts.slice(0, -1);
    return {
      ...result,
      attempts: [...walked, ...(result.attempts.length > 0 ? result.attempts : attempts.slice(-1))],
    };
  }

  async decideBoolean(state: DecisionState, question: BooleanQuestion, ctx: DecisionCallContext) {
    const { value, attempts } = await this.walk((p) => p.decideBoolean(state, question, ctx));
    return this.withAttempts(value, attempts);
  }

  async decideChoice(state: DecisionState, question: ChoiceQuestion, ctx: DecisionCallContext) {
    const { value, attempts } = await this.walk((p) => p.decideChoice(state, question, ctx));
    return this.withAttempts(value, attempts);
  }

  async decideScore(state: DecisionState, question: ScoreQuestion, ctx: DecisionCallContext) {
    const { value, attempts } = await this.walk((p) => p.decideScore(state, question, ctx));
    return this.withAttempts(value, attempts);
  }

  async batch(
    state: DecisionState,
    questions: Record<string, DecisionQuestion>,
    ctx: DecisionCallContext,
  ) {
    const { value, attempts } = await this.walk((p) => p.batch(state, questions, ctx));
    const answers: Record<string, DecisionResult> = {};
    for (const [id, answer] of Object.entries(value.answers))
      answers[id] = this.withAttempts(answer, attempts);
    return { ...value, answers };
  }

  health(): ProviderHealth {
    const primary = this.hops.find((h) => h.provider);
    if (primary && this.options.health) return this.options.health.health(this.keyOf(primary));
    return (
      primary?.provider?.health() ?? {
        status: "healthy",
        errorRate1m: 0,
        p95LatencyMs: 0,
        consecutiveFailures: 0,
        checkedAt: new Date(this.clock.now()).toISOString(),
      }
    );
  }
}
