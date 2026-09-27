/**
 * Rerank providers (RFC-0004): one OpenAI-compatible `/rerank` client — the request shape Cohere,
 * Jina, vLLM, TEI and LocalAI share (`{ model, query, documents }` → `{ results: [{ index,
 * relevance_score }] }`) — with presets for Cohere (`/v2/rerank`) and Jina (`/v1/rerank`) and a
 * generic `rerank-compatible` factory that takes its `baseUrl` from the credential. Scores come back
 * in input order; the caller sorts.
 */
import {
  NetworkError,
  ProviderError,
  type DecisionCallContext,
  type ModelCatalog,
  type ProviderFactory,
  type ProviderHealth,
  type RerankProvider,
  type SafeFetch,
  type TokenUsage,
} from "@flowaid/workflow-core";
import { errorFromResponse } from "./httpErrors.js";

export interface RerankClientOptions {
  /** provider id recorded on results and in errors (`cohere`, `jina`, `rerank-compatible`) */
  id: string;
  model: string;
  /** full endpoint URL, e.g. `https://api.cohere.com/v2/rerank` */
  endpoint: string;
  apiKey?: string;
  http: SafeFetch;
  catalog?: ModelCatalog;
  /** the most documents one request may carry (larger inputs are split) */
  maxDocuments?: number;
}

interface RerankResponse {
  results?: { index?: unknown; relevance_score?: unknown; score?: unknown }[];
  usage?: { total_tokens?: unknown; prompt_tokens?: unknown };
}

const healthy = (): ProviderHealth => ({
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: new Date().toISOString(),
});

export class RerankClient implements RerankProvider {
  readonly id: string;
  readonly model: string;
  private readonly options: RerankClientOptions;

  constructor(options: RerankClientOptions) {
    this.id = options.id;
    this.model = options.model;
    this.options = options;
  }

  async rerank(
    query: string,
    docs: string[],
    ctx: DecisionCallContext,
  ): Promise<{ scores: number[]; usage?: TokenUsage; costUsd: number }> {
    const scores = new Array<number>(docs.length).fill(0);
    const max = this.options.maxDocuments ?? 1000;
    let tokens = 0;
    for (let start = 0; start < docs.length; start += max) {
      const batch = docs.slice(start, start + max);
      const body = await this.post(query, batch, ctx);
      for (const r of body.results ?? []) {
        const index = typeof r.index === "number" ? r.index : -1;
        const score =
          typeof r.relevance_score === "number"
            ? r.relevance_score
            : typeof r.score === "number"
              ? r.score
              : NaN;
        if (index < 0 || index >= batch.length || !Number.isFinite(score))
          throw new ProviderError(`${this.id} returned a malformed rerank result`, false, this.id);
        scores[start + index] = score;
      }
      const t = body.usage?.total_tokens ?? body.usage?.prompt_tokens;
      if (typeof t === "number") tokens += t;
    }
    const usage: TokenUsage = { inputTokens: tokens, outputTokens: 0 };
    // priced from the catalog when it lists the model; the registry re-prices unpriced results
    const costUsd = this.options.catalog?.price(this.id, this.model, usage).costUsd ?? 0;
    return { scores, ...(tokens > 0 ? { usage } : {}), costUsd };
  }

  private async post(
    query: string,
    documents: string[],
    ctx: DecisionCallContext,
  ): Promise<RerankResponse> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    let res: Response;
    try {
      res = await this.options.http(this.options.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.model, query, documents, return_documents: false }),
        signal: ctx.signal,
      });
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      throw new NetworkError(
        `${this.id} rerank failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await res.text();
    if (!res.ok) throw errorFromResponse(this.id, res.status, res.headers, text);
    try {
      return JSON.parse(text) as RerankResponse;
    } catch {
      throw new ProviderError(`${this.id} returned a non-JSON rerank response`, true, this.id);
    }
  }

  health(): ProviderHealth {
    return healthy();
  }
}

const trim = (url: string) => url.replace(/\/+$/, "");

/** Rerank factories: Cohere, Jina and any OpenAI-compatible `/rerank` endpoint. */
export function rerankFactories(): ProviderFactory<RerankProvider>[] {
  const preset = (
    id: string,
    credentialType: string,
    defaultBase: string,
    path: string,
    maxDocuments: number,
  ): ProviderFactory<RerankProvider> => ({
    id,
    kind: "rerank",
    credentialType,
    create: ({ model, credential, http, catalog }) =>
      new RerankClient({
        id,
        model,
        endpoint: `${trim(credential?.baseUrl ?? defaultBase)}${path}`,
        ...(credential?.apiKey ? { apiKey: credential.apiKey } : {}),
        http,
        catalog,
        maxDocuments,
      }),
  });
  return [
    preset("cohere", "cohere.api_key", "https://api.cohere.com", "/v2/rerank", 1000),
    preset("jina", "jina.api_key", "https://api.jina.ai", "/v1/rerank", 2048),
    {
      id: "rerank-compatible",
      kind: "rerank",
      credentialType: "openai.api_key",
      create: ({ model, credential, http, catalog }) => {
        if (!credential?.baseUrl)
          throw new ProviderError(
            "rerank-compatible needs the credential's baseUrl (the server's /v1 root)",
            false,
            "rerank-compatible",
          );
        return new RerankClient({
          id: "rerank-compatible",
          model,
          endpoint: `${trim(credential.baseUrl)}/rerank`,
          ...(credential.apiKey ? { apiKey: credential.apiKey } : {}),
          http,
          catalog,
        });
      },
    },
  ];
}
