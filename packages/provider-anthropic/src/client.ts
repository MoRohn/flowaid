/**
 * `AnthropicClient` (ARCHITECTURE.md §6.6): Claude through the Messages API
 * (`anthropic-version: 2023-06-01`).
 *
 * - System messages become the `system` blocks; a system prompt over ~1k tokens gets
 *   `cache_control: { type: "ephemeral" }` so repeated calls read it from the prompt cache.
 * - Tools map to `tools` / `tool_use`; tool results to `tool_result` blocks.
 * - Structured output: a forced tool `respond` whose `input_schema` is the requested schema; its
 *   input is the structured result (Claude has no response_format).
 * - Streaming: `message_start` (usage), `content_block_start` / `content_block_delta` (text,
 *   thinking, input_json), `message_delta` (stop reason, output usage), `error` events.
 * - Usage: `TokenUsage.inputTokens` includes cache reads and writes (the catalog convention);
 *   `cacheReadTokens` / `cacheWriteTokens` carry them so they are billed at their own rates.
 */
import { createParser, type EventSourceMessage } from "eventsource-parser";
import { errorFromResponse, systemClock, type ProviderClock } from "@flowaid/providers";
import {
  ProviderError,
  type ChatMessage,
  type DecisionCallContext,
  type GenerationChunk,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type JsonObject,
  type JsonValue,
  type ModelCatalog,
  type ProviderHealth,
  type SafeFetch,
  type TokenUsage,
  type ToolCall,
} from "@flowaid/workflow-core";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
/** Default max_tokens: the Messages API requires one. */
export const DEFAULT_MAX_TOKENS = 4096;
/** Prompts above this many characters (~1k tokens) are marked cacheable. */
export const CACHE_MIN_CHARS = 4000;
export const RESPOND_TOOL = "respond";

type FinishReason = GenerationResult["finishReason"];

export function mapStopReason(reason: unknown): FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
    case "pause_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "refusal":
      return "content_filter";
    default:
      return reason === null || reason === undefined ? "stop" : "error";
  }
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageOf(u: AnthropicUsage | undefined): TokenUsage {
  const read = u?.cache_read_input_tokens ?? 0;
  const write = u?.cache_creation_input_tokens ?? 0;
  const out: TokenUsage = {
    inputTokens: (u?.input_tokens ?? 0) + read + write,
    outputTokens: u?.output_tokens ?? 0,
  };
  if (read) out.cacheReadTokens = read;
  if (write) out.cacheWriteTokens = write;
  return out;
}

const textOf = (m: ChatMessage): string =>
  typeof m.content === "string"
    ? m.content
    : m.content.map((p) => (p.type === "text" ? p.text : "")).join("");

function contentBlocks(m: ChatMessage): JsonValue[] {
  if (typeof m.content === "string") return m.content ? [{ type: "text", text: m.content }] : [];
  return m.content.map((p): JsonValue =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data } },
  );
}

/** The request body for `POST /v1/messages`. */
export function messagesBody(model: string, req: GenerationRequest, stream: boolean): JsonObject {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map(textOf)
    .join("\n\n");
  const messages: JsonValue[] = [];
  for (const m of req.messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: textOf(m) }],
      });
      continue;
    }
    const blocks = contentBlocks(m);
    if (m.role === "assistant" && m.toolCalls?.length)
      for (const c of m.toolCalls)
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
    messages.push({ role: m.role, content: blocks });
  }
  const body: JsonObject = {
    model,
    max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    messages,
  };
  if (system) {
    body.system = [
      {
        type: "text",
        text: system,
        ...(system.length >= CACHE_MIN_CHARS ? { cache_control: { type: "ephemeral" } } : {}),
      },
    ];
  }
  const tools: JsonValue[] = (req.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as JsonValue,
  }));
  if (req.responseFormat?.type === "json_schema") {
    tools.push({
      name: RESPOND_TOOL,
      description: "Respond with the final answer in this exact structure.",
      input_schema: req.responseFormat.schema as JsonValue,
    });
    body.tool_choice = { type: "tool", name: RESPOND_TOOL };
  } else if (req.toolChoice) {
    body.tool_choice =
      typeof req.toolChoice === "object"
        ? { type: "tool", name: req.toolChoice.name }
        : req.toolChoice === "required"
          ? { type: "any" }
          : { type: req.toolChoice };
  }
  if (tools.length > 0) body.tools = tools;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.stop?.length) body.stop_sequences = req.stop;
  if (req.metadata?.userId) body.metadata = { user_id: req.metadata.userId };
  if (stream) body.stream = true;
  return body;
}

const HEALTHY = (): ProviderHealth => ({
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: new Date().toISOString(),
});

export interface AnthropicClientOptions {
  model: string;
  apiKey: string;
  http: SafeFetch;
  catalog: ModelCatalog;
  baseUrl?: string;
  clock?: ProviderClock;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: JsonValue;
}

export class AnthropicClient implements GenerationProvider {
  readonly id = "anthropic";
  readonly model: string;
  readonly capabilities: GenerationProvider["capabilities"];
  private readonly clock: ProviderClock;

  constructor(private readonly options: AnthropicClientOptions) {
    this.model = options.catalog.resolveAlias("anthropic", options.model);
    const info = options.catalog.get("anthropic", options.model);
    this.capabilities = {
      tools: true,
      jsonSchema: true,
      vision: info?.capabilities.vision ?? true,
      streaming: true,
      thinking: info?.capabilities.thinking ?? false,
      maxContext: info?.contextTokens ?? 200_000,
    };
    this.clock = options.clock ?? systemClock;
  }

