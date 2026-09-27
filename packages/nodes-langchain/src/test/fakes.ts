/** Test-only fakes for the LangChain node harness tests (no network). */
import type {
  EmbeddingProvider,
  GenerationChunk,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
  ProviderHealth,
  SafeFetch,
} from "@flowaid/workflow-core";

export const HEALTHY: ProviderHealth = {
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

export type Step =
  Partial<GenerationResult> | ((req: GenerationRequest) => Partial<GenerationResult>);

/** A generation provider answering from a script (the last step repeats). */
export function scripted(steps: Step[]): GenerationProvider & { requests: GenerationRequest[] } {
  const requests: GenerationRequest[] = [];
  let i = 0;
  const next = (req: GenerationRequest): GenerationResult => {
    requests.push(req);
    const s = steps[Math.min(i, steps.length - 1)] ?? {};
    i += 1;
    return {
      text: "",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.001,
      priceSnapshot: null,
      latencyMs: 1,
      provider: "fake",
      model: "fake-chat",
      ...(typeof s === "function" ? s(req) : s),
    };
  };
  return {
    id: "fake",
    model: "fake-chat",
    requests,
    capabilities: {
      tools: true,
      jsonSchema: true,
      vision: false,
      streaming: true,
      thinking: false,
      maxContext: 32_000,
    },
    generate: (req) => Promise.resolve(next(req)),
    stream: (req) => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<GenerationChunk> {
        await Promise.resolve();
        const r = next(req);
        for (const piece of r.text.match(/.{1,5}/gs) ?? []) yield { type: "text", delta: piece };
        for (const [index, c] of r.toolCalls.entries())
          yield {
            type: "tool_call",
            index,
            id: c.id,
            name: c.name,
            argsDelta: JSON.stringify(c.args),
          };
        yield { type: "usage", usage: r.usage };
        yield { type: "done", finishReason: r.finishReason };
      },
    }),
    health: () => HEALTHY,
  };
}

const DIMS = 64;

/** Bag-of-words hashing embeddings: texts that share words are similar. */
export function bowVector(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const word of text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)) {
    let h = 2166136261;
    for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    v[Math.abs(h) % DIMS] = (v[Math.abs(h) % DIMS] ?? 0) + 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export function bowEmbeddings(): EmbeddingProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    id: "fake",
    model: "fake-embed",
    dimensions: DIMS,
    calls,
    embed: (texts) => {
      calls.push(texts);
      return Promise.resolve({
        vectors: texts.map(bowVector),
        usage: { inputTokens: texts.join(" ").split(/\s+/).length, outputTokens: 0 },
        costUsd: 0.0001,
      });
    },
    health: () => HEALTHY,
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A SafeFetch that answers from `routes` (first matching prefix) and records every request. */
export function fakeHttp(
  routes: Record<string, (req: RecordedRequest) => Response | Promise<Response>>,
): SafeFetch & { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const raw = typeof init?.body === "string" ? init.body : undefined;
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const req = { url, method: init?.method ?? "GET", headers, body };
    requests.push(req);
    const key = Object.keys(routes)
      .filter((prefix) => url.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return new Response("not found", { status: 404 });
    return (routes[key] as (r: RecordedRequest) => Response | Promise<Response>)(req);
  };
  return Object.assign(fn, { requests });
}

export const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
