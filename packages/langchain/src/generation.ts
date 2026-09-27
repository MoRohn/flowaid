/**
 * `LangChainGenerationProvider` (LANGCHAIN.md §2): any LangChain chat model as a flowaid
 * `GenerationProvider`. `.stream()` becomes `GenerationChunk`s (text, reasoning, tool-call
 * argument deltas, usage, done); `bindTools` carries `GenerationRequest.tools`;
 * `withStructuredOutput` (with `includeRaw`, so usage survives) carries JSON Schema responses;
 * `usage_metadata` (including cache reads/writes) becomes `TokenUsage`; the node's `AbortSignal`
 * travels in the `RunnableConfig`; vendor errors map onto the flowaid taxonomy.
 *
 * Per-call sampling settings (temperature, max tokens, top-p, seed) are not part of LangChain's
 * portable call options, so a provider built from a `ChatModelBuilder` constructs the model per
 * distinct setting set (cached); a provider built from a ready model uses the model as configured.
 */
import type { BaseChatModel, BindToolsInput } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { Runnable, RunnableConfig } from "@langchain/core/runnables";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import { HealthTracker, parseJsonLoose } from "@flowaid/providers";
import {
  ProviderError,
  type DecisionCallContext,
  type GenerationChunk,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type JsonValue,
  type ModelCatalog,
  type PriceSnapshot,
  type TokenUsage,
} from "@flowaid/workflow-core";
import { toProviderError } from "./errors.js";
import {
  addUsage,
  finishReasonOf,
  reasoningOf,
  textOf,
  toLangChainMessages,
  toolCallsOf,
  usageOf,
} from "./messages.js";

/** Sampling settings a builder receives; absent fields keep the vendor default. */
export interface ChatModelSettings {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  seed?: number;
}
export type ChatModelBuilder = (settings: ChatModelSettings) => BaseChatModel;

export interface LangChainGenerationOptions {
  /** Provider id; default `langchain:<llmType>` (e.g. `langchain:openai`). */
  id?: string;
  /** Model name reported in results and events; default the model's `model`/`modelName` field. */
  model?: string;
  /** Pricing through the model catalog under a native provider id (e.g. `openai`). */
  pricing?: { catalog: ModelCatalog; provider: string };
  capabilities?: Partial<GenerationProvider["capabilities"]>;
  /** Extra LangChain callbacks (e.g. a `FlowaidCallbackHandler`) attached to every call. */
  callbacks?: Callbacks;
  /** Clock for latency and health (tests). */
  now?: () => number;
}

const healthTracker = new HealthTracker();

function modelNameOf(model: BaseChatModel): string {
  const m = model as unknown as { model?: unknown; modelName?: unknown };
  if (typeof m.model === "string") return m.model;
  if (typeof m.modelName === "string") return m.modelName;
  return model._llmType();
}

function toolChoiceOf(choice: GenerationRequest["toolChoice"]): string | undefined {
  if (choice === undefined) return undefined;
  if (typeof choice === "object") return choice.name;
  return choice === "required" ? "any" : choice;
}

