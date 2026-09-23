/**
 * `ProviderRegistry` (ARCHITECTURE.md §6.2). Factories are registered by `(kind, id)` — provider
 * packages and plugin packages (e.g. `langchain:openai`) use the same API. Resolving a hop or a
 * model ref finds the factory, fetches the credential, creates the provider once per
 * `(workspace, hop, credential)` and wraps it:
 *
 * - rate limiting: a token bucket per credential, sized from the catalog (`limits.rpm`);
 * - accounting: generation and embedding results the provider did not price are priced from the
 *   catalog, with the snapshot recorded;
 * - health: generation calls feed the HealthTracker and respect its circuit (decision health is
 *   recorded by the failover chain, which also skips open circuits).
 */
import { sha256Json } from "@flowaid/shared";
import {
  CredentialError,
  ProviderError,
  toFlowaidError,
  type DecisionProvider,
  type EmbeddingProvider,
  type GenerationChunk,
  type GenerationProvider,
  type JsonObject,
  type JsonValue,
  type ModelRef,
  type ProviderFactory,
  type ProviderHop,
  type SafeFetch,
} from "@flowaid/workflow-core";
import type { DefaultModelCatalog } from "./catalog/index.js";
import { FailoverChain, type ChainHop, type FailoverOptions } from "./failover.js";
import { HealthTracker } from "./health.js";
import { LLMDecisionProvider } from "./llm-decision.js";
import { RateLimiter, type TokenBucket } from "./rateLimit.js";
import { RuleDecisionProvider, type DecisionRuleSet } from "./rule-decision.js";
import { CircuitOpenError, systemClock, type ProviderClock } from "./signals.js";

type AnyProvider = DecisionProvider | GenerationProvider | EmbeddingProvider;
type Kind = ProviderFactory<AnyProvider>["kind"];

/** What resolving needs from the caller: the workspace, its credentials and the safe fetch. */
export interface ResolveContext {
  workspaceId: string;
  /** The credential bound for a provider (by factory id and credential type), or undefined. */
  credential(
    providerId: string,
    credentialType: string | undefined,
  ): Promise<{ id: string; value: Record<string, string> } | undefined>;
  http: SafeFetch;
  signal?: AbortSignal;
  /** Factory options (base URL of a custom endpoint, organization, …). */
  options?: JsonObject;
}

