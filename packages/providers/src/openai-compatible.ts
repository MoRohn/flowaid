/**
 * `OpenAICompatibleClient` (ARCHITECTURE.md §6.6): Chat Completions, streaming, embeddings and
 * model discovery against any OpenAI-compatible endpoint (OpenAI itself, Groq, Mistral, xAI,
 * OpenRouter, Together, vLLM, custom).
 *
 * - `POST {baseUrl}/chat/completions` with `stream: true` + `stream_options.include_usage`; SSE
 *   frames are parsed with eventsource-parser; `data: [DONE]` ends the stream.
 * - Tool-call deltas are assembled by index; `response_format: json_schema` (strict) for
 *   structured output; `usage.prompt_tokens_details.cached_tokens` → `cacheReadTokens`.
 * - Every request goes through the caller's `SafeFetch` and honours the call's AbortSignal.
 * - Cost comes from the model catalog, with the price snapshot recorded on the result.
 */
import { createParser, type EventSourceMessage } from "eventsource-parser";
import {
  ProviderError,
  type ChatMessage,
  type DecisionCallContext,
  type EmbeddingProvider,
  type GenerationChunk,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type JsonValue,
  type ModelCatalog,
  type ProviderHealth,
  type SafeFetch,
  type TokenUsage,
  type ToolCall,
} from "@flowaid/workflow-core";
import { errorFromResponse } from "./httpErrors.js";
import { systemClock, type ProviderClock } from "./signals.js";

export interface OpenAICompatibleOptions {
  /** Provider id used in results, pricing and errors ("openai", "openai-compatible:groq", …). */
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  http: SafeFetch;
  catalog: ModelCatalog;
  /** Extra headers (OpenRouter's HTTP-Referer, an organization header, …). */
  headers?: Record<string, string>;
  /** `max_completion_tokens` (OpenAI) or `max_tokens` (most compatible servers). */
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  /** Context window when the catalog does not know the model. */
  maxContext?: number;
  embeddingDimensions?: number;
  clock?: ProviderClock;
  health?: () => ProviderHealth;
}

type FinishReason = GenerationResult["finishReason"];

export function mapFinishReason(reason: unknown): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return reason === null || reason === undefined ? "stop" : "error";
  }
}

function contentOf(message: ChatMessage): JsonValue {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part): JsonValue => {
    if (part.type === "text") return { type: "text", text: part.text };
    return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } };
  });
}

/** The request body for `/chat/completions`. */
export function chatBody(
  model: string,
  req: GenerationRequest,
  stream: boolean,
  maxTokensField: string,
): Record<string, JsonValue> {
  const body: Record<string, JsonValue> = {
    model,
    messages: req.messages.map((m) => {
      const out: Record<string, JsonValue> = { role: m.role, content: contentOf(m) };
      if (m.toolCallId) out.tool_call_id = m.toolCallId;
      if (m.toolCalls?.length) {
        out.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        }));
      }
      return out;
    }),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as JsonValue,
      },
    }));
  }
  if (req.toolChoice) {
    body.tool_choice =
      typeof req.toolChoice === "string"
        ? req.toolChoice
        : { type: "function", function: { name: req.toolChoice.name } };
  }
  if (req.responseFormat?.type === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: req.responseFormat.schema as JsonValue,
        strict: req.responseFormat.strict,
      },
    };
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.maxOutputTokens !== undefined) body[maxTokensField] = req.maxOutputTokens;
  if (req.stop?.length) body.stop = req.stop;
  if (req.seed !== undefined) body.seed = req.seed;
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export function usageOf(usage: OpenAIUsage | undefined): TokenUsage {
  const out: TokenUsage = {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  };
  const cached = usage?.prompt_tokens_details?.cached_tokens;
  if (cached) out.cacheReadTokens = cached;
  return out;
}

function parseArgs(text: string): JsonValue {
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

/** Accumulates streamed tool-call deltas by index. */
export class ToolCallAssembler {
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();

  add(index: number, delta: { id?: string; name?: string; argsDelta?: string }): void {
    const call = this.calls.get(index) ?? { id: "", name: "", args: "" };
    if (delta.id) call.id = delta.id;
    if (delta.name) call.name += delta.name;
    if (delta.argsDelta) call.args += delta.argsDelta;
    this.calls.set(index, call);
  }

  result(): ToolCall[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => ({ id: c.id, name: c.name, args: parseArgs(c.args) }));
  }
}

const HEALTHY = (): ProviderHealth => ({
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: new Date().toISOString(),
});

