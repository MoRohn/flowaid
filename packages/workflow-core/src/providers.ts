/**
 * §15 Provider interfaces: decision, generation and embedding providers, the
 * model catalog and provider factories. Implementations live in
 * `@flowaid/providers` and the `provider-*` packages; only the contracts are here.
 */
import { z } from "zod";
import type { JsonObject, JsonSchema, JsonValue } from "./json.js";
import type { ErrorCode } from "./policy.js";
import type {
  BooleanDecision,
  ChoiceDecision,
  DecisionKind,
  DecisionResult,
  PriceSnapshot,
  ScoreDecision,
  TokenUsage,
} from "./decision.js";
import type { ToolDefinition } from "./plan.js";

/** SSRF-guarded fetch honouring the node's AbortSignal and the workspace egress policy. */
export type SafeFetch = (
  url: string,
  init?: RequestInit & { maxRedirects?: number; maxBytes?: number },
) => Promise<Response>;

/** TypeSafe "state": text, object, or array of text. Objects are sent verbatim. */
export type DecisionState = string | JsonObject | string[];

/** A question posed to a decision provider. */
export const DecisionQuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("boolean"),
    instructions: z.string().min(1),
    criteria: z.object({ true: z.string(), false: z.string() }).optional(),
  }),
  /** key → description; 2..255 options; keys ^[a-z0-9_]{1,64}$ (compiler-enforced so they can be control ports) */
  z.object({
    kind: z.literal("choice"),
    instructions: z.string().min(1),
    options: z.record(z.string(), z.string()),
  }),
  /** 2..10 ordered level descriptions */
  z.object({
    kind: z.literal("score"),
    instructions: z.string().min(1),
    levels: z.array(z.string()).min(2).max(10),
  }),
]);
export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>;
export type BooleanQuestion = Extract<DecisionQuestion, { kind: "boolean" }>;
export type ChoiceQuestion = Extract<DecisionQuestion, { kind: "choice" }>;
export type ScoreQuestion = Extract<DecisionQuestion, { kind: "score" }>;

/** Per-call context handed to providers. */
export interface DecisionCallContext {
  signal: AbortSignal;
  runId: string;
  nodeRunId: string;
  idempotencyKey: string | null;
  /** boolean threshold for value = pYes >= threshold (default 0.5) */
  booleanThreshold?: number;
}

/** Rolling health of one provider, used by failover and the circuit breaker. */
export interface ProviderHealth {
  status: "healthy" | "degraded" | "down";
  errorRate1m: number;
  p95LatencyMs: number;
  consecutiveFailures: number;
  lastErrorCode?: ErrorCode;
  checkedAt: string;
}

/** Answers typed decision questions over a state. */
export interface DecisionProvider {
  readonly id: string; // "typesafe" | "llm" | "rule" | "human" | custom
  readonly model: string;
  readonly capabilities: {
    batch: boolean;
    maxQuestions: number;
    maxStateTokens: number;
    kinds: readonly DecisionKind[];
    text: boolean;
    images: boolean;
  };
  decideBoolean(
    state: DecisionState,
    question: BooleanQuestion,
    ctx: DecisionCallContext,
  ): Promise<BooleanDecision>;
  decideChoice(
    state: DecisionState,
    question: ChoiceQuestion,
    ctx: DecisionCallContext,
  ): Promise<ChoiceDecision>;
  decideScore(
    state: DecisionState,
    question: ScoreQuestion,
    ctx: DecisionCallContext,
  ): Promise<ScoreDecision>;
  /** Native batching: independent questions over one state in one request. Result keys mirror `questions`. */
  batch(
    state: DecisionState,
    questions: Record<string, DecisionQuestion>,
    ctx: DecisionCallContext,
  ): Promise<{
    answers: Record<string, DecisionResult>;
    usage: TokenUsage;
    model: string;
    requestId: string | null;
    latencyMs: number;
  }>;
  health(): ProviderHealth;
}

/** Text part of a chat message. */
export interface ContentPartText {
  type: "text";
  text: string;
}
/** Inline image part of a chat message (base64 `data`). */
export interface ContentPartImage {
  type: "image";
  mimeType: string;
  data: string;
}
export type ContentPart = ContentPartText | ContentPartImage;
/** A tool call requested by a model. */
export interface ToolCall {
  id: string;
  name: string;
  args: JsonValue;
}
/** One chat message. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
/** A generation request. */
export interface GenerationRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responseFormat?: { type: "text" } | { type: "json_schema"; schema: JsonSchema; strict: boolean };
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stop?: string[];
  seed?: number;
  metadata?: Record<string, string>;
}
/** A completed generation. */
export interface GenerationResult {
  text: string;
  toolCalls: ToolCall[];
  structured?: JsonValue;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
  usage: TokenUsage;
  costUsd: number;
  priceSnapshot: PriceSnapshot | null;
  latencyMs: number;
  provider: string;
  model: string;
  raw?: JsonValue;
}
/** One streamed chunk of a generation. */
export type GenerationChunk =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; index: number; id?: string; name?: string; argsDelta: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: GenerationResult["finishReason"] };

/** Chat/completion provider. */
export interface GenerationProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: {
    tools: boolean;
    jsonSchema: boolean;
    vision: boolean;
    streaming: boolean;
    thinking: boolean;
    maxContext: number;
  };
  generate(req: GenerationRequest, ctx: DecisionCallContext): Promise<GenerationResult>;
  stream(req: GenerationRequest, ctx: DecisionCallContext): AsyncIterable<GenerationChunk>;
  health(): ProviderHealth;
}
/** Embedding provider. */
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embed(
    texts: string[],
    ctx: DecisionCallContext,
  ): Promise<{ vectors: number[][]; usage: TokenUsage; costUsd: number }>;
  health(): ProviderHealth;
}

/** Catalog entry for one model. */
export interface ModelInfo {
  provider: string;
  model: string;
  aliases?: string[];
  kind: "decision" | "chat" | "embedding" | "rerank";
  contextTokens?: number;
  maxOutputTokens?: number;
  pricing?: PriceSnapshot;
  deprecated?: string;
  capabilities: Record<string, boolean>;
}

/** A provider factory registered by a provider package or a node package. */
export interface ProviderFactory<
  T extends DecisionProvider | GenerationProvider | EmbeddingProvider,
> {
  id: string;
  kind: "decision" | "generation" | "embedding";
  /** credential type this provider needs (undefined for rule/human/ollama-without-auth) */
  credentialType?: string;
  create(opts: {
    model: string;
    credential: Record<string, string> | undefined;
    options?: JsonObject;
    http: SafeFetch;
    catalog: ModelCatalog;
  }): T;
}
/** Model catalog: pricing, aliases and capabilities. */
export interface ModelCatalog {
  get(provider: string, model: string): ModelInfo | undefined;
  list(filter?: { provider?: string; kind?: ModelInfo["kind"] }): ModelInfo[];
  resolveAlias(provider: string, model: string): string;
  price(
    provider: string,
    model: string,
    usage: TokenUsage,
  ): { costUsd: number; snapshot: PriceSnapshot | null };
}
