/**
 * `LangChainEmbeddingProvider` (LANGCHAIN.md §2): LangChain `Embeddings` as a flowaid
 * `EmbeddingProvider`. LangChain's embeddings API returns no usage, so input tokens are estimated
 * (≈ 4 characters per token) for budgets and pricing; `usageEstimated` is exposed for callers
 * that want to label it. The call is raced against the node's signal because `embedDocuments`
 * takes none.
 */
import type { Embeddings } from "@langchain/core/embeddings";
import { HealthTracker } from "@flowaid/providers";
import {
  CancelledError,
  type DecisionCallContext,
  type EmbeddingProvider,
  type ModelCatalog,
  type TokenUsage,
} from "@flowaid/workflow-core";
import { toProviderError } from "./errors.js";

export interface LangChainEmbeddingOptions {
  id?: string;
  model?: string;
  dimensions?: number;
  pricing?: { catalog: ModelCatalog; provider: string };
  now?: () => number;
}

const tracker = new HealthTracker();

export const estimateTokens = (texts: readonly string[]): number =>
  texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new CancelledError("embedding cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new CancelledError("embedding cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => (signal.removeEventListener("abort", onAbort), resolve(v)),
      (e: unknown) => (signal.removeEventListener("abort", onAbort), reject(e as Error)),
    );
  });
}

export class LangChainEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly usageEstimated = true;
  private dims: number;
  private readonly now: () => number;

  constructor(
    private readonly embeddings: Embeddings,
    private readonly options: LangChainEmbeddingOptions = {},
  ) {
    const e = embeddings as unknown as { model?: unknown; modelName?: unknown };
    this.id = options.id ?? "langchain:embeddings";
    this.model =
      options.model ??
      (typeof e.model === "string"
        ? e.model
        : typeof e.modelName === "string"
          ? e.modelName
          : "unknown");
    this.dims = options.dimensions ?? 0;
    this.now = options.now ?? Date.now;
  }

  get dimensions(): number {
    return this.dims;
  }

  async embed(texts: string[], ctx: DecisionCallContext) {
    const started = this.now();
    const key = `${this.id}:${this.model}`;
    try {
      const vectors =
        texts.length === 0
          ? []
          : await abortable(this.embeddings.embedDocuments(texts), ctx.signal);
      if (vectors[0]) this.dims = vectors[0].length;
      const usage: TokenUsage = { inputTokens: estimateTokens(texts), outputTokens: 0 };
      const p = this.options.pricing;
      const costUsd = p ? p.catalog.price(p.provider, this.model, usage).costUsd : 0;
      tracker.record(key, { ok: true, latencyMs: this.now() - started });
      return { vectors, usage, costUsd };
    } catch (error) {
      const e = toProviderError(error, this.id);
      tracker.record(key, {
        ok: false,
        latencyMs: this.now() - started,
        code: e.code,
        retryable: e.retryable,
      });
      throw e;
    }
  }

  health() {
    return tracker.health(`${this.id}:${this.model}`);
  }
}
