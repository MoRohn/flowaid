/** Registry factory: `registry.register(anthropicFactory())`; credential type `anthropic.api_key`. */
import {
  CredentialError,
  type GenerationProvider,
  type ProviderFactory,
} from "@flowaid/workflow-core";
import { AnthropicClient } from "./client.js";

export function anthropicFactory(
  opts: { baseUrl?: string } = {},
): ProviderFactory<GenerationProvider> {
  return {
    id: "anthropic",
    kind: "generation",
    credentialType: "anthropic.api_key",
    create: ({ model, credential, http, catalog }) => {
      const apiKey = credential?.apiKey;
      if (!apiKey)
        throw new CredentialError("Anthropic needs an API key (credential type anthropic.api_key)");
      return new AnthropicClient({
        model,
        apiKey,
        http,
        catalog,
        ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      });
    },
  };
}
