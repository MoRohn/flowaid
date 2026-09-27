/**
 * Chat and embedding components of the source editor → FlowAId providers. FlowAId's generation
 * nodes take OpenAI, Anthropic or Ollama credentials; any other vendor is switched to OpenAI and
 * reported (`W_IMPORT_PROVIDER_CHANGED`) rather than guessed.
 */
import type { Builder, ProviderChoice } from "./builder.js";

const OPENAI = { name: "OPENAI_API_KEY", credentialType: "openai.api_key" };
const ANTHROPIC = { name: "ANTHROPIC_API_KEY", credentialType: "anthropic.api_key" };
const OLLAMA = { name: "OLLAMA", credentialType: "ollama.none" };

const OPENAI_CHAT = new Set(["chatOpenAI", "azureChatOpenAI", "chatOpenAICustom", "ChatOpenAI"]);

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

export function chatProvider(
  component: string | undefined,
  config: Record<string, unknown>,
  b: Builder,
  at: { sourceId?: string; nodeId?: string },
): ProviderChoice {
  const model = str(config.modelName) ?? str(config.model);
  if (component && OPENAI_CHAT.has(component))
    return { provider: "openai", model: model ?? "gpt-4.1-mini", secret: OPENAI };
  if (component === "chatAnthropic")
    return { provider: "anthropic", model: model ?? "claude-sonnet-4-5", secret: ANTHROPIC };
  if (component === "chatOllama")
    return { provider: "ollama", model: model ?? "llama3.2", secret: OLLAMA };
  b.issue(
    "W_IMPORT_PROVIDER_CHANGED",
    `${component ?? "the chat model"} has no FlowAId generation provider; switched to OpenAI gpt-4.1-mini`,
    at,
  );
  return { provider: "openai", model: "gpt-4.1-mini", secret: OPENAI };
}

const EMBEDDINGS: Record<string, ProviderChoice> = {
  openAIEmbeddings: { provider: "openai", model: "text-embedding-3-small", secret: OPENAI },
  azureOpenAIEmbeddings: { provider: "openai", model: "text-embedding-3-small", secret: OPENAI },
  ollamaEmbedding: { provider: "ollama", model: "nomic-embed-text", secret: OLLAMA },
};

export function embeddingProvider(
  component: string | undefined,
  config: Record<string, unknown>,
  b: Builder,
  at: { sourceId?: string; nodeId?: string },
): ProviderChoice {
  const known = component ? EMBEDDINGS[component] : undefined;
  const model = str(config.modelName) ?? str(config.model);
  if (known) return { ...known, ...(model ? { model } : {}) };
  b.issue(
    "W_IMPORT_PROVIDER_CHANGED",
    `${component ?? "the embedding model"} is not available; switched to OpenAI text-embedding-3-small`,
    at,
  );
  return { provider: "openai", model: "text-embedding-3-small", secret: OPENAI };
}
