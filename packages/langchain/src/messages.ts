/**
 * Message bridges (LANGCHAIN.md §2): `GenerationRequest.messages` ⇄ LangChain `BaseMessage[]`,
 * plus the helpers that read text, reasoning, tool calls, usage and the finish reason out of a
 * LangChain `AIMessage` / `AIMessageChunk` whatever the vendor's content-block layout.
 */
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type MessageContent,
  type UsageMetadata,
} from "@langchain/core/messages";
import type {
  ChatMessage,
  ContentPart,
  GenerationResult,
  JsonValue,
  TokenUsage,
  ToolCall,
} from "@flowaid/workflow-core";

type Block = Record<string, unknown>;
const isBlock = (v: unknown): v is Block => typeof v === "object" && v !== null;

function toLangChainContent(content: string | ContentPart[]): MessageContent {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } },
  );
}

function fromLangChainContent(content: MessageContent): string | ContentPart[] {
  if (typeof content === "string") return content;
  const parts: ContentPart[] = [];
  for (const block of content as unknown[]) {
    if (typeof block === "string") parts.push({ type: "text", text: block });
    else if (isBlock(block) && block.type === "text" && typeof block.text === "string")
      parts.push({ type: "text", text: block.text });
    else if (isBlock(block) && block.type === "image_url") {
      const raw = block.image_url;
      const url =
        typeof raw === "string" ? raw : isBlock(raw) && typeof raw.url === "string" ? raw.url : "";
      const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (m?.[1] && m[2] !== undefined) parts.push({ type: "image", mimeType: m[1], data: m[2] });
    }
  }
  return parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts;
}

export function toLangChainMessages(messages: readonly ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    const content = toLangChainContent(m.content);
    switch (m.role) {
      case "system":
        return new SystemMessage({ content });
      case "user":
        return new HumanMessage({ content });
      case "assistant":
        return new AIMessage({
          content,
          tool_calls: (m.toolCalls ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            args:
              typeof c.args === "object" && c.args !== null && !Array.isArray(c.args)
                ? c.args
                : { value: c.args },
            type: "tool_call" as const,
          })),
        });
      case "tool":
        return new ToolMessage({ content, tool_call_id: m.toolCallId ?? "" });
    }
  });
}

export function fromLangChainMessages(messages: readonly BaseMessage[]): ChatMessage[] {
  return messages.map((m): ChatMessage => {
    const content = fromLangChainContent(m.content);
    switch (m.getType()) {
      case "system":
      case "developer":
        return { role: "system", content };
      case "ai": {
        const calls = toolCallsOf(m);
        return {
          role: "assistant",
          content: typeof content === "string" ? content : textOf(m),
          ...(calls.length ? { toolCalls: calls } : {}),
        };
      }
      case "tool":
        return {
          role: "tool",
          content: typeof content === "string" ? content : textOf(m),
          toolCallId: (m as ToolMessage).tool_call_id,
        };
      case "human":
      case "generic":
      case "function":
      case "remove":
        return { role: "user", content };
      default:
        return { role: "user", content };
    }
  });
}

/** Visible text of a message (text blocks only; reasoning blocks excluded). */
export function textOf(message: BaseMessage): string {
  const c = message.content;
  if (typeof c === "string") return c;
  return (c as unknown[])
    .map((b) =>
      typeof b === "string"
        ? b
        : isBlock(b) && b.type === "text" && typeof b.text === "string"
          ? b.text
          : "",
    )
    .join("");
}

/** Reasoning text (Anthropic `thinking` blocks, `reasoning` blocks, `additional_kwargs.reasoning_content`). */
export function reasoningOf(message: BaseMessage): string {
  const out: string[] = [];
  const c = message.content;
  if (Array.isArray(c))
    for (const b of c as unknown[]) {
      if (!isBlock(b)) continue;
      if (b.type === "thinking" && typeof b.thinking === "string") out.push(b.thinking);
      else if (b.type === "reasoning" && typeof b.reasoning === "string") out.push(b.reasoning);
    }
  const extra = message.additional_kwargs.reasoning_content;
  if (typeof extra === "string") out.push(extra);
  return out.join("");
}

export function toolCallsOf(message: BaseMessage): ToolCall[] {
  const calls = (message as AIMessage).tool_calls ?? [];
  return calls.map((c, i) => ({
    id: c.id ?? `call_${i}`,
    name: c.name,
    args: c.args as JsonValue,
  }));
}

export function usageOf(usage: UsageMetadata | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const cacheRead = usage.input_token_details?.cache_read;
  const cacheWrite = usage.input_token_details?.cache_creation;
  return {
    inputTokens: Math.max(0, Math.round(usage.input_tokens)),
    outputTokens: Math.max(0, Math.round(usage.output_tokens)),
    ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
  if (!b) return a;
  const read = (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0);
  const write = (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(read ? { cacheReadTokens: read } : {}),
    ...(write ? { cacheWriteTokens: write } : {}),
  };
}

/** Vendor finish/stop reasons → the flowaid finish reason. */
export function finishReasonOf(
  metadata: Record<string, unknown> | undefined,
  hasToolCalls: boolean,
): GenerationResult["finishReason"] {
  const raw = metadata?.finish_reason ?? metadata?.stop_reason ?? metadata?.done_reason;
  switch (raw) {
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "tool_use":
    case "function_call":
      return "tool_calls";
    case "content_filter":
    case "refusal":
    case "safety":
      return "content_filter";
    default:
      return hasToolCalls ? "tool_calls" : "stop";
  }
}
