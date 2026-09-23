/**
 * OpenAI and OpenAI-compatible endpoints (ARCHITECTURE.md §6.6). Every preset speaks Chat
 * Completions with SSE streaming; they differ in base URL, credential type, the max-tokens field,
 * extra headers and the provider id results are priced under.
 *
 * Google Gemini goes through its OpenAI-compatible endpoint (credential `google.api_key`, priced
 * from the `google` catalog). Known limitation of that endpoint: thinking is not streamed as
 * deltas, so `thinking` chunks never arrive for Gemini; a native Google provider is a later item.
 */
export interface EndpointPreset {
  /** Provider id used in results, pricing, health and errors. */
  providerId: string;
  baseUrl: string;
  credentialType: string;
  maxTokensField: "max_completion_tokens" | "max_tokens";
  headers?: Record<string, string>;
  /** A key is optional (local vLLM). */
  keyOptional?: boolean;
  label: string;
}

export const PRESETS = {
  openai: {
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    credentialType: "openai.api_key",
    maxTokensField: "max_completion_tokens",
    label: "OpenAI",
  },
  google: {
    providerId: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    credentialType: "google.api_key",
    maxTokensField: "max_tokens",
    label: "Google Gemini (OpenAI-compatible)",
  },
  groq: {
    providerId: "openai-compatible:groq",
    baseUrl: "https://api.groq.com/openai/v1",
    credentialType: "openai.api_key",
    maxTokensField: "max_tokens",
    label: "Groq",
  },
  mistral: {
    providerId: "openai-compatible:mistral",
    baseUrl: "https://api.mistral.ai/v1",
    credentialType: "openai.api_key",
    maxTokensField: "max_tokens",
    label: "Mistral",
  },
  xai: {
    providerId: "openai-compatible:xai",
    baseUrl: "https://api.x.ai/v1",
    credentialType: "openai.api_key",
    maxTokensField: "max_tokens",
    label: "xAI",
  },
  openrouter: {
    providerId: "openai-compatible:openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    credentialType: "openai.api_key",
    maxTokensField: "max_tokens",
    headers: { "HTTP-Referer": "https://github.com/MoRohn/flowaid", "X-Title": "FlowAId" },
    label: "OpenRouter",
  },
  together: {
    providerId: "openai-compatible:together",
    baseUrl: "https://api.together.xyz/v1",
    credentialType: "openai.api_key",
    maxTokensField: "max_tokens",
    label: "Together",
  },
  vllm: {
    providerId: "openai-compatible:vllm",
    baseUrl: "http://localhost:8000/v1",
    credentialType: "openai.api_key",
    maxTokensField: "max_tokens",
    keyOptional: true,
    label: "vLLM",
  },
} as const satisfies Record<string, EndpointPreset>;

export type PresetName = keyof typeof PRESETS;

export function isPresetName(value: unknown): value is PresetName {
  return typeof value === "string" && value in PRESETS;
}
