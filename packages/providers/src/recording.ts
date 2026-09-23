/**
 * Record/replay providers (P1-04, `FLOWAID_PROVIDER_FIXTURES=record|replay`). Every call is keyed
 * by `(provider, model, sha256(request))`. In `record` mode the real provider answers and the
 * response is stored; in `replay` mode the stored response is returned and a miss fails the call
 * (non-retryable), so the acceptance journey in CI is deterministic and never reaches a vendor.
 * Streams are recorded chunk by chunk and replayed in order.
 */
import { sha256Json } from "@flowaid/shared";
import {
  ProviderError,
  type BooleanQuestion,
  type ChoiceQuestion,
  type DecisionCallContext,
  type DecisionProvider,
  type DecisionQuestion,
  type DecisionState,
  type EmbeddingProvider,
  type GenerationChunk,
  type GenerationProvider,
  type GenerationRequest,
  type JsonValue,
  type ScoreQuestion,
} from "@flowaid/workflow-core";

export type FixtureMode = "record" | "replay";

/** Where recordings live (in memory, files, object storage). */
export interface FixtureStore {
  get(key: string): JsonValue | undefined | Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): void | Promise<void>;
}

export class MemoryFixtureStore implements FixtureStore {
  readonly entries = new Map<string, JsonValue>();
  get(key: string) {
    return this.entries.get(key);
  }
  set(key: string, value: JsonValue) {
    this.entries.set(key, value);
  }
}

export function fixtureKey(
  provider: string,
  model: string,
  method: string,
  request: JsonValue,
): string {
  return `${provider}/${model}/${method}/${sha256Json(request)}`;
}

class Recorder {
  constructor(
    private readonly mode: FixtureMode,
    private readonly store: FixtureStore,
    private readonly provider: string,
    private readonly model: string,
  ) {}

  async call<T>(method: string, request: JsonValue, live: () => Promise<T>): Promise<T> {
    const key = fixtureKey(this.provider, this.model, method, request);
    if (this.mode === "replay") {
      const stored = await this.store.get(key);
      if (stored === undefined) {
        throw new ProviderError(
          `No recorded ${this.provider}/${this.model} response for this ${method} request (${key}); record it with FLOWAID_PROVIDER_FIXTURES=record`,
          false,
          this.provider,
        );
      }
      return stored as T;
    }
    const value = await live();
    await this.store.set(key, JSON.parse(JSON.stringify(value)) as JsonValue);
    return value;
  }

  async *stream<T>(
    method: string,
    request: JsonValue,
    live: () => AsyncIterable<T>,
  ): AsyncIterable<T> {
    const key = fixtureKey(this.provider, this.model, method, request);
    if (this.mode === "replay") {
      const stored = await this.store.get(key);
      if (!Array.isArray(stored)) {
        throw new ProviderError(
          `No recorded ${this.provider}/${this.model} stream for this request (${key})`,
          false,
          this.provider,
        );
      }
      for (const chunk of stored) yield chunk as T;
      return;
    }
    const chunks: T[] = [];
    for await (const chunk of live()) {
      chunks.push(chunk);
      yield chunk;
    }
    await this.store.set(key, JSON.parse(JSON.stringify(chunks)) as JsonValue);
  }
}

/** The part of a decision call context that belongs in the recording key (not the signal or ids). */
const decisionContextKey = (ctx: DecisionCallContext): JsonValue => ({
  booleanThreshold: ctx.booleanThreshold ?? null,
});

export function recordingDecisionProvider(
  inner: DecisionProvider,
  mode: FixtureMode,
  store: FixtureStore,
): DecisionProvider {
  const rec = new Recorder(mode, store, inner.id, inner.model);
  const req = (state: DecisionState, q: JsonValue, ctx: DecisionCallContext): JsonValue => ({
    state: state as JsonValue,
    q,
    ctx: decisionContextKey(ctx),
  });
  return {
    id: inner.id,
    model: inner.model,
    capabilities: inner.capabilities,
    decideBoolean: (state: DecisionState, question: BooleanQuestion, ctx: DecisionCallContext) =>
      rec.call("boolean", req(state, question as JsonValue, ctx), () =>
        inner.decideBoolean(state, question, ctx),
      ),
    decideChoice: (state: DecisionState, question: ChoiceQuestion, ctx: DecisionCallContext) =>
      rec.call("choice", req(state, question as JsonValue, ctx), () =>
        inner.decideChoice(state, question, ctx),
      ),
    decideScore: (state: DecisionState, question: ScoreQuestion, ctx: DecisionCallContext) =>
      rec.call("score", req(state, question as JsonValue, ctx), () =>
        inner.decideScore(state, question, ctx),
      ),
    batch: (
      state: DecisionState,
      questions: Record<string, DecisionQuestion>,
      ctx: DecisionCallContext,
    ) =>
      rec.call("batch", req(state, questions as JsonValue, ctx), () =>
        inner.batch(state, questions, ctx),
      ),
    health: () => inner.health(),
  };
}

export function recordingGenerationProvider(
  inner: GenerationProvider,
  mode: FixtureMode,
  store: FixtureStore,
): GenerationProvider {
  const rec = new Recorder(mode, store, inner.id, inner.model);
  return {
    id: inner.id,
    model: inner.model,
    capabilities: inner.capabilities,
    generate: (request: GenerationRequest, ctx: DecisionCallContext) =>
      rec.call("generate", request as unknown as JsonValue, () => inner.generate(request, ctx)),
    stream: (request: GenerationRequest, ctx: DecisionCallContext) =>
      rec.stream<GenerationChunk>("stream", request as unknown as JsonValue, () =>
        inner.stream(request, ctx),
      ),
    health: () => inner.health(),
  };
}

export function recordingEmbeddingProvider(
  inner: EmbeddingProvider,
  mode: FixtureMode,
  store: FixtureStore,
): EmbeddingProvider {
  const rec = new Recorder(mode, store, inner.id, inner.model);
  return {
    id: inner.id,
    model: inner.model,
    dimensions: inner.dimensions,
    embed: (texts: string[], ctx: DecisionCallContext) =>
      rec.call("embed", texts, () => inner.embed(texts, ctx)),
    health: () => inner.health(),
  };
}
