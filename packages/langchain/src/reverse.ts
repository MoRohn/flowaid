/**
 * The other direction: flowaid providers as LangChain components. `FlowaidChatModel` is a
 * LangChain `BaseChatModel` over any flowaid `GenerationProvider` (native OpenAI/Anthropic/Ollama
 * clients, `langchain:*` providers, recorded fixtures), so LCEL chains, output parsers and
 * LangGraph agents running inside a node use the node's credential-bound, traced and priced
 * provider (`ctx.providers.generation`) instead of a second, unmanaged client.
 * `FlowaidEmbeddings` does the same for `EmbeddingProvider`.
 */
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { Embeddings } from "@langchain/core/embeddings";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import type {
  DecisionCallContext,
  EmbeddingProvider,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
  TokenUsage,
  ToolDefinition,
} from "@flowaid/workflow-core";
import { fromLangChainMessages } from "./messages.js";

export interface FlowaidChatModelFields extends BaseChatModelParams {
  provider: GenerationProvider;
  /** run/node identity and the node's signal for every call */
  context: DecisionCallContext;
  settings?: Pick<GenerationRequest, "temperature" | "topP" | "maxOutputTokens" | "seed">;
  tools?: ToolDefinition[];
  toolChoice?: GenerationRequest["toolChoice"];
  /** stream through `provider.stream` (text deltas reach callbacks as tokens) */
  streaming?: boolean;
  /** every completed generation (usage/cost accounting of the node) */
  onResult?: (result: Pick<GenerationResult, "usage" | "costUsd" | "provider" | "model">) => void;
}

export type FlowaidChatModelCallOptions = BaseChatModelCallOptions;

function signalOf(context: DecisionCallContext, extra: AbortSignal | undefined): AbortSignal {
  return extra ? AbortSignal.any([context.signal, extra]) : context.signal;
}

/** A LangChain tool input (StructuredTool, OpenAI tool, ...) → flowaid `ToolDefinition`. */
export function toolDefinitionOf(tool: BindToolsInput): ToolDefinition {
  const t = convertToOpenAITool(tool as Record<string, unknown>) as {
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  };
  return {
    name: t.function.name,
    description: (t.function.description ?? "").slice(0, 4000),
    inputSchema: t.function.parameters ?? { type: "object" },
    idempotency: "none",
    approvalRequired: false,
    source: { kind: "builtin", id: t.function.name },
  };
}

const usageMetadata = (u: TokenUsage) => ({
  input_tokens: u.inputTokens,
  output_tokens: u.outputTokens,
  total_tokens: u.inputTokens + u.outputTokens,
  ...(u.cacheReadTokens || u.cacheWriteTokens
    ? {
        input_token_details: {
          ...(u.cacheReadTokens ? { cache_read: u.cacheReadTokens } : {}),
          ...(u.cacheWriteTokens ? { cache_creation: u.cacheWriteTokens } : {}),
        },
      }
    : {}),
});

export class FlowaidChatModel extends BaseChatModel<FlowaidChatModelCallOptions> {
  readonly fields: FlowaidChatModelFields;

  static override lc_name() {
    return "FlowaidChatModel";
  }

  constructor(fields: FlowaidChatModelFields) {
    super(fields);
    this.fields = fields;
  }

  get model(): string {
    return this.fields.provider.model;
  }