export class LangChainGenerationProvider implements GenerationProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: GenerationProvider["capabilities"];
  private readonly base: BaseChatModel;
  private readonly builder: ChatModelBuilder | undefined;
  private readonly built = new Map<string, BaseChatModel>();
  private readonly now: () => number;

  constructor(
    model: BaseChatModel | ChatModelBuilder,
    private readonly options: LangChainGenerationOptions = {},
  ) {
    this.builder = typeof model === "function" ? model : undefined;
    this.base = typeof model === "function" ? model({}) : model;
    this.id = options.id ?? `langchain:${this.base._llmType()}`;
    this.model = options.model ?? modelNameOf(this.base);
    this.now = options.now ?? Date.now;
    this.capabilities = {
      tools: typeof this.base.bindTools === "function",
      jsonSchema: typeof this.base.withStructuredOutput === "function",
      vision: false,
      streaming: true,
      thinking: false,
      maxContext: 128_000,
      ...options.capabilities,
    };
  }

  private modelFor(req: GenerationRequest): BaseChatModel {
    if (!this.builder) return this.base;
    const settings: ChatModelSettings = {
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.topP !== undefined ? { topP: req.topP } : {}),
      ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    };
    const key = JSON.stringify(settings);
    let model = this.built.get(key);
    if (!model) {
      model = Object.keys(settings).length === 0 ? this.base : this.builder(settings);
      if (this.built.size > 32) this.built.clear();
      this.built.set(key, model);
    }
    return model;
  }

  private config(req: GenerationRequest, ctx: DecisionCallContext): RunnableConfig {
    return {
      signal: ctx.signal,
      ...(this.options.callbacks ? { callbacks: this.options.callbacks } : {}),
      metadata: { ...req.metadata, flowaid_run_id: ctx.runId, flowaid_node_run_id: ctx.nodeRunId },
      runName: `${this.id}/${this.model}`,
      ...(req.stop ? ({ stop: req.stop } as RunnableConfig) : {}),
    };
  }

  /** The runnable for a plain (non-structured) request: the model, with tools bound when asked. */
  private chatRunnable(req: GenerationRequest): Runnable<BaseMessage[], BaseMessage> {
    const model = this.modelFor(req);
    if (!req.tools?.length || req.toolChoice === "none") return model;
    if (typeof model.bindTools !== "function")
      throw new ProviderError(`${this.id} does not support tool calling`, false, this.id);
    const tools: BindToolsInput[] = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    const choice = toolChoiceOf(req.toolChoice);
    return model.bindTools(tools, choice ? { tool_choice: choice } : {}) as Runnable<
      BaseMessage[],
      BaseMessage
    >;
  }

  private price(usage: TokenUsage): { costUsd: number; snapshot: PriceSnapshot | null } {
    const p = this.options.pricing;
    if (!p) return { costUsd: 0, snapshot: null };
    return p.catalog.price(p.provider, this.model, usage);
  }

  private record<T>(started: number, run: () => Promise<T>): Promise<T> {
    return run().then(
      (value) => {
        healthTracker.record(this.key, { ok: true, latencyMs: this.now() - started });
        return value;
      },
      (error: unknown) => {
        const e = toProviderError(error, this.id);
        healthTracker.record(this.key, {
          ok: false,
          latencyMs: this.now() - started,
          code: e.code,
          retryable: e.retryable,
        });
        throw e;
      },
    );
  }

  private get key(): string {
    return `${this.id}:${this.model}`;
  }

  async generate(req: GenerationRequest, ctx: DecisionCallContext): Promise<GenerationResult> {
    const started = this.now();
    return this.record(started, async () => {
      const messages = toLangChainMessages(req.messages);
      const config = this.config(req, ctx);
      const format = req.responseFormat;
      if (format?.type === "json_schema") {
        const model = this.modelFor(req);
        if (typeof model.withStructuredOutput === "function") {
          const schema = { title: "response", ...format.schema } as Record<string, unknown>;
          let runnable: ReturnType<typeof structured>;
          const structured = (strict: boolean | undefined) =>
            model.withStructuredOutput(schema, {
              name: "response",
              includeRaw: true,
              ...(strict === undefined ? {} : { strict }),
            });
          try {
            runnable = structured(format.strict);
          } catch {
            // models without native strict mode refuse the flag when the runnable is built
            runnable = structured(undefined);
          }
          const out = await runnable.invoke(messages, config);
          // `parsed` is null when LangChain's parser rejected the raw message shape; recover the
          // `response` tool call (or JSON text) from the raw message instead of failing.
          const parsed =
            (out.parsed as JsonValue | null) ??
            toolCallsOf(out.raw).find((c) => c.name === "response")?.args ??
            parseJsonLoose(textOf(out.raw));
          return this.result(out.raw, started, parsed ?? undefined);
        }
        // No native structured output: ask for JSON and parse it leniently.
        const instructed = [
          ...messages,
          ...toLangChainMessages([
            {
              role: "system",
              content: `Reply with one JSON value that matches this JSON Schema, and nothing else:\n${JSON.stringify(format.schema)}`,
            },
          ]),
        ];
        const raw = await model.invoke(instructed, config);
        return this.result(raw, started, parseJsonLoose(textOf(raw)));
      }
      const raw = await this.chatRunnable(req).invoke(messages, config);
      return this.result(raw, started);
    });
  }

  private result(raw: BaseMessage, started: number, structured?: JsonValue): GenerationResult {
    const toolCalls = toolCallsOf(raw);
    const usage = usageOf((raw as { usage_metadata?: never }).usage_metadata) ?? {
      inputTokens: 0,
      outputTokens: 0,
    };
    const { costUsd, snapshot } = this.price(usage);
    return {
      text: textOf(raw),
      toolCalls,
      ...(structured !== undefined ? { structured } : {}),
      finishReason: finishReasonOf(raw.response_metadata, toolCalls.length > 0),
      usage,
      costUsd,
      priceSnapshot: snapshot,
      latencyMs: this.now() - started,
      provider: this.id,
      model: this.model,
    };
  }

  stream(req: GenerationRequest, ctx: DecisionCallContext): AsyncIterable<GenerationChunk> {
    // Structured output is not streamed portably: generate, then replay it as chunks.
    if (req.responseFormat?.type === "json_schema")
      return {
        [Symbol.asyncIterator]: async function* (this: LangChainGenerationProvider) {
          const r = await this.generate(req, ctx);
          const text = r.structured !== undefined ? JSON.stringify(r.structured) : r.text;
          if (text) yield { type: "text" as const, delta: text };
          yield { type: "usage" as const, usage: r.usage };
          yield { type: "done" as const, finishReason: r.finishReason };
        }.bind(this),
      };
    return { [Symbol.asyncIterator]: () => this.streamChunks(req, ctx) };
  }

  private async *streamChunks(
    req: GenerationRequest,
    ctx: DecisionCallContext,
  ): AsyncGenerator<GenerationChunk> {
    const started = this.now();
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let sawUsage = false;
    let metadata: Record<string, unknown> = {};
    let toolCalls = 0;
    try {
      const stream = await this.chatRunnable(req).stream(
        toLangChainMessages(req.messages),
        this.config(req, ctx),
      );
      for await (const chunk of stream) {
        const text = textOf(chunk);
        if (text) yield { type: "text", delta: text };
        const thinking = reasoningOf(chunk);
        if (thinking) yield { type: "thinking", delta: thinking };
        const calls =
          (
            chunk as {
              tool_call_chunks?: { index?: number; id?: string; name?: string; args?: string }[];
            }
          ).tool_call_chunks ?? [];
        for (const call of calls) {
          toolCalls = Math.max(toolCalls, (call.index ?? 0) + 1);
          yield {
            type: "tool_call",
            index: call.index ?? 0,
            ...(call.id ? { id: call.id } : {}),
            ...(call.name ? { name: call.name } : {}),
            argsDelta: call.args ?? "",
          };
        }
        const u = usageOf((chunk as { usage_metadata?: never }).usage_metadata);
        if (u) {
          usage = addUsage(usage, u);
          sawUsage = true;
        }
        metadata = { ...metadata, ...chunk.response_metadata };
      }
    } catch (error) {
      const e = toProviderError(error, this.id);
      healthTracker.record(this.key, {
        ok: false,
        latencyMs: this.now() - started,
        code: e.code,
        retryable: e.retryable,
      });
      throw e;
    }
    healthTracker.record(this.key, { ok: true, latencyMs: this.now() - started });
    if (sawUsage) yield { type: "usage", usage };
    yield { type: "done", finishReason: finishReasonOf(metadata, toolCalls > 0) };
  }

  health() {
    return healthTracker.health(this.key);
  }
}
