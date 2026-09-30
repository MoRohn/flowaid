"use client";
/**
 * Which model providers this workspace can call right now: a key set on the server
 * (`GET /v1/providers`) or a credential stored in the workspace. The same rule the
 * getting-started checklist uses, shared so every page's "What you need" agrees with it.
 */
import { useQuery } from "@tanstack/react-query";
import { get, getAll } from "~/api/client";
import type { Credential, Provider } from "~/admin/types";
import { providerName } from "~/admin/providerNames";
import { useSession } from "~/session";
import { GENERATION_PROVIDERS as GENERATION } from "~/onboarding/steps";
import type { Check } from "./Readiness";

export interface Connections {
  loading: boolean;
  /** the credentials list could not be read (no permission): only server keys are known */
  partial: boolean;
  ready: (provider: string) => boolean;
  /** providers with a key, in GENERATION order */
  generation: string[];
  credentials: readonly Credential[];
}

export function useConnections(): Connections {
  const s = useSession();
  const canRead = s.can("credentials:read");
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<Provider[]>("/v1/providers"),
    staleTime: 60_000,
  });
  const credentials = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
    enabled: canRead,
  });
  const server = new Set(
    (providers.data ?? []).filter((p) => p.configuredOnServer).map((p) => p.id),
  );
  const types = (credentials.data ?? []).map((c) => c.type);
  const ready = (p: string) => server.has(p) || types.some((t) => t.startsWith(`${p}.`));
  return {
    loading: providers.isPending || (canRead && credentials.isPending),
    partial: !canRead || credentials.isError,
    ready,
    generation: GENERATION.filter(ready),
    credentials: credentials.data ?? [],
  };
}

/** "TypeSafe key" as a "What you need" line, with the way to fix it. */
export function typesafeCheck(c: Connections, ws: string, need = "Decision steps"): Check {
  if (c.loading) return { id: "typesafe", label: "TypeSafe key", state: "checking" };
  return c.ready("typesafe")
    ? { id: "typesafe", label: "TypeSafe key connected", state: "ok" }
    : {
        id: "typesafe",
        label: "TypeSafe key",
        state: "blocker",
        detail: `${need} are answered by TypeSafe and fail without its key.`,
        fix: (
          <a className="text-accent-text hover:underline" href={`/${ws}/credentials`}>
            Add the key under Credentials
          </a>
        ),
      };
}

/** "A model for generated text" as a "What you need" line. */
export function generationCheck(
  c: Connections,
  ws: string,
  { required = false, need = "Steps that write text" }: { required?: boolean; need?: string } = {},
): Check {
  if (c.loading) return { id: "generation", label: "A text model", state: "checking" };
  if (c.generation.length)
    return {
      id: "generation",
      label: `Text model ready: ${c.generation.map(providerName).join(", ")}`,
      state: "ok",
    };
  return {
    id: "generation",
    label: "A text model (OpenAI, Anthropic or Ollama)",
    state: required ? "blocker" : "optional",
    detail: `${need} need one.${c.partial ? " Keys stored as credentials are not visible to your role." : ""}`,
    fix: (
      <a className="text-accent-text hover:underline" href={`/${ws}/credentials`}>
        Add a key under Credentials
      </a>
    ),
  };
}
