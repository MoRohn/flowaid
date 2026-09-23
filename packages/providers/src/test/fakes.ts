/** Test fakes: a manual clock, scripted providers and chunked SSE responses. */
import type {
  BooleanDecision,
  DecisionCallContext,
  DecisionProvider,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
  ProviderHealth,
} from "@flowaid/workflow-core";
import { booleanDecision } from "../decisionMath.js";
import type { ProviderClock } from "../signals.js";

export class FakeClock implements ProviderClock {
  constructor(public t = 1_000_000) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
  sleep(ms: number) {
    this.t += ms;
    return Promise.resolve();
  }
}

export const ctx = (): DecisionCallContext => ({
  signal: new AbortController().signal,
  runId: "r",
  nodeRunId: "n",
  idempotencyKey: null,
});

export const HEALTHY: ProviderHealth = {
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

/** A decision provider that plays a script: each entry is a result or an error to throw. */
export function scriptedDecider(
  id: string,
  script: (number | Error)[],
  clock?: FakeClock,
  latencyMs = 10,
): DecisionProvider & { calls: number } {
  let i = 0;
  const provider = {
    id,
    model: `${id}-model`,
    calls: 0,
    capabilities: {
      batch: true,
      maxQuestions: 8,
      maxStateTokens: 1000,
      kinds: ["boolean", "choice", "score"] as const,
      text: true,
      images: false,
    },
    decideBoolean(): Promise<BooleanDecision> {
      provider.calls += 1;
      clock?.advance(latencyMs);
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      if (step instanceof Error) return Promise.reject(step);
      return Promise.resolve(
        booleanDecision(step ?? 0.5, {
          provider: id,
          model: `${id}-model`,
          latencyMs,
          costUsd: 0.001,
        }),
      );
    },
    decideChoice: () => Promise.reject(new Error("not scripted")),
    decideScore: () => Promise.reject(new Error("not scripted")),
    async batch(state: unknown, questions: Record<string, unknown>) {
      const answers: Record<string, BooleanDecision> = {};
      for (const id of Object.keys(questions)) answers[id] = await provider.decideBoolean();
      return {
        answers,
        usage: { inputTokens: 1, outputTokens: 0 },
        model: `${id}-model`,
        requestId: null,
        latencyMs,
      };
    },
    health: () => HEALTHY,
  };
  return provider;
}

/** A generation provider that answers each request with the next scripted text (or error). */
export function scriptedGenerator(
  texts: (string | Error)[],
  opts: { jsonSchema?: boolean; model?: string } = {},
): GenerationProvider & { requests: GenerationRequest[] } {
  let i = 0;
  const requests: GenerationRequest[] = [];
  return {
    id: "openai",
    model: opts.model ?? "gpt-4.1-mini",
    requests,
    capabilities: {
      tools: true,
      jsonSchema: opts.jsonSchema ?? true,
      vision: false,
      streaming: true,
      thinking: false,
      maxContext: 128000,
    },
    generate(req: GenerationRequest): Promise<GenerationResult> {
      requests.push(req);
      const step = texts[Math.min(i, texts.length - 1)];
      i += 1;
      if (step instanceof Error) return Promise.reject(step);
      return Promise.resolve({
        text: step ?? "",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 20 },
        costUsd: 0.0001,
        priceSnapshot: { inputPerMTok: 0.4, outputPerMTok: 1.6 },
        latencyMs: 50,
        provider: "openai",
        model: opts.model ?? "gpt-4.1-mini",
      });
    },
    stream: () => {
      throw new Error("not scripted");
    },
    health: () => HEALTHY,
  };
}

/** A Response whose body arrives in the given chunks (split mid-frame on purpose by tests). */
export function chunkedResponse(chunks: string[], init: ResponseInit = { status: 200 }): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, init);
}
