/**
 * Registry factories for `langchain:<vendor>` providers (LANGCHAIN.md §2): a model ref
 * `{ provider: 'langchain:openai', model: 'gpt-4.1-mini' }` resolves through LangChain instead of
 * the native client. The vendor package builds the LangChain model from the resolved credential,
 * options and the workspace's SafeFetch; pricing uses the native catalog entry of the vendor.
 * Node packages ship these through `NodePackage.providers`.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Embeddings } from "@langchain/core/embeddings";
import type {
  EmbeddingProvider,
  GenerationProvider,
  JsonObject,
  ProviderFactory,
  SafeFetch,
} from "@flowaid/workflow-core";
import { LangChainEmbeddingProvider } from "./embeddings.js";
import { LangChainGenerationProvider, type ChatModelSettings } from "./generation.js";

export interface LangChainBuildArgs {
  model: string;
  credential: Record<string, string> | undefined;
  options: JsonObject | undefined;
  /** the workspace's SSRF-guarded fetch; vendors that accept a `fetch` must use it */
  http: SafeFetch;
}

export function langChainGenerationFactory(spec: {
  vendor: string;
  credentialType?: string;
  /** native catalog provider id used for pricing (default the vendor) */
  pricingProvider?: string;
  build: (args: LangChainBuildArgs, settings: ChatModelSettings) => BaseChatModel;
}): ProviderFactory<GenerationProvider> {
  const id = `langchain:${spec.vendor}`;
  return {
    id,
    kind: "generation",
    ...(spec.credentialType ? { credentialType: spec.credentialType } : {}),
    create: ({ model, credential, options, http, catalog }) =>
      new LangChainGenerationProvider(
        (settings) => spec.build({ model, credential, options, http }, settings),
        { id, model, pricing: { catalog, provider: spec.pricingProvider ?? spec.vendor } },
      ),
  };
}

export function langChainEmbeddingFactory(spec: {
  vendor: string;
  credentialType?: string;
  pricingProvider?: string;
  build: (args: LangChainBuildArgs) => Embeddings;
}): ProviderFactory<EmbeddingProvider> {
  const id = `langchain:${spec.vendor}`;
  return {
    id,
    kind: "embedding",
    ...(spec.credentialType ? { credentialType: spec.credentialType } : {}),
    create: ({ model, credential, options, http, catalog }) =>
      new LangChainEmbeddingProvider(spec.build({ model, credential, options, http }), {
        id,
        model,
        pricing: { catalog, provider: spec.pricingProvider ?? spec.vendor },
      }),
  };
}
