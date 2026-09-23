/**
 * `ctx.providers` over a `ProviderRegistry` (ARCHITECTURE.md §3.2, §6). The SDK's access is
 * synchronous while the registry resolves providers asynchronously (credentials, catalog), so
 * each accessor returns a lazy proxy that resolves on first use. The proxies are also where
 * provider activity becomes run events: DECISION_REQUESTED / DECISION_COMPLETED,
 * PROVIDER_FAILOVER and GENERATION_COMPLETED — so any node that uses `ctx.providers` gets
 * traces and accounting without doing anything.
 */
import { sha256Hex, stableStringify } from "@flowaid/shared";
import type { ProviderAccess } from "@flowaid/node-sdk";
import type { ProviderRegistry, ResolveContext } from "@flowaid/providers";
import type {
  BooleanDecision,
  ChoiceDecision,
  DecisionCallContext,
  DecisionProvider,
  DecisionQuestion,
  DecisionResult,
  DecisionState,
  EmbeddingProvider,
  GenerationChunk,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
  ModelRef,
  ProviderHealth,
  ProviderHop,
  ScoreDecision,
} from "@flowaid/workflow-core";
import type { ExecutionCall } from "./executor.js";
import type { NodeEmitted } from "./step.js";

const HEALTHY: ProviderHealth = {
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: new Date(0).toISOString(),
};

function hopLabel(hop: ProviderHop | undefined): { provider: string; model: string } {
  if (!hop) return { provider: "none", model: "" };
  switch (hop.provider) {
    case "typesafe":
      return { provider: "typesafe", model: hop.model };
    case "llm":
      return { provider: `llm:${hop.model.provider}`, model: hop.model.model };
    case "custom":
      return { provider: hop.id, model: hop.model ?? "" };
    case "rule":
    case "human":
      return { provider: hop.provider, model: "" };
  }
}

export interface RegistryAccessOptions {
  /** Resolves the credential bound to a provider (workflow secrets → credentials). */
  credential: ResolveContext["credential"];
  http: ResolveContext["http"];
}

/** Builds `ctx.providers` for one execution. */
export function registryProviderAccess(
  registry: ProviderRegistry,
  call: ExecutionCall,
  opts: RegistryAccessOptions,
): ProviderAccess {
  const resolveCtx: ResolveContext = {
    workspaceId: call.workspaceId,
    credential: opts.credential,
    http: opts.http,
    signal: call.signal,
  };
  const emit = (e: NodeEmitted) => call.emit(e);

  const decision = (chain: readonly ProviderHop[]): DecisionProvider => {
    let resolved: Promise<DecisionProvider> | null = null;
    const get = () =>
      (resolved ??= registry.chain(chain, resolveCtx, {
        onFailover: (f) =>
          emit({
            type: "PROVIDER_FAILOVER",
            from: f.from,
            to: f.to,
            error: f.error.toInfo(),
          }),
      }));
    const label = hopLabel(chain[0]);
    const track = async <R extends DecisionResult>(
      state: DecisionState,
      questions: Record<string, DecisionQuestion>,
      run: (p: DecisionProvider) => Promise<R>,
    ): Promise<R> => {
      const batchId = `${call.nodeRunId}:${sha256Hex(stableStringify(questions)).slice(0, 8)}`;
      emit({
        type: "DECISION_REQUESTED",
        batchId,
        questionCount: Object.keys(questions).length,
        provider: label.provider,
        model: label.model,
        stateHash: sha256Hex(stableStringify(state)),
        questions: Object.values(questions).map((q) => q.instructions.slice(0, 500)),
      });
      const result = await run(await get());
      const question = Object.values(questions)[0]?.instructions ?? "";
      emit({
        type: "DECISION_COMPLETED",
        batchId,
        question: question.slice(0, 500),
        decision: result,
        priceSnapshot: null,
      });
      return result;
    };
    return {
      id: "chain",
      model: label.model,
      capabilities: {
        batch: true,
        maxQuestions: 16,
        maxStateTokens: 32_000,
        kinds: ["boolean", "choice", "score"],
        text: true,
        images: false,
      },
      decideBoolean: (state, question, ctx: DecisionCallContext) =>
        track<BooleanDecision>(state, { q: question }, (p) =>
          p.decideBoolean(state, question, ctx),
        ),
      decideChoice: (state, question, ctx) =>
        track<ChoiceDecision>(state, { q: question }, (p) => p.decideChoice(state, question, ctx)),
      decideScore: (state, question, ctx) =>
        track<ScoreDecision>(state, { q: question }, (p) => p.decideScore(state, question, ctx)),
      batch: async (state, questions, ctx) => {
        const provider = await get();
        const batchId = `${call.nodeRunId}:batch`;
        emit({
          type: "DECISION_REQUESTED",
          batchId,
          questionCount: Object.keys(questions).length,
          provider: label.provider,
          model: label.model,
          stateHash: sha256Hex(stableStringify(state)),
          questions: Object.keys(questions),
        });
        const result = await provider.batch(state, questions, ctx);
        for (const [key, answer] of Object.entries(result.answers))
          emit({
            type: "DECISION_COMPLETED",
            batchId,
            question: key,
            decision: answer,
            priceSnapshot: null,
          });
        return result;
      },
      health: () => HEALTHY,
    };
  };

  const generation = (ref: ModelRef): GenerationProvider => {
    let resolved: Promise<GenerationProvider> | null = null;
    const get = () => (resolved ??= registry.generation(ref, resolveCtx));
    const completed = (r: GenerationResult) =>
      emit({
        type: "GENERATION_COMPLETED",
        provider: r.provider,
        model: r.model,
        usage: r.usage,
        costUsd: r.costUsd,
        priceSnapshot: r.priceSnapshot,
        finishReason: r.finishReason,
        outputChars: r.text.length,
        latencyMs: r.latencyMs,
      });
    return {
      id: ref.provider,
      model: ref.model,
      capabilities: {
        tools: true,
        jsonSchema: true,
        vision: false,
        streaming: true,
        thinking: false,
        maxContext: 128_000,
      },
      generate: async (req: GenerationRequest, ctx) => {
        const result = await (await get()).generate(req, ctx);
        completed(result);
        return result;
      },
      stream: (req, ctx) => ({
        async *[Symbol.asyncIterator](): AsyncGenerator<GenerationChunk> {
          const provider = await get();
          for await (const chunk of provider.stream(req, ctx)) {
            if (chunk.type === "text" || chunk.type === "thinking")
              call.onDelta?.(chunk.type, chunk.delta);
            yield chunk;
          }
        },
      }),
      health: () => HEALTHY,
    };
  };

  const embedding = (ref: ModelRef): EmbeddingProvider => {
    let resolved: Promise<EmbeddingProvider> | null = null;
    const get = () => (resolved ??= registry.embedding(ref, resolveCtx));
    return {
      id: ref.provider,
      model: ref.model,
      dimensions: 0,
      embed: async (texts, ctx) => (await get()).embed(texts, ctx),
      health: () => HEALTHY,
    };
  };

  return { decision, generation, embedding };
}
