/**
 * The generation model FlowAId uses for its own work (the AI builder in the API, the evaluation
 * judge in the worker): the workspace's `settings.advisorModel` when it names one, else the first
 * default whose provider has a key (a workspace credential or the server's own). Shared so the API
 * and the worker pick the same model; each supplies its own key lookup.
 */
import type { ModelRef } from "@flowaid/workflow-core";

export interface DefaultGenerationModel extends ModelRef {
  /** the credential type that makes this default usable */
  credentialType: string;
}

/** Defaults tried in order when the workspace names no model. */
export const DEFAULT_GENERATION_MODELS: readonly DefaultGenerationModel[] = [
  { provider: "anthropic", model: "claude-sonnet-5", credentialType: "anthropic.api_key" },
  { provider: "openai", model: "gpt-5.5", credentialType: "openai.api_key" },
  { provider: "ollama", model: "qwen3:8b", credentialType: "ollama.host" },
];

export interface SelectGenerationModelInput {
  /** `settings.advisorModel` as stored (anything; only `{ provider, model }` strings count) */
  configured: unknown;
  /** ids of the registered generation factories */
  registered: readonly string[];
  /** whether a workspace credential or a server key of this type exists */
  hasKey: (credentialType: string) => boolean | Promise<boolean>;
}

/**
 * The configured model when the workspace sets one (null when its provider is not registered),
 * else the first default with a registered provider and a key; null when none is available.
 */
export async function selectGenerationModel(
  input: SelectGenerationModelInput,
): Promise<ModelRef | null> {
  const configured = input.configured as { provider?: unknown; model?: unknown } | null | undefined;
  if (typeof configured?.provider === "string" && typeof configured.model === "string") {
    const ref = { provider: configured.provider, model: configured.model };
    return input.registered.includes(ref.provider) ? ref : null;
  }
  for (const d of DEFAULT_GENERATION_MODELS) {
    if (!input.registered.includes(d.provider)) continue;
    if (await input.hasKey(d.credentialType)) return { provider: d.provider, model: d.model };
  }
  return null;
}
