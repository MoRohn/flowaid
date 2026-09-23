/**
 * `TypeSafeDecisionProvider` (ARCHITECTURE.md §6.3) and its registry factory. Single questions
 * are batches of one; `batch()` sends every question in one request against one state and
 * splits the usage and cost across the answers.
 */
import type {
  BooleanDecision,
  BooleanQuestion,
  ChoiceDecision,
  ChoiceQuestion,
  DecisionCallContext,
  DecisionProvider,
  DecisionQuestion,
  DecisionResult,
  DecisionState,
  ProviderFactory,
  ProviderHealth,
  SafeFetch,
  ScoreDecision,
  ScoreQuestion,
  TokenUsage,
} from "@flowaid/workflow-core";
import { ProviderError } from "@flowaid/workflow-core";
import { TypeSafeClient } from "./client.js";
import { fromSystemOneAnswer, splitUsage, toSystemOneRequest } from "./mapping.js";
import { TYPESAFE_INPUT_PRICE_PER_TOKEN, TYPESAFE_MAX_STATE_TOKENS } from "./schemas.js";

export const TYPESAFE_DEFAULT_MODEL = "jev-latest";

export class TypeSafeDecisionProvider implements DecisionProvider {
  readonly id = "typesafe";
  readonly capabilities = {
    batch: true,
    maxQuestions: 64,
    maxStateTokens: TYPESAFE_MAX_STATE_TOKENS,
    kinds: ["boolean", "choice", "score"] as const,
    text: true,
    images: false,
  };

  constructor(
    private readonly client: TypeSafeClient,
    readonly model: string = TYPESAFE_DEFAULT_MODEL,
  ) {}

  async batch(
    state: DecisionState,
    questions: Record<string, DecisionQuestion>,
    ctx: DecisionCallContext,
  ): Promise<{
    answers: Record<string, DecisionResult>;
    usage: TokenUsage;
    model: string;
    requestId: string | null;
    latencyMs: number;
  }> {
    const ids = Object.keys(questions);
    if (ids.length === 0)
      throw new ProviderError("A TypeSafe request needs at least one question", false, "typesafe");
    const { body, requestId, latencyMs } = await this.client.systemOne(
      toSystemOneRequest(this.model, state, questions),
      ctx.signal,
    );
    const usage: TokenUsage = {
      inputTokens: body.usage.input_tokens,
      outputTokens: body.usage.output_tokens,
    };
    const shares = splitUsage(usage, ids);
    const answers: Record<string, DecisionResult> = {};
    for (const id of ids) {
      const answer = body.answers[id];
      const question = questions[id];
      if (!answer || !question)
        throw new ProviderError(`TypeSafe did not answer question '${id}'`, true, "typesafe");
      const share = shares.get(id) ?? {
        usage,
        costUsd: usage.inputTokens * TYPESAFE_INPUT_PRICE_PER_TOKEN,
      };
      answers[id] = fromSystemOneAnswer(id, answer, question, {
        model: body.model,
        latencyMs,
        usage: share.usage,
        costUsd: share.costUsd,
        requestId,
        ...(ctx.booleanThreshold !== undefined ? { booleanThreshold: ctx.booleanThreshold } : {}),
      });
    }
    return { answers, usage, model: body.model, requestId, latencyMs };
  }

  private async one<R extends DecisionResult>(
    state: DecisionState,
    question: DecisionQuestion,
    ctx: DecisionCallContext,
  ): Promise<R> {
    const { answers } = await this.batch(state, { q: question }, ctx);
    return answers.q as R;
  }

  decideBoolean(
    state: DecisionState,
    question: BooleanQuestion,
    ctx: DecisionCallContext,
  ): Promise<BooleanDecision> {
    return this.one<BooleanDecision>(state, question, ctx);
  }

  decideChoice(
    state: DecisionState,
    question: ChoiceQuestion,
    ctx: DecisionCallContext,
  ): Promise<ChoiceDecision> {
    return this.one<ChoiceDecision>(state, question, ctx);
  }

  decideScore(
    state: DecisionState,
    question: ScoreQuestion,
    ctx: DecisionCallContext,
  ): Promise<ScoreDecision> {
    return this.one<ScoreDecision>(state, question, ctx);
  }

  /** Health is tracked by the registry's HealthTracker around every call. */
  health(): ProviderHealth {
    return {
      status: "healthy",
      errorRate1m: 0,
      p95LatencyMs: 0,
      consecutiveFailures: 0,
      checkedAt: new Date().toISOString(),
    };
  }
}

/** Registry factory: `registry.register(typesafeFactory())`. Credential type `typesafe.api_key`. */
export function typesafeFactory(
  opts: { baseUrl?: string } = {},
): ProviderFactory<DecisionProvider> {
  return {
    id: "typesafe",
    kind: "decision",
    credentialType: "typesafe.api_key",
    create: ({
      model,
      credential,
      http,
    }: {
      model: string;
      credential: Record<string, string> | undefined;
      http: SafeFetch;
    }) => {
      const apiKey = credential?.apiKey;
      if (!apiKey)
        throw new ProviderError("The TypeSafe credential has no apiKey", false, "typesafe");
      const baseUrl = credential.baseUrl ?? opts.baseUrl;
      return new TypeSafeDecisionProvider(
        new TypeSafeClient({ apiKey, http, ...(baseUrl ? { baseUrl } : {}) }),
        model || TYPESAFE_DEFAULT_MODEL,
      );
    },
  };
}