  _llmType(): string {
    return "flowaid";
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<FlowaidChatModelCallOptions> & { tool_choice?: unknown },
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, FlowaidChatModelCallOptions> {
    const choice = kwargs?.tool_choice;
    return new FlowaidChatModel({
      ...this.fields,
      tools: tools.map(toolDefinitionOf),
      ...(choice === "any" || choice === "required"
        ? { toolChoice: "required" as const }
        : choice === "auto" || choice === "none"
          ? { toolChoice: choice }
          : typeof choice === "string"
            ? { toolChoice: { name: choice } }
            : {}),
    });
  }

  private request(messages: BaseMessage[], options: this["ParsedCallOptions"]): GenerationRequest {
    const f = this.fields;
    return {
      messages: fromLangChainMessages(messages),
      ...(f.tools?.length ? { tools: f.tools } : {}),
      ...(f.toolChoice ? { toolChoice: f.toolChoice } : {}),
      ...(options.stop?.length ? { stop: options.stop } : {}),
      ...f.settings,
    };
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    if (this.fields.streaming) {
      let final: ChatGenerationChunk | undefined;
      for await (const chunk of this._streamResponseChunks(messages, options, runManager))
        final = final ? final.concat(chunk) : chunk;
      const message = final?.message ?? new AIMessageChunk({ content: "" });
      return {
        generations: [{ text: final?.text ?? "", message: new AIMessage({ ...message }) }],
      };
    }
    const ctx = { ...this.fields.context, signal: signalOf(this.fields.context, options.signal) };
    const r = await this.fields.provider.generate(this.request(messages, options), ctx);
    this.fields.onResult?.(r);
    const message = new AIMessage({
      content: r.text,
      tool_calls: r.toolCalls.map((c) => ({
        id: c.id,
        name: c.name,
        args: (c.args ?? {}) as Record<string, unknown>,
        type: "tool_call" as const,
      })),
      usage_metadata: usageMetadata(r.usage),
      response_metadata: {
        finish_reason: r.finishReason,
        model_name: r.model,
        model_provider: r.provider,
        cost_usd: r.costUsd,
      },
    });
    return {
      generations: [{ text: r.text, message }],
      llmOutput: {
        tokenUsage: { promptTokens: r.usage.inputTokens, completionTokens: r.usage.outputTokens },
      },
    };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const ctx = { ...this.fields.context, signal: signalOf(this.fields.context, options.signal) };
    let usage: TokenUsage | undefined;
    for await (const c of this.fields.provider.stream(this.request(messages, options), ctx)) {
      if (c.type === "text") {
        yield new ChatGenerationChunk({
          text: c.delta,
          message: new AIMessageChunk({ content: c.delta }),
        });
        await runManager?.handleLLMNewToken(c.delta);
      } else if (c.type === "tool_call") {
        yield new ChatGenerationChunk({
          text: "",
          message: new AIMessageChunk({
            content: "",
            tool_call_chunks: [
              {
                index: c.index,
                ...(c.id ? { id: c.id } : {}),
                ...(c.name ? { name: c.name } : {}),
                args: c.argsDelta,
                type: "tool_call_chunk",
              },
            ],
          }),
        });
      } else if (c.type === "usage") {
        usage = c.usage;
        yield new ChatGenerationChunk({
          text: "",
          message: new AIMessageChunk({ content: "", usage_metadata: usageMetadata(c.usage) }),
        });
      } else if (c.type === "done") {
        yield new ChatGenerationChunk({
          text: "",
          message: new AIMessageChunk({
            content: "",
            response_metadata: { finish_reason: c.finishReason },
          }),
        });
      }
    }
    if (usage)
      this.fields.onResult?.({
        usage,
        costUsd: 0,
        provider: this.fields.provider.id,
        model: this.fields.provider.model,
      });
  }
}

export interface FlowaidEmbeddingsFields {
  provider: EmbeddingProvider;
  context: DecisionCallContext;
  batchSize?: number;
  onResult?: (result: { usage: TokenUsage; costUsd: number }) => void;
}

/** A LangChain `Embeddings` over a flowaid `EmbeddingProvider`. */
export class FlowaidEmbeddings extends Embeddings {
  constructor(private readonly fields: FlowaidEmbeddingsFields) {
    super({});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const size = this.fields.batchSize ?? 96;
    const out: number[][] = [];
    for (let i = 0; i < documents.length; i += size) {
      const r = await this.fields.provider.embed(documents.slice(i, i + size), this.fields.context);
      this.fields.onResult?.({ usage: r.usage, costUsd: r.costUsd });
      out.push(...r.vectors);
    }
    return out;
  }

  async embedQuery(document: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([document]);
    return vector ?? [];
  }
}
