/**
 * The server's own provider keys (TYPESAFE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, OLLAMA_HOST),
 * as `GET /v1/providers` reports them (`configuredOnServer`) and as the run-start and deploy checks
 * use them: a required secret whose credential type the server has a key for counts as satisfied,
 * because the worker falls back to that key when the environment binds nothing
 * (`apps/worker/src/services/credentials.ts`).
 */
import type { SecretDecl } from "@flowaid/workflow-core";

type Flags = {
  hasTypeSafe?: boolean;
  hasOpenAI?: boolean;
  hasAnthropic?: boolean;
  hasOllama?: boolean;
};

/** provider id → the credential types its server key answers (the worker's fallbacks). */
export const SERVER_KEY_TYPES: Readonly<Record<string, readonly string[]>> = {
  typesafe: ["typesafe.api_key"],
  openai: ["openai.api_key"],
  anthropic: ["anthropic.api_key"],
  ollama: ["ollama.host", "ollama.none"],
};

/** provider id → whether the server has its key. */
export function serverProviders(env: { flags?: Flags } | undefined): Record<string, boolean> {
  const f = env?.flags;
  return {
    typesafe: f?.hasTypeSafe ?? false,
    openai: f?.hasOpenAI ?? false,
    anthropic: f?.hasAnthropic ?? false,
    ollama: f?.hasOllama ?? false,
  };
}

/** Credential types a run can resolve from the server's own keys. */
export function serverCredentialTypes(env: { flags?: Flags } | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [provider, configured] of Object.entries(serverProviders(env)))
    if (configured) for (const t of SERVER_KEY_TYPES[provider] ?? []) out.add(t);
  return out;
}

/** Required secrets neither bound in the environment nor answered by a server key. */
export function unboundRequiredSecrets<S extends Pick<SecretDecl, "name" | "credentialType">>(
  declared: readonly (S & { required?: boolean | undefined })[],
  bound: ReadonlySet<string>,
  served: ReadonlySet<string>,
): S[] {
  return declared.filter(
    (s) => s.required !== false && !bound.has(s.name) && !served.has(s.credentialType),
  );
}
