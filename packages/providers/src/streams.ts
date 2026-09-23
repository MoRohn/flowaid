/**
 * Folds a generation stream back into a GenerationResult (text, thinking, assembled tool calls,
 * usage, finish reason), for nodes that stream deltas to the UI but need the final answer.
 */
import type {
  GenerationChunk,
  GenerationResult,
  ModelCatalog,
  TokenUsage,
} from "@flowaid/workflow-core";
import { ToolCallAssembler } from "./openai-compatible.js";

export async function collectStream(
  chunks: AsyncIterable<GenerationChunk>,
  meta: {
    provider: string;
    model: string;
    catalog?: ModelCatalog;
    startedAt: number;
    now: () => number;
  },
  onChunk?: (chunk: GenerationChunk) => void,
): Promise<GenerationResult & { thinking: string }> {
  let text = "";
  let thinking = "";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let finishReason: GenerationResult["finishReason"] = "stop";
  const tools = new ToolCallAssembler();
  for await (const chunk of chunks) {
    onChunk?.(chunk);
    switch (chunk.type) {
      case "text":
        text += chunk.delta;
        break;
      case "thinking":
        thinking += chunk.delta;
        break;
      case "tool_call":
        tools.add(chunk.index, {
          ...(chunk.id ? { id: chunk.id } : {}),
          ...(chunk.name ? { name: chunk.name } : {}),
          argsDelta: chunk.argsDelta,
        });
        break;
      case "usage":
        usage = chunk.usage;
        break;
      case "done":
        finishReason = chunk.finishReason;
        break;
    }
  }
  const priced = meta.catalog?.price(meta.provider, meta.model, usage) ?? {
    costUsd: 0,
    snapshot: null,
  };
  return {
    text,
    thinking,
    toolCalls: tools.result(),
    finishReason,
    usage,
    costUsd: priced.costUsd,
    priceSnapshot: priced.snapshot,
    latencyMs: Math.max(0, Math.round(meta.now() - meta.startedAt)),
    provider: meta.provider,
    model: meta.model,
  };
}
