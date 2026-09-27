/** Test-only LangChain fakes: a scripted chat model and deterministic embeddings (no network). */
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { Embeddings } from "@langchain/core/embeddings";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type {
  GenerationChunk,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
  ProviderHealth,
} from "@flowaid/workflow-core";

export interface ScriptStep {
  text?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  usage?: { input: number; output: number; cacheRead?: number };
  finish?: string;
  error?: Error & { status?: number };
  reasoning?: string;
}

export interface ScriptLog {
  messages: BaseMessage[][];
  tools: BindToolsInput[][];
  options: Record<string, unknown>[];
}

/** A chat model that replays `steps` in order (the last step repeats). */
export class ScriptedChatModel extends BaseChatModel {
  i = 0;
  constructor(
    readonly steps: ScriptStep[],
    readonly log: ScriptLog = { messages: [], tools: [], options: [] },
    private readonly boundTools: BindToolsInput[] = [],
    readonly modelName = "scripted-1",
  ) {
    super({});
  }

  _llmType() {
    return "scripted";
  }

  override bindTools(tools: BindToolsInput[], kwargs?: Record<string, unknown>) {
    const bound = new ScriptedChatModel(this.steps, this.log, tools, this.modelName);
    bound.i = this.i;
    this.log.options.push({ bindTools: kwargs ?? {} });
    // share the cursor with the parent so scripts continue across bindings
    Object.defineProperty(bound, "i", {
      get: () => this.i,
      set: (v: number) => {
        this.i = v;
      },
    });
    return bound as unknown as ReturnType<BaseChatModel["bindTools"] & object>;
  }

  private next(messages: BaseMessage[]): ScriptStep {
    this.log.messages.push(messages);
    this.log.tools.push(this.boundTools);
    const step = this.steps[Math.min(this.i, this.steps.length - 1)] ?? {};
    this.i += 1;
    if (step.error) throw step.error;
    return step;
  }

  private message(step: ScriptStep) {
    return new AIMessage({
      content: step.reasoning
        ? [
            { type: "thinking", thinking: step.reasoning },
            { type: "text", text: step.text ?? "" },
          ]
        : (step.text ?? ""),
      tool_calls: (step.toolCalls ?? []).map((c) => ({ ...c, type: "tool_call" as const })),
      ...(step.usage
        ? {
            usage_metadata: {
              input_tokens: step.usage.input,
              output_tokens: step.usage.output,
              total_tokens: step.usage.input + step.usage.output,
              ...(step.usage.cacheRead
                ? { input_token_details: { cache_read: step.usage.cacheRead } }
                : {}),
            },
          }
        : {}),
      response_metadata: step.finish ? { finish_reason: step.finish } : {},
    });
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    this.log.options.push({ stop: options.stop, signal: options.signal !== undefined });
    const step = this.next(messages);
    await Promise.resolve();
    return { generations: [{ text: step.text ?? "", message: this.message(step) }] };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: BaseChatModelCallOptions,
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const step = this.next(messages);
    if (step.reasoning)
      yield new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({ content: [{ type: "thinking", thinking: step.reasoning }] }),
      });
    for (const piece of (step.text ?? "").match(/.{1,3}/gs) ?? []) {
      yield new ChatGenerationChunk({
        text: piece,
        message: new AIMessageChunk({ content: piece }),
      });
      await runManager?.handleLLMNewToken(piece);
    }
    for (const [index, call] of (step.toolCalls ?? []).entries()) {
      const args = JSON.stringify(call.args);
      const half = Math.ceil(args.length / 2);
      yield new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({
          content: "",
          tool_call_chunks: [
            {
              index,
              id: call.id,
              name: call.name,
              args: args.slice(0, half),
              type: "tool_call_chunk",
            },
          ],
        }),
      });
      yield new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({
          content: "",
          tool_call_chunks: [{ index, args: args.slice(half), type: "tool_call_chunk" }],
        }),
      });
    }
    yield new ChatGenerationChunk({
      text: "",
      message: new AIMessageChunk({
        content: "",
        ...(step.usage
          ? {
              usage_metadata: {
                input_tokens: step.usage.input,
                output_tokens: step.usage.output,
                total_tokens: step.usage.input + step.usage.output,
              },
            }
          : {}),
        response_metadata: step.finish ? { finish_reason: step.finish } : {},
      }),
    });
  }
}

/** Deterministic embeddings: a 4-dimensional bag of character classes. */
export class HashEmbeddings extends Embeddings {
  calls = 0;
  constructor() {
    super({});
  }
  embedDocuments(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    return Promise.resolve(texts.map(vectorOf));
  }
  embedQuery(text: string): Promise<number[]> {
    return Promise.resolve(vectorOf(text));
  }
}

export function vectorOf(text: string): number[] {
  const t = text.toLowerCase();
  const v = [
    (t.match(/[aeiou]/g) ?? []).length,
    (t.match(/[b-df-hj-np-tv-z]/g) ?? []).length,
    (t.match(/[0-9]/g) ?? []).length,
    (t.match(/\s/g) ?? []).length + 1,
  ];
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export const HEALTHY: ProviderHealth = {
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

/** A flowaid GenerationProvider answering from a script (for the reverse adapters). */
export function scriptedProvider(
  steps: Partial<GenerationResult>[],
): GenerationProvider & { requests: GenerationRequest[] } {
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
      usage: { inputTokens: 5, outputTokens: 7 },
      costUsd: 0.002,
      priceSnapshot: null,
      latencyMs: 1,
      provider: "fake",
      model: "fake-1",
      ...s,
    };
  };
  return {
    id: "fake",
    model: "fake-1",
    requests,
    capabilities: {
      tools: true,
      jsonSchema: true,
      vision: false,
      streaming: true,
      thinking: false,
      maxContext: 8000,
    },
    generate: (req) => Promise.resolve(next(req)),
    stream: (req) => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<GenerationChunk> {
        await Promise.resolve();
        const r = next(req);
        for (const piece of r.text.match(/.{1,4}/gs) ?? []) yield { type: "text", delta: piece };
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