  private async post(body: JsonObject, signal: AbortSignal): Promise<Response> {
    const response = await this.options.http(
      `${(this.options.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/+$/, "")}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.options.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (!response.ok)
      throw errorFromResponse(
        "anthropic",
        response.status,
        response.headers,
        await response.text(),
      );
    return response;
  }

  private finish(
    blocks: ContentBlock[],
    usage: TokenUsage,
    stopReason: unknown,
    model: string,
    started: number,
    structuredWanted: boolean,
  ): GenerationResult {
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const uses = blocks.filter((b) => b.type === "tool_use");
    const respond = structuredWanted ? uses.find((b) => b.name === RESPOND_TOOL) : undefined;
    const toolCalls: ToolCall[] = uses
      .filter((b) => b !== respond)
      .map((b) => ({ id: b.id ?? "", name: b.name ?? "", args: b.input ?? {} }));
    const { costUsd, snapshot } = this.options.catalog.price("anthropic", this.model, usage);
    const result: GenerationResult = {
      text,
      toolCalls,
      finishReason: respond ? "stop" : mapStopReason(stopReason),
      usage,
      costUsd,
      priceSnapshot: snapshot,
      latencyMs: Math.max(0, Math.round(this.clock.now() - started)),
      provider: "anthropic",
      model,
    };
    if (respond) result.structured = respond.input ?? null;
    return result;
  }

  async generate(req: GenerationRequest, ctx: DecisionCallContext): Promise<GenerationResult> {
    const started = this.clock.now();
    const response = await this.post(messagesBody(this.model, req, false), ctx.signal);
    const json = (await response.json()) as {
      model?: string;
      content?: ContentBlock[];
      stop_reason?: string;
      usage?: AnthropicUsage;
    };
    return this.finish(
      json.content ?? [],
      usageOf(json.usage),
      json.stop_reason,
      json.model ?? this.model,
      started,
      req.responseFormat?.type === "json_schema",
    );
  }

  async *stream(req: GenerationRequest, ctx: DecisionCallContext): AsyncIterable<GenerationChunk> {
    const response = await this.post(messagesBody(this.model, req, true), ctx.signal);
    if (!response.body)
      throw new ProviderError("anthropic returned an empty stream", true, "anthropic");
    const queue: GenerationChunk[] = [];
    const blockKinds = new Map<number, { type: string; toolIndex?: number }>();
    let toolCount = 0;
    let usage: AnthropicUsage = {};
    let stop: unknown = null;
    // A holder, so TypeScript does not narrow the closure-assigned value to null.
    const failed: { error: ProviderError | null } = { error: null };
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        let data: {
          type?: string;
          index?: number;
          message?: { usage?: AnthropicUsage };
          content_block?: ContentBlock;
          delta?: {
            type?: string;
            text?: string;
            thinking?: string;
            partial_json?: string;
            stop_reason?: string;
          };
          usage?: AnthropicUsage;
          error?: { type?: string; message?: string };
        };
        try {
          data = JSON.parse(event.data) as typeof data;
        } catch {
          return;
        }
        switch (data.type) {
          case "message_start":
            usage = { ...data.message?.usage };
            break;
          case "content_block_start": {
            const block = data.content_block;
            const index = data.index ?? 0;
            if (block?.type === "tool_use") {
              const toolIndex = toolCount++;
              blockKinds.set(index, { type: "tool_use", toolIndex });
              queue.push({
                type: "tool_call",
                index: toolIndex,
                argsDelta: "",
                ...(block.id ? { id: block.id } : {}),
                ...(block.name ? { name: block.name } : {}),
              });
            } else blockKinds.set(index, { type: block?.type ?? "text" });
            break;
          }
          case "content_block_delta": {
            const d = data.delta;
            if (d?.type === "text_delta" && d.text) queue.push({ type: "text", delta: d.text });
            else if (d?.type === "thinking_delta" && d.thinking)
              queue.push({ type: "thinking", delta: d.thinking });
            else if (d?.type === "input_json_delta") {
              const kind = blockKinds.get(data.index ?? 0);
              queue.push({
                type: "tool_call",
                index: kind?.toolIndex ?? 0,
                argsDelta: d.partial_json ?? "",
              });
            }
            break;
          }
          case "message_delta":
            if (data.delta?.stop_reason) stop = data.delta.stop_reason;
            usage = { ...usage, ...data.usage };
            break;
          case "error":
            failed.error =
              data.error?.type === "overloaded_error"
                ? new ProviderError(
                    `anthropic overloaded: ${data.error.message ?? ""}`,
                    true,
                    "anthropic",
                  )
                : new ProviderError(
                    `anthropic stream error: ${data.error?.message ?? "unknown"}`,
                    true,
                    "anthropic",
                  );
            break;
          case undefined:
          default:
            break;
        }
      },
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
        if (failed.error) throw failed.error;
        while (queue.length > 0) {
          const next = queue.shift();
          if (next) yield next;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (failed.error) throw failed.error;
    for (const next of queue) yield next;
    yield { type: "usage", usage: usageOf(usage) };
    yield { type: "done", finishReason: mapStopReason(stop) };
  }

  /** `GET /v1/models` (discovery). */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.options.http(
      `${(this.options.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/+$/, "")}/v1/models`,
      {
        method: "GET",
        headers: { "x-api-key": this.options.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.ok)
      throw errorFromResponse(
        "anthropic",
        response.status,
        response.headers,
        await response.text(),
      );
    const json = (await response.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id).sort();
  }

  health(): ProviderHealth {
    return HEALTHY();
  }
}