export interface ProviderRegistryOptions {
  catalog: DefaultModelCatalog;
  health?: HealthTracker;
  rateLimiter?: RateLimiter;
  clock?: ProviderClock;
}

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory<AnyProvider>>();
  private readonly instances = new Map<string, AnyProvider>();
  readonly catalog: DefaultModelCatalog;
  readonly health: HealthTracker;
  private readonly rateLimiter: RateLimiter;
  private readonly clock: ProviderClock;

  constructor(options: ProviderRegistryOptions) {
    this.catalog = options.catalog;
    this.clock = options.clock ?? systemClock;
    this.health = options.health ?? new HealthTracker(this.clock);
    this.rateLimiter = options.rateLimiter ?? new RateLimiter(this.clock);
  }

  register(factory: ProviderFactory<AnyProvider>): void {
    const key = `${factory.kind}:${factory.id}`;
    if (this.factories.has(key))
      throw new Error(`A ${factory.kind} provider '${factory.id}' is already registered`);
    this.factories.set(key, factory);
  }

  list(kind?: Kind): ProviderFactory<AnyProvider>[] {
    return [...this.factories.values()].filter((f) => kind === undefined || f.kind === kind);
  }

  private factory(kind: Kind, id: string): ProviderFactory<AnyProvider> {
    const factory = this.factories.get(`${kind}:${id}`);
    if (!factory) throw new ProviderError(`No ${kind} provider '${id}' is registered`, false, id);
    return factory;
  }

  private async create(
    kind: Kind,
    id: string,
    model: string,
    ctx: ResolveContext,
    cacheKey: JsonValue,
  ): Promise<{ provider: AnyProvider; credentialId: string }> {
    const factory = this.factory(kind, id);
    const credential = factory.credentialType
      ? await ctx.credential(id, factory.credentialType)
      : undefined;
    if (factory.credentialType && !credential) {
      throw new CredentialError(`No ${factory.credentialType} credential is bound for ${id}`);
    }
    const credentialId = credential?.id ?? "none";
    const key = `${ctx.workspaceId}|${sha256Json(cacheKey)}|${credentialId}`;
    let provider = this.instances.get(key);
    if (!provider) {
      provider = factory.create({
        model,
        credential: credential?.value,
        ...(ctx.options ? { options: ctx.options } : {}),
        http: ctx.http,
        catalog: this.catalog,
      });
      this.instances.set(key, provider);
    }
    return { provider, credentialId };
  }

  private bucketFor(
    provider: string,
    model: string,
    credentialId: string,
  ): TokenBucket | undefined {
    const rpm = this.catalog.rateLimitRpm(provider, model);
    return rpm ? this.rateLimiter.bucket(`${provider}|${credentialId}`, rpm) : undefined;
  }

  /** A decision provider for one hop; undefined for `human`, or `rule` without rules. */
  async decision(
    hop: ProviderHop,
    ctx: ResolveContext,
    opts: { rules?: DecisionRuleSet } = {},
  ): Promise<DecisionProvider | undefined> {
    switch (hop.provider) {
      case "human":
        return undefined;
      case "rule":
        return opts.rules ? new RuleDecisionProvider(opts.rules) : undefined;
      case "llm":
        return new LLMDecisionProvider(await this.generation(hop.model, ctx));
      case "typesafe":
      case "custom": {
        const id = hop.provider === "typesafe" ? "typesafe" : hop.id;
        const model = hop.provider === "typesafe" ? hop.model : (hop.model ?? "");
        const { provider, credentialId } = await this.create("decision", id, model, ctx, {
          kind: "decision",
          hop,
        });
        return rateLimitedDecision(
          provider as DecisionProvider,
          this.bucketFor(id, model, credentialId),
        );
      }
    }
  }

  /** The failover chain for a list of hops; hops that cannot be resolved are skipped with a reason. */
  async chain(
    hops: readonly ProviderHop[],
    ctx: ResolveContext,
    opts: { rules?: DecisionRuleSet } & Omit<FailoverOptions, "health" | "clock"> = {},
  ): Promise<FailoverChain> {
    const resolved: ChainHop[] = [];
    for (const hop of hops) {
      if (hop.provider === "human") {
        resolved.push({ hop });
        continue;
      }
      if (hop.provider === "rule" && !opts.rules) {
        resolved.push({ hop, skipReason: "the node has no rules" });
        continue;
      }
      try {
        const provider = await this.decision(hop, ctx, opts.rules ? { rules: opts.rules } : {});
        resolved.push(provider ? { hop, provider } : { hop, skipReason: "not configured" });
      } catch (error) {
        const flowaid = toFlowaidError(error);
        // A missing credential or factory makes a failover hop unavailable; for the primary it is fatal.
        if (resolved.length === 0) throw flowaid;
        resolved.push({ hop, skipReason: flowaid.message });
      }
    }
    return new FailoverChain(resolved, {
      health: this.health,
      clock: this.clock,
      ...(opts.onFailover ? { onFailover: opts.onFailover } : {}),
      ...(opts.warn ? { warn: opts.warn } : {}),
    });
  }

  async generation(ref: ModelRef, ctx: ResolveContext): Promise<GenerationProvider> {
    const model = this.catalog.resolveAlias(ref.provider, ref.model);
    const { provider, credentialId } = await this.create("generation", ref.provider, model, ctx, {
      kind: "generation",
      provider: ref.provider,
      model,
    });
    return guardedGeneration(provider as GenerationProvider, {
      catalog: this.catalog,
      health: this.health,
      healthKey: `${ref.provider}/${model}/${credentialId}`,
      bucket: this.bucketFor(ref.provider, model, credentialId),
      clock: this.clock,
    });
  }

  async embedding(ref: ModelRef, ctx: ResolveContext): Promise<EmbeddingProvider> {
    const model = this.catalog.resolveAlias(ref.provider, ref.model);
    const { provider, credentialId } = await this.create("embedding", ref.provider, model, ctx, {
      kind: "embedding",
      provider: ref.provider,
      model,
    });
    const inner = provider as EmbeddingProvider;
    const bucket = this.bucketFor(ref.provider, model, credentialId);
    const catalog = this.catalog;
    return {
      id: inner.id,
      model: inner.model,
      dimensions: inner.dimensions,
      async embed(texts, callCtx) {
        await bucket?.take(callCtx.signal);
        const result = await inner.embed(texts, callCtx);
        return result.costUsd > 0
          ? result
          : { ...result, costUsd: catalog.price(inner.id, inner.model, result.usage).costUsd };
      },
      health: () => inner.health(),
    };
  }
}

