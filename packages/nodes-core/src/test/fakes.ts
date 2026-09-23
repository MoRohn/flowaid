/** Fake providers for the node harness tests. */
import {
  HumanFallbackSignal,
  booleanDecision,
  choiceDecision,
  scoreDecision,
} from "@flowaid/providers";
import type {
  DecisionProvider,
  DecisionQuestion,
  GenerationChunk,
  GenerationProvider,
  GenerationRequest,
  ProviderHealth,
  ProviderHop,
} from "@flowaid/workflow-core";

const HEALTHY: ProviderHealth = {
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

export interface DeciderScript {
  pYes?: number;
  choice?: Record<string, number>;
  score?: number[];
  /** Throw HumanFallbackSignal (every hop failed, the chain ends in human). */
  human?: boolean;
  error?: Error;
}

export interface FakeDecider extends DecisionProvider {
  questions: DecisionQuestion[];
  chains: (readonly ProviderHop[])[];
}

export function fakeDecider(
  script: DeciderScript | ((hop: readonly ProviderHop[]) => DeciderScript),
  id = "typesafe",
): FakeDecider & ((chain: readonly ProviderHop[]) => DecisionProvider) {
  const questions: DecisionQuestion[] = [];
  const chains: (readonly ProviderHop[])[] = [];
  let current: readonly ProviderHop[] = [];
  const s = () => (typeof script === "function" ? script(current) : script);
  const m = (pid: string) => ({
    provider: pid,
    model: `${pid}-model`,
    latencyMs: 12,
    costUsd: 0.001,
    usage: { inputTokens: 10, outputTokens: 0 },
  });
  const guard = () => {
    const now = s();
    if (now.error) throw now.error;
    if (now.human) throw new HumanFallbackSignal([]);
    return now;
  };
  const pid = () => (current[0] && "provider" in current[0] ? String(current[0].provider) : id);
  const provider: FakeDecider = {
    id,
    model: `${id}-model`,
    questions,
    chains,
    capabilities: {
      batch: true,
      maxQuestions: 16,
      maxStateTokens: 100000,
      kinds: ["boolean", "choice", "score"],
      text: true,
      images: false,
    },
    decideBoolean: (_state, q) => {
      questions.push(q);
      const now = guard();
      return Promise.resolve(booleanDecision(now.pYes ?? 0.9, m(pid())));
    },
    decideChoice: (_state, q) => {
      questions.push(q);
      const now = guard();
      const keys = Object.keys(q.options);
      return Promise.resolve(
        choiceDecision(
          now.choice ??
            Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.8 : 0.2 / (keys.length - 1)])),
          m(pid()),
        ),
      );
    },
    decideScore: (_state, q) => {
      questions.push(q);
      const now = guard();
      return Promise.resolve(
        scoreDecision(
          now.score ?? q.levels.map((_, i) => (i === q.levels.length - 1 ? 1 : 0)),
          q.levels,
          m(pid()),
        ),
      );
    },
    batch: async (state, qs, c) => {
      const answers: Record<string, never> = {};
      for (const [k, q] of Object.entries(qs))
        answers[k] = (await (q.kind === "boolean"
          ? provider.decideBoolean(state, q, c)
          : q.kind === "choice"
            ? provider.decideChoice(state, q, c)
            : provider.decideScore(state, q, c))) as never;
      return {
        answers,
        usage: { inputTokens: 10, outputTokens: 0 },
        model: `${id}-model`,
        requestId: null,
        latencyMs: 12,
      };
    },
    health: () => HEALTHY,
  };
  const factory = (chain: readonly ProviderHop[]) => {
    chains.push(chain);
    current = chain;
    return provider;
  };
  return Object.assign(factory, provider);
}

export function fakeGenerator(
  text: string | ((req: GenerationRequest) => string),
  opts: { jsonSchema?: boolean; streaming?: boolean; structured?: unknown } = {},
): GenerationProvider & { requests: GenerationRequest[] } {
  const requests: GenerationRequest[] = [];
  const answer = (req: GenerationRequest) => (typeof text === "function" ? text(req) : text);
  return {
    id: "openai",
    model: "gpt-test",
    requests,
    capabilities: {
      tools: true,
      jsonSchema: opts.jsonSchema ?? false,
      vision: false,
      streaming: opts.streaming ?? false,
      thinking: false,
      maxContext: 128000,
    },
    generate: (req) => {
      requests.push(req);
      return Promise.resolve({
        text: answer(req),
        toolCalls: [],
        ...(opts.structured !== undefined ? { structured: opts.structured as never } : {}),
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 20 },
        costUsd: 0.0002,
        priceSnapshot: null,
        latencyMs: 30,
        provider: "openai",
        model: "gpt-test",
      });
    },
    async *stream(req): AsyncIterable<GenerationChunk> {
      requests.push(req);
      await Promise.resolve();
      for (const word of answer(req).split(/(?<= )/)) yield { type: "text", delta: word };
      yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
      yield { type: "done", finishReason: "stop" };
    },
    health: () => HEALTHY,
  };
}
