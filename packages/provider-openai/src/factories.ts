/**
 * Registry factories (`registry.register(...)`) for OpenAI and every compatible endpoint:
 *
 * - `openai` (generation) and `openai` (embedding): api.openai.com, credential `openai.api_key`
 *   (`apiKey`, optional `organization`, optional `baseUrl` for an Azure-style proxy);
 * - `google` (generation, embedding): Gemini through its OpenAI-compatible endpoint;
 * - `openai-compatible` (generation, embedding): a preset (`options.preset`: groq, mistral, xai,
 *   openrouter, together, vllm) or any `baseUrl` (from the credential or `options.baseUrl`).
 */
import { OpenAICompatibleClient } from "@flowaid/providers";
import {
  CredentialError,
  ProviderError,
  type EmbeddingProvider,
  type GenerationProvider,
  type JsonObject,
  type ModelCatalog,
  type ProviderFactory,
  type SafeFetch,
} from "@flowaid/workflow-core";
import { PRESETS, isPresetName, type EndpointPreset } from "./presets.js";

interface CreateOptions {
  model: string;
  credential: Record<string, string> | undefined;
  options?: JsonObject;
  http: SafeFetch;
  catalog: ModelCatalog;
}

/** Builds the client for one preset (or custom endpoint) from a credential. */
export function clientFor(preset: EndpointPreset, o: CreateOptions): OpenAICompatibleClient {
  const apiKey = o.credential?.apiKey;
  if (!apiKey && !preset.keyOptional)
    throw new CredentialError(
      `${preset.label} needs an API key (credential type ${preset.credentialType})`,
    );
  const baseUrl =
    o.credential?.baseUrl ??
    (typeof o.options?.baseUrl === "string" ? o.options.baseUrl : preset.baseUrl);
  const headers: Record<string, string> = { ...preset.headers };
  if (o.credential?.organization) headers["OpenAI-Organization"] = o.credential.organization;
  return new OpenAICompatibleClient({
    provider: preset.providerId,
    model: o.model,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    http: o.http,
    catalog: o.catalog,
    headers,
    maxTokensField: preset.maxTokensField,
    ...(typeof o.options?.embeddingDimensions === "number"
      ? { embeddingDimensions: o.options.embeddingDimensions }
      : {}),
  });
}

function presetFrom(
  options: JsonObject | undefined,
  credential: Record<string, string> | undefined,
): EndpointPreset {
  const name = options?.preset;
  if (isPresetName(name)) return PRESETS[name];
  const baseUrl =
    credential?.baseUrl ?? (typeof options?.baseUrl === "string" ? options.baseUrl : undefined);
  if (!baseUrl)
    throw new ProviderError(
      "An OpenAI-compatible provider needs a preset or a baseUrl",
      false,
      "openai-compatible",
    );
  return {
    providerId: typeof options?.providerId === "string" ? options.providerId : "openai-compatible",
    baseUrl,
    credentialType: "openai.api_key",
    maxTokensField: "max_tokens",
    keyOptional: true,
    label: `OpenAI-compatible endpoint ${new URL(baseUrl).host}`,
  };
}

const generation = (
  id: string,
  credentialType: string,
  preset: (o: CreateOptions) => EndpointPreset,
): ProviderFactory<GenerationProvider> => ({
  id,
  kind: "generation",
  credentialType,
  create: (o) => clientFor(preset(o), o),
});

const embedding = (
  id: string,
  credentialType: string,
  preset: (o: CreateOptions) => EndpointPreset,
): ProviderFactory<EmbeddingProvider> => ({
  id,
  kind: "embedding",
  credentialType,
  create: (o) => clientFor(preset(o), o),
});

export const openaiFactory = () =>
  generation("openai", PRESETS.openai.credentialType, () => PRESETS.openai);
export const openaiEmbeddingFactory = () =>
  embedding("openai", PRESETS.openai.credentialType, () => PRESETS.openai);
export const googleFactory = () =>
  generation("google", PRESETS.google.credentialType, () => PRESETS.google);
export const googleEmbeddingFactory = () =>
  embedding("google", PRESETS.google.credentialType, () => PRESETS.google);
export const openaiCompatibleFactory = () =>
  generation("openai-compatible", "openai.api_key", (o) => presetFrom(o.options, o.credential));
export const openaiCompatibleEmbeddingFactory = () =>
  embedding("openai-compatible", "openai.api_key", (o) => presetFrom(o.options, o.credential));

/** Every factory of this package, for `for (const f of openaiFactories()) registry.register(f)`. */
export function openaiFactories(): ProviderFactory<GenerationProvider | EmbeddingProvider>[] {
  return [
    openaiFactory(),
    openaiEmbeddingFactory(),
    googleFactory(),
    googleEmbeddingFactory(),
    openaiCompatibleFactory(),
    openaiCompatibleEmbeddingFactory(),
  ];
}

/** Model discovery (`GET /models`) for a preset with a key. */
export function listModels(
  preset: EndpointPreset,
  apiKey: string | undefined,
  http: SafeFetch,
  catalog: ModelCatalog,
  signal?: AbortSignal,
): Promise<string[]> {
  return clientFor(preset, {
    model: "discovery",
    credential: apiKey ? { apiKey } : undefined,
    http,
    catalog,
  }).listModels(signal);
}
