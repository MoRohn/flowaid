/**
 * Credential slots in words (pure, so it is unit tested). A node's slot binds to a secret the
 * workflow declares; at run time the secret resolves to the credential bound for the environment,
 * or for model providers to the server's own key (TYPESAFE_API_KEY, OPENAI_API_KEY, …). These
 * helpers name credential types, suggest secret names and say where a secret's value will come
 * from, using only what `/v1/providers` and `/v1/credentials` report.
 */

const TYPE_LABEL: Readonly<Record<string, string>> = {
  "typesafe.api_key": "TypeSafe API key",
  "openai.api_key": "OpenAI API key",
  "anthropic.api_key": "Anthropic API key",
  "google.api_key": "Google Gemini API key",
  "ollama.none": "Ollama (no key)",
  "ollama.host": "Ollama server address",
  "http.bearer": "HTTP bearer token",
  "http.api_key": "HTTP API key",
  "http.basic": "HTTP basic auth",
  "mcp.headers": "MCP server headers",
};

/** "OpenAI API key" for "openai.api_key"; the id itself for types without a name. */
export function credentialTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

/** OPENAI_API_KEY for "openai.api_key" (OLLAMA for "ollama.none"), unique among `taken`. */
export function suggestSecretName(type: string, taken: readonly string[]): string {
  const base =
    type === "ollama.none"
      ? "OLLAMA"
      : type
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .replace(/^(?=[0-9])/, "S_")
          .slice(0, 60) || "SECRET";
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}_${i}`)) return `${base}_${i}`;
}

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export interface KeySources {
  /** provider id → the server has its key (`GET /v1/providers` `configuredOnServer`) */
  server: Readonly<Record<string, boolean>>;
  /** credential types saved in the workspace */
  saved: readonly string[];
}

export type KeySource =
  /** the server's own key answers when no environment binding does */
  | { kind: "server"; provider: string }
  /** no key is needed (Ollama on this computer) */
  | { kind: "none" }
  /** a credential of this type exists; it still has to be bound per environment */
  | { kind: "saved" }
  /** nothing yet: add a credential, then bind it */
  | { kind: "missing" };

const providerOf = (type: string) => {
  const [provider, kind] = type.split(".");
  return kind === "api_key" ? provider : undefined;
};

/**
 * Where a secret of this type gets its value at run time, as far as the workspace shows. A run
 * does not start while a *required* secret is unbound in its environment, so the server's own key
 * and "no key" only count for an optional one; a required one always needs a bound credential.
 */
export function keySource(type: string, sources: KeySources, required = false): KeySource {
  if (!required) {
    if (type === "ollama.none") return { kind: "none" };
    const provider = providerOf(type);
    if (provider && sources.server[provider]) return { kind: "server", provider };
  }
  if (sources.saved.includes(type)) return { kind: "saved" };
  return { kind: "missing" };
}
