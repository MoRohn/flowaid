/**
 * Help shown while creating a credential: what the secret is, where to get one, and hints for
 * fields whose meaning the type's schema does not spell out (the defaults of `baseUrl` above all).
 */
export interface CredentialGuide {
  /** Where to get the secret. */
  where?: { label: string; url: string };
  /** One line on what it unlocks in FlowAId. */
  use?: string;
  /** Per field: a hint that replaces the generic one. */
  fields?: Record<string, string>;
}

const GUIDES: Record<string, CredentialGuide> = {
  "typesafe.api_key": {
    use: "Answers decision nodes (yes/no, choice, score) with calibrated probabilities.",
    where: { label: "TypeSafe dashboard", url: "https://docs.typesafe.ai" },
    fields: { baseUrl: "Leave empty for https://api.typesafe.ai" },
  },
  "openai.api_key": {
    use: "Generation, embeddings and model routing with OpenAI or a compatible server.",
    where: { label: "OpenAI API keys", url: "https://platform.openai.com/api-keys" },
    fields: {
      baseUrl: "Leave empty for https://api.openai.com/v1; set it for an OpenAI-compatible server",
    },
  },
  "anthropic.api_key": {
    use: "Generation with Claude models.",
    where: { label: "Anthropic console", url: "https://console.anthropic.com/settings/keys" },
  },
  "google.api_key": {
    use: "Generation and embeddings with Gemini models.",
    where: { label: "Google AI Studio", url: "https://aistudio.google.com/apikey" },
  },
  "cohere.api_key": {
    use: "Rerank nodes and knowledge search reranking.",
    where: { label: "Cohere dashboard", url: "https://dashboard.cohere.com/api-keys" },
    fields: { baseUrl: "Leave empty for https://api.cohere.com" },
  },
  "jina.api_key": {
    use: "Rerank and embedding models.",
    where: { label: "Jina AI", url: "https://jina.ai/api-dashboard" },
    fields: { baseUrl: "Leave empty for https://api.jina.ai" },
  },
  "ollama.host": {
    use: "Models served by your own Ollama server.",
    fields: {
      host: "For example http://localhost:11434",
      token: "Only when a proxy in front of Ollama asks for one",
    },
  },
  "github.token": {
    use: "GitHub tools and repository knowledge sources.",
    where: {
      label: "GitHub fine-grained tokens",
      url: "https://github.com/settings/personal-access-tokens",
    },
  },
  "http.api_key": {
    fields: {
      in: "Where the key goes: a request header or a query parameter",
      name: "The header or parameter name, X-API-Key by default",
    },
  },
  "postgres.dsn": {
    fields: { dsn: "postgres://user:password@host:5432/database" },
  },
};

export function credentialGuide(typeId: string): CredentialGuide {
  return GUIDES[typeId] ?? {};
}
