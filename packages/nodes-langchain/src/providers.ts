/**
 * `langchain:<vendor>` providers shipped through `NodePackage.providers` (LANGCHAIN.md §2): a model
 * ref `{ provider: 'langchain:openai', model: 'gpt-4.1-mini' }` runs through LangChain's vendor
 * integration instead of the native client. The vendor clients get the workspace's SafeFetch as
 * their `fetch`, so SSRF rules, egress policy and byte caps apply exactly as for native providers;
 * credentials reuse the catalog types (`openai.api_key`, `anthropic.api_key`, `ollama.host`).
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import {
  langChainEmbeddingFactory,
  langChainGenerationFactory,
  type LangChainBuildArgs,
} from "@flowaid/langchain";
import {
  CredentialError,
  type DecisionProvider,
  type EmbeddingProvider,
  type GenerationProvider,
  type ProviderFactory,
  type SafeFetch,
} from "@flowaid/workflow-core";

/** A WHATWG `fetch` over SafeFetch (vendor SDKs pass URL objects and Requests). */
export function fetchVia(http: SafeFetch): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof input === "string") return http(input, init);
    if (input instanceof URL) return http(input.href, init);
    return http(input.url, {
      method: input.method,
      headers: input.headers,
      ...(input.body ? { body: await input.text() } : {}),
      ...init,
    });
  };
}

const optionString = (args: LangChainBuildArgs, key: string): string | undefined => {
  const v = args.options?.[key];
  return typeof v === "string" ? v : undefined;
};

function apiKey(args: LangChainBuildArgs, vendor: string, type: string): string {
  const key = args.credential?.apiKey;
  if (!key)
    throw new CredentialError(`langchain:${vendor} needs an API key (credential type ${type})`);
  return key;
}

function ollamaHost(args: LangChainBuildArgs): {
  baseUrl: string;
  headers?: Record<string, string>;
} {
  const host = args.credential?.host ?? optionString(args, "host") ?? "http://localhost:11434";
  const token = args.credential?.token;
  return { baseUrl: host, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) };
}

export const langchainOpenAI = (): ProviderFactory<GenerationProvider> =>
  langChainGenerationFactory({
    vendor: "openai",
    credentialType: "openai.api_key",
    build: (args, s) =>
      new ChatOpenAI({
        model: args.model,
        apiKey: apiKey(args, "openai", "openai.api_key"),
        maxRetries: 0,
        streamUsage: true,
        ...(s.temperature !== undefined ? { temperature: s.temperature } : {}),
        ...(s.topP !== undefined ? { topP: s.topP } : {}),
        ...(s.maxOutputTokens !== undefined ? { maxTokens: s.maxOutputTokens } : {}),
        ...(s.seed !== undefined ? { seed: s.seed } : {}),
        configuration: {
          fetch: fetchVia(args.http),
          ...(args.credential?.baseUrl ? { baseURL: args.credential.baseUrl } : {}),
          ...(args.credential?.organization ? { organization: args.credential.organization } : {}),
        },
      }),
  });

export const langchainAnthropic = (): ProviderFactory<GenerationProvider> =>
  langChainGenerationFactory({
    vendor: "anthropic",
    credentialType: "anthropic.api_key",
    build: (args, s) =>
      new ChatAnthropic({
        model: args.model,
        apiKey: apiKey(args, "anthropic", "anthropic.api_key"),
        maxRetries: 0,
        maxTokens: s.maxOutputTokens ?? 4096,
        ...(s.temperature !== undefined ? { temperature: s.temperature } : {}),
        ...(s.topP !== undefined ? { topP: s.topP } : {}),
        clientOptions: { fetch: fetchVia(args.http) },
      }),
  });

export const langchainOllama = (): ProviderFactory<GenerationProvider> =>
  langChainGenerationFactory({
    vendor: "ollama",
    build: (args, s) =>
      new ChatOllama({
        model: args.model,
        ...ollamaHost(args),
        fetch: fetchVia(args.http),
        ...(s.temperature !== undefined ? { temperature: s.temperature } : {}),
        ...(s.topP !== undefined ? { topP: s.topP } : {}),
        ...(s.maxOutputTokens !== undefined ? { numPredict: s.maxOutputTokens } : {}),
        ...(s.seed !== undefined ? { seed: s.seed } : {}),
      }),
  });

export const langchainOpenAIEmbeddings = (): ProviderFactory<EmbeddingProvider> =>
  langChainEmbeddingFactory({
    vendor: "openai",
    credentialType: "openai.api_key",
    build: (args) =>
      new OpenAIEmbeddings({
        model: args.model,
        apiKey: apiKey(args, "openai", "openai.api_key"),
        maxRetries: 0,
        configuration: {
          fetch: fetchVia(args.http),
          ...(args.credential?.baseUrl ? { baseURL: args.credential.baseUrl } : {}),
        },
      }),
  });

export const langchainOllamaEmbeddings = (): ProviderFactory<EmbeddingProvider> =>
  langChainEmbeddingFactory({
    vendor: "ollama",
    build: (args) =>
      new OllamaEmbeddings({ model: args.model, ...ollamaHost(args), fetch: fetchVia(args.http) }),
  });

/** Every provider factory of the package. */
export const LANGCHAIN_PROVIDERS: readonly ProviderFactory<
  DecisionProvider | GenerationProvider | EmbeddingProvider
>[] = [
  langchainOpenAI(),
  langchainAnthropic(),
  langchainOllama(),
  langchainOpenAIEmbeddings(),
  langchainOllamaEmbeddings(),
];
