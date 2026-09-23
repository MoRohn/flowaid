/**
 * `OllamaClient` (ARCHITECTURE.md §6.6): local models through the Ollama API.
 *
 * - `POST /api/chat` streams NDJSON (one JSON object per line; `done: true` ends it with
 *   `done_reason`, `prompt_eval_count`, `eval_count`); `format` carries a JSON Schema for
 *   structured output; `tools` / `message.tool_calls` for tool use (arguments arrive as objects).
 * - `POST /api/embed` for embeddings, `GET /api/tags` for discovery.
 * - Local inference costs nothing: `costUsd` is 0 and there is no price snapshot.
 * - An optional bearer token supports a protected proxy in front of Ollama.
 */
import { errorFromResponse, systemClock, type ProviderClock } from "@flowaid/providers";
import {
  ProviderError,
  type ChatMessage,
  type DecisionCallContext,
  type EmbeddingProvider,
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

export const OLLAMA_DEFAULT_HOST = "http://localhost:11434";
type FinishReason = GenerationResult["finishReason"];

export function mapDoneReason(reason: unknown, hasToolCalls: boolean): FinishReason {
  if (hasToolCalls) return "tool_calls";
  switch (reason) {
    case "stop":
    case undefined:
    case null:
      return "stop";
    case "length":
      return "length";
    default:
      return "stop";
  }
}

function messageOf(m: ChatMessage): JsonObject {
  const out: JsonObject = { role: m.role };
  if (typeof m.content === "string") out.content = m.content;
  else {
    out.content = m.content.map((p) => (p.type === "text" ? p.text : "")).join("");
    const images = m.content
      .filter((p) => p.type === "image")
      .map((p) => (p.type === "image" ? p.data : ""));
    if (images.length > 0) out.images = images;
  }
  if (m.toolCalls?.length)
    out.tool_calls = m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } }));
  if (m.role === "tool" && m.toolCallId) out.tool_name = m.toolCallId;
  return out;
}

export function chatBody(model: string, req: GenerationRequest, stream: boolean): JsonObject {
  const options: JsonObject = {};
  if (req.temperature !== undefined) options.temperature = req.temperature;
  if (req.topP !== undefined) options.top_p = req.topP;
  if (req.maxOutputTokens !== undefined) options.num_predict = req.maxOutputTokens;
  if (req.stop?.length) options.stop = req.stop;
  if (req.seed !== undefined) options.seed = req.seed;
  const body: JsonObject = { model, messages: req.messages.map(messageOf), stream };
  if (Object.keys(options).length > 0) body.options = options;
  if (req.responseFormat?.type === "json_schema")
    body.format = req.responseFormat.schema as JsonValue;
  if (req.tools?.length && req.toolChoice !== "none")
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as JsonValue,
      },
    }));
  return body;
}

