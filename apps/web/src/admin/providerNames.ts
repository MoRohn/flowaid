/** Display names of the model providers the registry knows. */
export const PROVIDER_NAME: Readonly<Record<string, string>> = {
  typesafe: "TypeSafe",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  ollama: "Ollama",
  cohere: "Cohere",
  jina: "Jina AI",
};

export const providerName = (id: string): string => PROVIDER_NAME[id] ?? id;

/** The credential type a provider's key is stored as (Ollama: its server address). */
export const providerCredentialType = (id: string): string =>
  id === "ollama" ? "ollama.host" : `${id}.api_key`;
