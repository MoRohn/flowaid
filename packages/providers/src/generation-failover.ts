/**
 * Generation failover and smart model routing (RFC-0005, ARCHITECTURE.md §6.2): a
 * GenerationProvider over a policy's candidates.
 *
 * - Filtering: a candidate must resolve (credential, factory), meet the policy's requirements by
 *   its catalog capabilities (models the catalog does not know get the benefit of the doubt),
 *   support tools when the request carries tools, and fit `maxCostUsdPerCall` by the estimated
 *   cost of the request.
 * - Ordering: `ordered` as configured; `cheapest` by catalog price (input + output per million
 *   tokens, unknown last); `fastest` by the health tracker's p95 (unmeasured last);
 *   `healthiest` by status, then error rate. Ties keep the configured order.
 * - Walking: an open circuit (`down`) is recorded as `skipped_unhealthy`; the same errors that
 *   advance a decision chain advance this one (`advancesChain`); anything else surfaces. Every
 *   candidate tried is in `GenerationResult.attempts` and each hand-over goes to `onFailover`
 *   (the runtime emits PROVIDER_FAILOVER). A stream fails over only before its first chunk.
 */
import {
  ProviderError,
  toFlowaidError,
  type DecisionCallContext,
  type FlowaidError,
  type GenerationChunk,
  type GenerationPolicy,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type ModelCatalog,
  type ModelRef,
  type ProviderAttempt,
  type ProviderHealth,
} from "@flowaid/workflow-core";
import { advancesChain, type FailoverOptions } from "./failover.js";
import type { HealthTracker } from "./health.js";
import { CircuitOpenError, systemClock, type ProviderClock } from "./signals.js";

/** One candidate of a generation policy, resolved to a (guarded) provider. */
export interface GenerationCandidate {
  ref: ModelRef;
  /** Absent when the candidate could not be resolved (no credential, no factory). */
  provider?: GenerationProvider;
  skipReason?: string;
  /** Health key the provider's guard records under (provider, model, credential). */
  healthKey: string;
}

export interface GenerationChainOptions extends FailoverOptions {
  catalog: ModelCatalog;
}

const STATUS_RANK = { healthy: 0, degraded: 1, down: 2 } as const;