export class OpenAICompatibleClient implements GenerationProvider, EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: GenerationProvider["capabilities"];
  readonly dimensions: number;
  private readonly clock: ProviderClock;
  private readonly maxTokensField: string;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.id = options.provider;
    this.model = options.catalog.resolveAlias(options.provider, options.model);
    const info = options.catalog.get(options.provider, options.model);
    const caps = info?.capabilities ?? {};
    this.capabilities = {
      tools: caps.tools ?? true,
      jsonSchema: caps.jsonSchema ?? true,
      vision: caps.vision ?? false,
      streaming: caps.streaming ?? true,
      thinking: caps.thinking ?? false,
      maxContext: info?.contextTokens ?? options.maxContext ?? 128_000,
    };
    this.dimensions = options.embeddingDimensions ?? 0;
    this.clock = options.clock ?? systemClock;
    this.maxTokensField =
      options.maxTokensField ??
      (options.baseUrl.includes("api.openai.com") ? "max_completion_tokens" : "max_tokens");
  }

  private url(path: string): string {
    return `${this.options.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private async post(path: string, body: JsonValue, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.options.headers,
    };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    const response = await this.options.http(this.url(path), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok)
      throw errorFromResponse(this.id, response.status, response.headers, await response.text());
    return response;
  }

  private priced(usage: TokenUsage) {
    return this.options.catalog.price(this.id, this.model, usage);
  }

  async generate(req: GenerationRequest, ctx: DecisionCallContext): Promise<GenerationResult> {
    const started = this.clock.now();
    const response = await this.post(
      "/chat/completions",
      chatBody(this.model, req, false, this.maxTokensField),
      ctx.signal,
    );
    const json = (await response.json()) as {
      model?: string;
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
        finish_reason?: string;
      }[];
      usage?: OpenAIUsage;
    };
    const choice = json.choices?.[0];
    const text = choice?.message?.content ?? "";
    const toolCalls = (choice?.message?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      args: parseArgs(c.function.arguments),
    }));
    const usage = usageOf(json.usage);
    const { costUsd, snapshot } = this.priced(usage);
    const result: GenerationResult = {
      text,
      toolCalls,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage,
      costUsd,
      priceSnapshot: snapshot,
      latencyMs: Math.max(0, Math.round(this.clock.now() - started)),
      provider: this.id,
      model: json.model ?? this.model,
    };
    if (req.responseFormat?.type === "json_schema" && text) {
      try {
        result.structured = JSON.parse(text) as JsonValue;
      } catch {
        // left to the caller's repair pass
      }
    }
    return result;
  }

  async *stream(req: GenerationRequest, ctx: DecisionCallContext): AsyncIterable<GenerationChunk> {
    const response = await this.post(
      "/chat/completions",
      chatBody(this.model, req, true, this.maxTokensField),
      ctx.signal,
    );
    if (!response.body)
      throw new ProviderError(`${this.id} returned an empty stream`, true, this.id);
    const queue: GenerationChunk[] = [];
    let finish: FinishReason | undefined;
    let done = false;
    let streamError: ProviderError | undefined;
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.data === "[DONE]") {
          done = true;
          return;
        }
        let chunk: {
          choices?: {
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: {
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
            finish_reason?: string | null;
          }[];
          usage?: OpenAIUsage | null;
          error?: { message?: string };
        };
        try {
          chunk = JSON.parse(event.data) as typeof chunk;
        } catch {
          return;
        }
        if (chunk.error) {
          streamError = new ProviderError(
            `${this.id} stream error: ${chunk.error.message ?? "unknown"}`,
            true,
            this.id,
          );
          return;
        }
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta;
          if (delta?.reasoning_content)
            queue.push({ type: "thinking", delta: delta.reasoning_content });
          if (delta?.content) queue.push({ type: "text", delta: delta.content });
          for (const call of delta?.tool_calls ?? []) {
            const out: GenerationChunk = {
              type: "tool_call",
              index: call.index,
              argsDelta: call.function?.arguments ?? "",
            };
            if (call.id) out.id = call.id;
            if (call.function?.name) out.name = call.function.name;
            queue.push(out);
          }
          if (choice.finish_reason) finish = mapFinishReason(choice.finish_reason);
        }
        if (chunk.usage) queue.push({ type: "usage", usage: usageOf(chunk.usage) });
      },
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      while (!done) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        parser.feed(decoder.decode(value, { stream: true }));
        if (streamError) throw streamError;
        while (queue.length > 0) {
          const next = queue.shift();
          if (next) yield next;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (streamError) throw streamError;
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) yield next;
    }
    yield { type: "done", finishReason: finish ?? "stop" };
  }

  async embed(
    texts: string[],
    ctx: DecisionCallContext,
  ): Promise<{ vectors: number[][]; usage: TokenUsage; costUsd: number }> {
    const response = await this.post(
      "/embeddings",
      { model: this.model, input: texts },
      ctx.signal,
    );
    const json = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
      usage?: OpenAIUsage;
    };
    const vectors = [...(json.data ?? [])]
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
    const usage: TokenUsage = { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: 0 };
    return { vectors, usage, costUsd: this.priced(usage).costUsd };
  }

  /** `GET /models` (discovery). */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const headers: Record<string, string> = { ...this.options.headers };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    const response = await this.options.http(this.url("/models"), {
      method: "GET",
      headers,
      ...(signal ? { signal } : {}),
    });
    if (!response.ok)
      throw errorFromResponse(this.id, response.status, response.headers, await response.text());
    const json = (await response.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id).sort();
  }

  health(): ProviderHealth {
    return this.options.health?.() ?? HEALTHY();
  }
}
