/**
 * `FlowaidCallbackHandler` (LANGCHAIN.md §2): LangChain callbacks → the node's run events, so a
 * LangChain runnable executed inside a node shows up in the trace, the cost breakdown and the
 * bounds.
 *
 * - tokens → `GENERATION_DELTA` (`ctx.events.stream('text' | 'thinking')`);
 * - LLM start/end, tool start/end/error, retriever start/end, chain errors → `LOG` entries
 *   (prompts pass through the `redact` function and are truncated);
 * - usage → `METRIC` events (`langchain.tokens.input`, `.output`, `langchain.cost_usd`) and the
 *   handler's own budget: when `maxTokens`/`maxCostUsd` (or the node's remaining budget) is
 *   exceeded, `signal` aborts with a `BoundsExceededError` so the runnable stops at the next await.
 *
 * Generations that go through `ctx.providers` (e.g. `FlowaidChatModel`) and tools called through
 * `ctx.tools` already produce `GENERATION_COMPLETED` / `TOOL_CALLED` / `TOOL_RETURNED` in the
 * runtime; set `countUsage: false` for those so spend is not counted twice in the handler budget.
 */
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import type { DocumentInterface } from "@langchain/core/documents";
import type { ExecutionContext } from "@flowaid/node-sdk";
import {
  BoundsExceededError,
  type JsonValue,
  type ModelCatalog,
  type TokenUsage,
} from "@flowaid/workflow-core";
import { usageOf } from "./messages.js";

export interface CallbackSink {
  stream?: (channel: "text" | "thinking", delta: string) => void;
  log: (level: "debug" | "info" | "warn" | "error", message: string, data?: JsonValue) => void;
  metric?: (name: string, value: number, labels?: Record<string, string>) => void;
  /** remaining node budget at construction time (null = unbounded) */
  remaining?: { costUsd: number | null; tokens: number | null };
}

export interface FlowaidCallbackOptions {
  maxTokens?: number;
  maxCostUsd?: number;
  /** price LangChain-native usage (models that do not go through ctx.providers) */
  pricing?: { catalog: ModelCatalog; provider: string };
  /** count usage from LLM callbacks into the handler budget (default true) */
  countUsage?: boolean;
  /** stream model tokens as GENERATION_DELTA (default true) */
  streamTokens?: boolean;
  /** applied to prompts and tool inputs before they are logged (e.g. the observability Redactor) */
  redact?: (text: string) => string;
  /** max characters of a prompt/tool payload in a log entry (default 2000) */
  maxLogChars?: number;
}

/** The sink of a node's ExecutionContext. */
export function callbackSinkFromContext(ctx: ExecutionContext<unknown>): CallbackSink {
  return {
    stream: (channel, delta) => {
      try {
        ctx.events.stream(channel, delta);
      } catch {
        // the node did not declare 'streaming': deltas are dropped, the final text is still returned
      }
    },
    log: (level, message, data) => ctx.logger[level](message, data),
    metric: (name, value, labels) =>
      ctx.events.emit({ type: "METRIC", name, value, ...(labels ? { labels } : {}) }),
    remaining: { costUsd: ctx.budget.remainingCostUsd, tokens: ctx.budget.remainingTokens },
  };
}

function min(a: number | undefined, b: number | null | undefined): number | undefined {
  if (b === null || b === undefined) return a;
  return a === undefined ? b : Math.min(a, b);
}

export class FlowaidCallbackHandler extends BaseCallbackHandler {
  name = "flowaid";
  override awaitHandlers = true;
  readonly usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  costUsd = 0;
  toolCalls = 0;
  llmCalls = 0;
  private readonly controller = new AbortController();
  private readonly limits: { tokens: number | undefined; costUsd: number | undefined };
  private readonly names = new Map<string, string>();

  constructor(
    private readonly sink: CallbackSink,
    private readonly options: FlowaidCallbackOptions = {},
  ) {
    super();
    this.limits = {
      tokens: min(options.maxTokens, sink.remaining?.tokens),
      costUsd: min(options.maxCostUsd, sink.remaining?.costUsd),
    };
  }

  /** Aborts when a bound is exceeded; combine it with the node's signal. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The bound that stopped the runnable, if any. */
  get exceeded(): BoundsExceededError | undefined {
    const r: unknown = this.controller.signal.reason;
    return r instanceof BoundsExceededError ? r : undefined;
  }

  private clip(text: string): string {
    const redacted = this.options.redact ? this.options.redact(text) : text;
    const max = this.options.maxLogChars ?? 2000;
    return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted;
  }