export function candidateLabel(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

/** Rough token estimate of a request: about four characters per token of message text. */
export function estimateInputTokens(req: GenerationRequest): number {
  let chars = 0;
  for (const m of req.messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else for (const part of m.content) if (part.type === "text") chars += part.text.length;
  }
  return Math.ceil(chars / 4);
}

/** Estimated cost of `req` on a model by the catalog, or null when its price is unknown. */
export function estimateCostUsd(
  catalog: ModelCatalog,
  ref: ModelRef,
  req: GenerationRequest,
): number | null {
  const info = catalog.get(ref.provider, ref.model);
  if (!info?.pricing) return null;
  const outputTokens = req.maxOutputTokens ?? info.maxOutputTokens ?? 1024;
  return catalog.price(ref.provider, ref.model, {
    inputTokens: estimateInputTokens(req),
    outputTokens,
  }).costUsd;
}

export interface ExcludedCandidate {
  candidate: GenerationCandidate;
  reason: string;
}

/** The candidates that may serve `req` under `policy`, and the excluded ones with a reason. */
export function eligibleCandidates(
  candidates: readonly GenerationCandidate[],
  policy: Pick<GenerationPolicy, "requirements" | "maxCostUsdPerCall">,
  catalog: ModelCatalog,
  req?: GenerationRequest,
): { eligible: GenerationCandidate[]; excluded: ExcludedCandidate[] } {
  const eligible: GenerationCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const needs = { ...policy.requirements };
  if (req?.tools && req.tools.length > 0) needs.tools = true;
  for (const c of candidates) {
    if (!c.provider) {
      excluded.push({ candidate: c, reason: c.skipReason ?? "not configured" });
      continue;
    }
    const info = catalog.get(c.ref.provider, c.ref.model);
    const missing = (["tools", "jsonSchema", "vision"] as const).filter(
      (cap) => needs[cap] === true && info !== undefined && info.capabilities[cap] !== true,
    );
    if (missing.length > 0) {
      excluded.push({ candidate: c, reason: `lacks ${missing.join(", ")}` });
      continue;
    }
    if (
      needs.minContext !== undefined &&
      info?.contextTokens !== undefined &&
      info.contextTokens < needs.minContext
    ) {
      excluded.push({
        candidate: c,
        reason: `context window ${info.contextTokens} is below ${needs.minContext}`,
      });
      continue;
    }
    if (policy.maxCostUsdPerCall !== undefined && req) {
      const cost = estimateCostUsd(catalog, c.ref, req);
      if (cost !== null && cost > policy.maxCostUsdPerCall) {
        excluded.push({
          candidate: c,
          reason: `estimated $${cost.toFixed(6)} exceeds $${policy.maxCostUsdPerCall} per call`,
        });
        continue;
      }
    }
    eligible.push(c);
  }
  return { eligible, excluded };
}

/** Candidates in the order `strategy` tries them (stable: ties keep the configured order). */
export function orderCandidates(
  candidates: readonly GenerationCandidate[],
  strategy: GenerationPolicy["strategy"],
  deps: { catalog: ModelCatalog; health?: HealthTracker },
): GenerationCandidate[] {
  const by = (score: (c: GenerationCandidate) => number): GenerationCandidate[] =>
    candidates
      .map((c, i) => ({ c, i, s: score(c) }))
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map((x) => x.c);
  switch (strategy) {
    case "ordered":
      return [...candidates];
    case "cheapest":
      return by((c) => {
        const pricing = deps.catalog.get(c.ref.provider, c.ref.model)?.pricing;
        return pricing ? pricing.inputPerMTok + pricing.outputPerMTok : Number.POSITIVE_INFINITY;
      });
    case "fastest":
      return by((c) => {
        const p95 = deps.health?.health(c.healthKey).p95LatencyMs ?? 0;
        return p95 > 0 ? p95 : Number.POSITIVE_INFINITY;
      });
    case "healthiest":
      return by((c) => {
        if (!deps.health) return 0;
        const h = deps.health.health(c.healthKey);
        return STATUS_RANK[h.status] * 10 + h.errorRate1m;
      });
  }
}

export class GenerationFailoverChain implements GenerationProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: GenerationProvider["capabilities"];
  private readonly clock: ProviderClock;

  constructor(
    private readonly candidates: readonly GenerationCandidate[],
    private readonly policy: GenerationPolicy,
    private readonly options: GenerationChainOptions,
  ) {
    if (candidates.length === 0) throw new RangeError("a generation policy needs a candidate");
    const resolved = candidates.flatMap((c) => (c.provider ? [c.provider] : []));
    const first = resolved[0];
    this.id = first?.id ?? candidates[0]?.ref.provider ?? "failover";
    this.model = first?.model ?? candidates[0]?.ref.model ?? "";
    this.capabilities = {
      tools: resolved.some((p) => p.capabilities.tools),
      jsonSchema: resolved.some((p) => p.capabilities.jsonSchema),
      vision: resolved.some((p) => p.capabilities.vision),
      streaming: resolved.some((p) => p.capabilities.streaming),
      thinking: resolved.some((p) => p.capabilities.thinking),
      maxContext: Math.max(0, ...resolved.map((p) => p.capabilities.maxContext)),
    };
    this.clock = options.clock ?? systemClock;
  }

  /** The candidates for this request, in the order they will be tried. */
  plan(req?: GenerationRequest): GenerationCandidate[] {
    const { eligible, excluded } = eligibleCandidates(
      this.candidates,
      this.policy,
      this.options.catalog,
      req,
    );
    for (const x of excluded)
      this.options.warn?.(
        `Skipping generation candidate ${candidateLabel(x.candidate.ref)}: ${x.reason}`,
      );
    if (eligible.length === 0) {
      const why = excluded.map((x) => `${candidateLabel(x.candidate.ref)}: ${x.reason}`);
      throw new ProviderError(
        `No generation candidate can serve this request (${why.join("; ")})`,
        false,
        this.id,
      );
    }
    return orderCandidates(eligible, this.policy.strategy, {
      catalog: this.options.catalog,
      ...(this.options.health ? { health: this.options.health } : {}),
    });
  }

  /** An open circuit; checked without consuming the half-open probe the guard lets through. */
  private isDown(c: GenerationCandidate): boolean {
    return this.options.health?.health(c.healthKey).status === "down";
  }

  async generate(req: GenerationRequest, ctx: DecisionCallContext): Promise<GenerationResult> {
    const attempts: ProviderAttempt[] = [];
    let lastError: FlowaidError | undefined;
    let previous: string | undefined;
    for (const c of this.plan(req)) {
      const provider = c.provider as GenerationProvider;
      const label = candidateLabel(c.ref);
      if (previous !== undefined && lastError)
        this.options.onFailover?.({ from: previous, to: label, error: lastError });
      if (this.isDown(c)) {
        attempts.push({
          provider: provider.id,
          model: provider.model,
          outcome: "skipped_unhealthy",
          latencyMs: 0,
        });
        lastError = new CircuitOpenError(provider.id, this.clock.now());
        previous = label;
        continue;
      }
      const started = this.clock.now();
      const elapsed = () => Math.max(0, Math.round(this.clock.now() - started));
      try {
        const result = await provider.generate(req, ctx);
        attempts.push({
          provider: provider.id,
          model: provider.model,
          outcome: "ok",
          latencyMs: elapsed(),
        });
        return { ...result, attempts };
      } catch (thrown) {
        const error = toFlowaidError(thrown);
        attempts.push({
          provider: provider.id,
          model: provider.model,
          outcome: "error",
          errorCode: error.code,
          latencyMs: elapsed(),
        });
        if (!advancesChain(error)) throw error;
        lastError = error;
        previous = label;
      }
    }
    throw lastError ?? new ProviderError("No generation candidate is available", true, this.id);
  }

  async *stream(req: GenerationRequest, ctx: DecisionCallContext): AsyncIterable<GenerationChunk> {
    let lastError: FlowaidError | undefined;
    let previous: string | undefined;
    for (const c of this.plan(req)) {
      const provider = c.provider as GenerationProvider;
      const label = candidateLabel(c.ref);
      if (previous !== undefined && lastError)
        this.options.onFailover?.({ from: previous, to: label, error: lastError });
      if (this.isDown(c)) {
        lastError = new CircuitOpenError(provider.id, this.clock.now());
        previous = label;
        continue;
      }
      let yielded = false;
      try {
        for await (const chunk of provider.stream(req, ctx)) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (thrown) {
        const error = toFlowaidError(thrown);
        // Text already delivered cannot be taken back: only a stream that produced nothing moves on.
        if (yielded || !advancesChain(error)) throw error;
        lastError = error;
        previous = label;
      }
    }
    throw lastError ?? new ProviderError("No generation candidate is available", true, this.id);
  }

  health(): ProviderHealth {
    const first = this.candidates.find((c) => c.provider);
    if (first && this.options.health) return this.options.health.health(first.healthKey);
    return (
      first?.provider?.health() ?? {
        status: "healthy",
        errorRate1m: 0,
        p95LatencyMs: 0,
        consecutiveFailures: 0,
        checkedAt: new Date(this.clock.now()).toISOString(),
      }
    );
  }
}
