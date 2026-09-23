/**
 * Registry factories: `ollama` for generation and embedding. Credential type `ollama.host`
 * (`host`, optional `token`) or none — a local server at http://localhost:11434.
 */
import type {
  EmbeddingProvider,
  GenerationProvider,
  ProviderFactory,
} from "@flowaid/workflow-core";
import { OllamaClient } from "./client.js";

type Create = ProviderFactory<GenerationProvider>["create"];
const create: Create = ({ model, credential, http, catalog, options }) =>
  new OllamaClient({
    model,
    http,
    catalog,
    ...(credential?.host
      ? { host: credential.host }
      : typeof options?.host === "string"
        ? { host: options.host }
        : {}),
    ...(credential?.token ? { token: credential.token } : {}),
  });

export const ollamaFactory = (): ProviderFactory<GenerationProvider> => ({
  id: "ollama",
  kind: "generation",
  create,
});
export const ollamaEmbeddingFactory = (): ProviderFactory<EmbeddingProvider> => ({
  id: "ollama",
  kind: "embedding",
  create: create as unknown as ProviderFactory<EmbeddingProvider>["create"],
});