interface OllamaChunk {
  model?: string;
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { function: { name: string; arguments: JsonValue } }[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

const usageOf = (c: OllamaChunk): TokenUsage => ({
  inputTokens: c.prompt_eval_count ?? 0,
  outputTokens: c.eval_count ?? 0,
});
const HEALTHY = (): ProviderHealth => ({
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: new Date().toISOString(),
});

export interface OllamaClientOptions {
  model: string;
  host?: string;
  token?: string;
  http: SafeFetch;
  catalog: ModelCatalog;
  clock?: ProviderClock;
  embeddingDimensions?: number;
}

export class OllamaClient implements GenerationProvider, EmbeddingProvider {
  readonly id = "ollama";
  readonly model: string;
  readonly dimensions: number;
  readonly capabilities: GenerationProvider["capabilities"];
  private readonly host: string;
  private readonly clock: ProviderClock;

  constructor(private readonly options: OllamaClientOptions) {
    this.model = options.model;
    this.host = (options.host ?? OLLAMA_DEFAULT_HOST).replace(/\/+$/, "");
    const info = options.catalog.get("ollama", options.model);
    this.capabilities = {
      tools: info?.capabilities.tools ?? true,
      jsonSchema: true,
      vision: info?.capabilities.vision ?? false,
      streaming: true,
      thinking: info?.capabilities.thinking ?? false,
      maxContext: info?.contextTokens ?? 8192,
    };
    this.dimensions = options.embeddingDimensions ?? 0;
    this.clock = options.clock ?? systemClock;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
    };
  }

  private async request(
    path: string,
    init: RequestInit & { body?: string },
    signal?: AbortSignal,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.options.http(`${this.host}${path}`, {
        ...init,
        headers: this.headers(),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ProviderError(
        `Ollama at ${this.host} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        true,
        "ollama",
      );
    }
    if (!response.ok)
      throw errorFromResponse("ollama", response.status, response.headers, await response.text());
    return response;
  }

  async generate(req: GenerationRequest, ctx: DecisionCallContext): Promise<GenerationResult> {
    const started = this.clock.now();
    const response = await this.request(
      "/api/chat",
      { method: "POST", body: JSON.stringify(chatBody(this.model, req, false)) },
      ctx.signal,
    );
    const json = (await response.json()) as OllamaChunk;
    if (json.error) throw new ProviderError(`Ollama: ${json.error}`, true, "ollama");
    const toolCalls: ToolCall[] = (json.message?.tool_calls ?? []).map((c, i) => ({
      id: `call_${i}`,
      name: c.function.name,
      args: c.function.arguments,
    }));
    const text = json.message?.content ?? "";
    const result: GenerationResult = {
      text,
      toolCalls,
      finishReason: mapDoneReason(json.done_reason, toolCalls.length > 0),
      usage: usageOf(json),
      costUsd: 0,
      priceSnapshot: null,
      latencyMs: Math.max(0, Math.round(this.clock.now() - started)),
      provider: "ollama",
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
    const response = await this.request(
      "/api/chat",
      { method: "POST", body: JSON.stringify(chatBody(this.model, req, true)) },
      ctx.signal,
    );
    if (!response.body) throw new ProviderError("Ollama returned an empty stream", true, "ollama");
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let tools = 0;
    // A holder, so TypeScript does not narrow the value assigned inside `handle` to null.
    const end: { chunk: OllamaChunk | null } = { chunk: null };
    const handle = function* (line: string): Generator<GenerationChunk> {
      if (line.trim() === "") return;
      const chunk = JSON.parse(line) as OllamaChunk;
      if (chunk.error) throw new ProviderError(`Ollama: ${chunk.error}`, true, "ollama");
      if (chunk.message?.thinking) yield { type: "thinking", delta: chunk.message.thinking };
      if (chunk.message?.content) yield { type: "text", delta: chunk.message.content };
      for (const call of chunk.message?.tool_calls ?? []) {
        yield {
          type: "tool_call",
          index: tools,
          id: `call_${tools}`,
          name: call.function.name,
          argsDelta: JSON.stringify(call.function.arguments),
        };
        tools += 1;
      }
      if (chunk.done) end.chunk = chunk;
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf("\n");
        while (cut >= 0) {
          yield* handle(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 1);
          cut = buffer.indexOf("\n");
        }
      }
      yield* handle(buffer);
    } finally {
      reader.releaseLock();
    }
    const final = end.chunk;
    if (final) yield { type: "usage", usage: usageOf(final) };
    yield { type: "done", finishReason: mapDoneReason(final?.done_reason, tools > 0) };
  }

  async embed(
    texts: string[],
    ctx: DecisionCallContext,
  ): Promise<{ vectors: number[][]; usage: TokenUsage; costUsd: number }> {
    const response = await this.request(
      "/api/embed",
      { method: "POST", body: JSON.stringify({ model: this.model, input: texts }) },
      ctx.signal,
    );
    const json = (await response.json()) as { embeddings?: number[][]; prompt_eval_count?: number };
    return {
      vectors: json.embeddings ?? [],
      usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: 0 },
      costUsd: 0,
    };
  }

  /** `GET /api/tags` (installed models). */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.request("/api/tags", { method: "GET" }, signal);
    const json = (await response.json()) as { models?: { name: string }[] };
    return (json.models ?? []).map((m) => m.name).sort();
  }

  health(): ProviderHealth {
    return HEALTHY();
  }
}