function rateLimitedDecision(
  inner: DecisionProvider,
  bucket: TokenBucket | undefined,
): DecisionProvider {
  if (!bucket) return inner;
  return {
    id: inner.id,
    model: inner.model,
    capabilities: inner.capabilities,
    decideBoolean: async (s, q, c) => (await bucket.take(c.signal), inner.decideBoolean(s, q, c)),
    decideChoice: async (s, q, c) => (await bucket.take(c.signal), inner.decideChoice(s, q, c)),
    decideScore: async (s, q, c) => (await bucket.take(c.signal), inner.decideScore(s, q, c)),
    batch: async (s, q, c) => (await bucket.take(c.signal), inner.batch(s, q, c)),
    health: () => inner.health(),
  };
}

/** Rate limit, circuit breaker, health recording and catalog pricing around a generation provider. */
export function guardedGeneration(
  inner: GenerationProvider,
  opts: {
    catalog: DefaultModelCatalog;
    health: HealthTracker;
    healthKey: string;
    bucket: TokenBucket | undefined;
    clock: ProviderClock;
  },
): GenerationProvider {
  const { catalog, health, healthKey, bucket, clock } = opts;
  const gate = () => {
    const allowed = health.allow(healthKey);
    if (!allowed.allowed) throw new CircuitOpenError(inner.id, allowed.reopensAt);
  };
  const fail = (started: number, error: unknown) => {
    const flowaid = toFlowaidError(error);
    health.record(healthKey, {
      ok: false,
      latencyMs: clock.now() - started,
      code: flowaid.code,
      retryable: flowaid.retryable,
    });
    return flowaid;
  };
  return {
    id: inner.id,
    model: inner.model,
    capabilities: inner.capabilities,
    async generate(req, ctx) {
      gate();
      await bucket?.take(ctx.signal);
      const started = clock.now();
      try {
        const result = await inner.generate(req, ctx);
        health.record(healthKey, { ok: true, latencyMs: clock.now() - started });
        if (result.priceSnapshot === null && result.costUsd === 0) {
          const { costUsd, snapshot } = catalog.price(inner.id, result.model, result.usage);
          return { ...result, costUsd, priceSnapshot: snapshot };
        }
        return result;
      } catch (error) {
        throw fail(started, error);
      }
    },
    async *stream(req, ctx): AsyncIterable<GenerationChunk> {
      gate();
      await bucket?.take(ctx.signal);
      const started = clock.now();
      try {
        for await (const chunk of inner.stream(req, ctx)) yield chunk;
        health.record(healthKey, { ok: true, latencyMs: clock.now() - started });
      } catch (error) {
        throw fail(started, error);
      }
    },
    health: () => health.health(healthKey),
  };
}
