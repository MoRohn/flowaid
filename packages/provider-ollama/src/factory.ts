/**
 * Registry factories: `ollama` for generation and embedding. Credential type `ollama.host`
 * (`host`, optional `token`) or none: then the node's `host` option, else the server's default
 * (`OLLAMA_HOST`, passed as `opts.host`), else http://localhost:11434.
 */
import type {
  EmbeddingProvider,
  GenerationProvider,
  ProviderFactory,
} from "@flowaid/workflow-core";
import { OllamaClient } from "./client.js";

type Create = ProviderFactory<GenerationProvider>["create"];
const creator =
  (defaultHost: string | undefined): Create =>
  ({ model, credential, http, catalog, options }) => {
    const host =
      credential?.host ??
      (typeof options?.host === "string" ? options.host : undefined) ??
      defaultHost;
    return new OllamaClient({
      model,
      http,
      catalog,
      ...(host ? { host } : {}),
      ...(credential?.token ? { token: credential.token } : {}),
    });
  };

export interface OllamaFactoryOptions {
  /** the server's Ollama (OLLAMA_HOST), used when neither a credential nor the node names one */
  host?: string | undefined;
}

export const ollamaFactory = (
  o: OllamaFactoryOptions = {},
): ProviderFactory<GenerationProvider> => ({
  id: "ollama",
  kind: "generation",
  create: creator(o.host),
});
export const ollamaEmbeddingFactory = (
  o: OllamaFactoryOptions = {},
): ProviderFactory<EmbeddingProvider> => ({
  id: "ollama",
  kind: "embedding",
  create: creator(o.host) as unknown as ProviderFactory<EmbeddingProvider>["create"],
});
