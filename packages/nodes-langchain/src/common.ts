/** Schemas and helpers shared by the LangChain nodes. */
import { z } from "zod";
import { Document } from "@langchain/core/documents";
import {
  FlowaidCallbackHandler,
  FlowaidChatModel,
  FlowaidEmbeddings,
  callbackSinkFromContext,
  type FlowaidCallbackOptions,
} from "@flowaid/langchain";
import type { ExecutionContext } from "@flowaid/node-sdk";
import type {
  CredentialSlot,
  DecisionCallContext,
  GenerationRequest,
  JsonObject,
  ModelRef,
  TokenUsage,
} from "@flowaid/workflow-core";

/** Every node id of this package starts with the package name (plugin id rule). */
export const PREFIX = "@flowaid/nodes-langchain";
export const nodeId = <N extends string>(name: N): `@flowaid/nodes-langchain.${N}` =>
  `${PREFIX}.${name}`;

export const modelRef = z
  .looseObject({ provider: z.string().min(1), model: z.string().min(1) })
  .meta({ "x-ui": { widget: "model" } });

export const usageSchema = z.object({ inputTokens: z.int().min(0), outputTokens: z.int().min(0) });

/** A LangChain document as it travels between nodes. */
export const documentSchema = z.object({
  pageContent: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  id: z.string().optional(),
});
export type PlainDocument = z.infer<typeof documentSchema>;

export const LLM_SLOT: CredentialSlot = {
  name: "llm",
  types: ["openai.api_key", "anthropic.api_key", "ollama.host", "ollama.none"],
  required: true,
  description: "Credential of the chat or embedding model (native or langchain:<vendor>).",
};

export const callCtx = (
  ctx: ExecutionContext<unknown>,
  signal?: AbortSignal,
): DecisionCallContext => ({
  signal: signal ?? ctx.signal,
  runId: ctx.run.id,
  nodeRunId: ctx.node.nodeRunId,
  idempotencyKey: ctx.node.idempotencyKey,
});

/** Usage and cost a node accumulates over several provider calls. */
export class Spend {
  usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  costUsd = 0;
  add(usage: TokenUsage | undefined, costUsd = 0): void {
    if (usage) {
      this.usage = {
        inputTokens: this.usage.inputTokens + usage.inputTokens,
        outputTokens: this.usage.outputTokens + usage.outputTokens,
      };
    }
    this.costUsd += costUsd;
  }
  get extra(): { usage: TokenUsage; costUsd: number } {
    return { usage: this.usage, costUsd: this.costUsd };
  }
}

/** The callback handler of a node: logs, deltas, metrics and the node's token/cost bounds. */
export function handlerFor(
  ctx: ExecutionContext<unknown>,
  options: FlowaidCallbackOptions = {},
): FlowaidCallbackHandler {
  // Provider calls through ctx.providers are already GENERATION_COMPLETED events; the handler only
  // enforces bounds for them (through `account`) instead of counting callback usage twice.
  return new FlowaidCallbackHandler(callbackSinkFromContext(ctx), {
    countUsage: false,
    ...options,
  });
}

/** A LangChain chat model over the node's credential-bound provider. */
export function chatModelFor(
  ctx: ExecutionContext<unknown>,
  ref: ModelRef,
  opts: {
    spend: Spend;
    handler?: FlowaidCallbackHandler;
    settings?: Pick<GenerationRequest, "temperature" | "maxOutputTokens">;
    signal?: AbortSignal;
    streaming?: boolean;
  },
): FlowaidChatModel {
  return new FlowaidChatModel({
    provider: ctx.providers.generation(ref, { credentialSlot: "llm" }),
    context: callCtx(ctx, opts.signal),
    ...(opts.settings ? { settings: opts.settings } : {}),
    ...(opts.streaming ? { streaming: true } : {}),
    onResult: (r) => {
      opts.spend.add(r.usage, r.costUsd);
      opts.handler?.account(r.usage, r.costUsd);
    },
  });
}

export function embeddingsFor(
  ctx: ExecutionContext<unknown>,
  ref: ModelRef,
  opts: { spend: Spend; batchSize?: number; slot?: string },
): FlowaidEmbeddings {
  return new FlowaidEmbeddings({
    provider: ctx.providers.embedding(ref, { credentialSlot: opts.slot ?? "llm" }),
    context: callCtx(ctx),
    ...(opts.batchSize ? { batchSize: opts.batchSize } : {}),
    onResult: (r) => opts.spend.add(r.usage, r.costUsd),
  });
}

export const toDocument = (d: PlainDocument): Document =>
  new Document({ pageContent: d.pageContent, metadata: d.metadata, ...(d.id ? { id: d.id } : {}) });

export const fromDocument = (d: Document): PlainDocument => ({
  pageContent: d.pageContent,
  metadata: JSON.parse(JSON.stringify(d.metadata ?? {})) as JsonObject,
  ...(d.id ? { id: d.id } : {}),
});

/** Both signals: the node's (cancel + timeout) and the handler's (bounds). */
export const combined = (ctx: ExecutionContext<unknown>, handler: FlowaidCallbackHandler) =>
  AbortSignal.any([ctx.signal, handler.signal]);

/** After an aborted runnable: the bound that stopped it, else the original error. */
export function rethrow(handler: FlowaidCallbackHandler, error: unknown): never {
  if (handler.exceeded) throw handler.exceeded;
  throw error;
}