  private label(serialized: Serialized | undefined, runName: string | undefined): string {
    if (runName) return runName;
    const id = serialized?.id;
    return Array.isArray(id) ? String(id[id.length - 1]) : "runnable";
  }

  override handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _parent?: string,
    _extra?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    const name = this.label(llm, runName);
    this.names.set(runId, name);
    this.llmCalls += 1;
    const prompt = (messages[0] ?? [])
      .map(
        (m) =>
          `${m.getType()}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
      )
      .join("\n");
    this.sink.log("debug", `langchain: ${name} started`, { prompt: this.clip(prompt) });
  }

  override handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    _parent?: string,
    _extra?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    const name = this.label(llm, runName);
    this.names.set(runId, name);
    this.llmCalls += 1;
    this.sink.log("debug", `langchain: ${name} started`, { prompt: this.clip(prompts.join("\n")) });
  }

  override handleLLMNewToken(token: string): void {
    if (token && this.options.streamTokens !== false) this.sink.stream?.("text", token);
  }

  override handleLLMEnd(output: LLMResult, runId: string): void {
    const name = this.names.get(runId) ?? "llm";
    const generation = output.generations[0]?.[0] as
      { message?: { usage_metadata?: never } } | undefined;
    const usage =
      usageOf(generation?.message?.usage_metadata) ??
      (() => {
        const t = output.llmOutput?.tokenUsage as
          { promptTokens?: number; completionTokens?: number } | undefined;
        return t
          ? { inputTokens: t.promptTokens ?? 0, outputTokens: t.completionTokens ?? 0 }
          : undefined;
      })();
    this.sink.log("debug", `langchain: ${name} finished`, usage ? { ...usage } : undefined);
    if (!usage || this.options.countUsage === false) return;
    this.usage.inputTokens += usage.inputTokens;
    this.usage.outputTokens += usage.outputTokens;
    const p = this.options.pricing;
    const cost = p ? p.catalog.price(p.provider, name, usage).costUsd : 0;
    this.costUsd += cost;
    this.sink.metric?.("langchain.tokens.input", usage.inputTokens, { model: name });
    this.sink.metric?.("langchain.tokens.output", usage.outputTokens, { model: name });
    if (cost) this.sink.metric?.("langchain.cost_usd", cost, { model: name });
    this.check();
  }

  /** Adds usage from elsewhere (e.g. FlowaidChatModel.onResult) and enforces the bounds. */
  account(usage: TokenUsage, costUsd = 0): void {
    this.usage.inputTokens += usage.inputTokens;
    this.usage.outputTokens += usage.outputTokens;
    this.costUsd += costUsd;
    this.check();
  }

  private check(): void {
    if (this.controller.signal.aborted) return;
    const tokens = this.usage.inputTokens + this.usage.outputTokens;
    if (this.limits.tokens !== undefined && tokens > this.limits.tokens)
      this.controller.abort(new BoundsExceededError("maxTokens", this.limits.tokens, tokens));
    else if (this.limits.costUsd !== undefined && this.costUsd > this.limits.costUsd)
      this.controller.abort(
        new BoundsExceededError("maxCostUsd", this.limits.costUsd, this.costUsd),
      );
  }

  override handleLLMError(error: unknown, runId: string): void {
    this.sink.log("warn", `langchain: ${this.names.get(runId) ?? "llm"} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  override handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    _parent?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    const name = this.label(tool, runName);
    this.names.set(runId, name);
    this.toolCalls += 1;
    this.sink.log("info", `langchain: tool ${name} called`, { input: this.clip(input) });
  }

  override handleToolEnd(output: unknown, runId: string): void {
    const text = typeof output === "string" ? output : (JSON.stringify(output) ?? "");
    this.sink.log("info", `langchain: tool ${this.names.get(runId) ?? "tool"} returned`, {
      output: this.clip(text),
    });
  }

  override handleToolError(error: unknown, runId: string): void {
    this.sink.log("warn", `langchain: tool ${this.names.get(runId) ?? "tool"} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  override handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string,
    _parent?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    name?: string,
  ): void {
    const label = this.label(retriever, name);
    this.names.set(runId, label);
    this.sink.log("info", `langchain: retriever ${label} queried`, { query: this.clip(query) });
  }

  override handleRetrieverEnd(documents: DocumentInterface[], runId: string): void {
    this.sink.log("info", `langchain: retriever ${this.names.get(runId) ?? "retriever"} returned`, {
      documents: documents.length,
    });
    this.sink.metric?.("langchain.retriever.documents", documents.length);
  }

  override handleChainError(error: unknown, runId: string, parentRunId?: string): void {
    if (parentRunId) return; // reported once, at the top
    this.sink.log("warn", "langchain: runnable failed", {
      run: runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
