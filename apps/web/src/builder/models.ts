"use client";
/**
 * The model catalog for the builder's pickers: `GET /v1/models` (the API's catalog, with
 * workspace overrides) mapped to the `ModelView` rows `ModelPicker` and `ModelFallbacks` show.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ModelView } from "@flowaid/ui";
import type { ModelInfo } from "@flowaid/workflow-core";
import { get, getAll } from "~/api/client";
import { useSession } from "~/session";

const LOCAL_PROVIDERS = new Set(["ollama", "vllm"]);

export function toModelViews(models: readonly ModelInfo[]): ModelView[] {
  return models.flatMap((m): ModelView[] => {
    const kind =
      m.kind === "chat" ? "generation" : m.kind === "rerank" ? null : (m.kind as ModelView["kind"]);
    if (kind === null) return [];
    return [
      {
        id: m.model,
        provider: m.provider,
        name: m.model,
        kind,
        ...(m.contextTokens !== undefined ? { contextTokens: m.contextTokens } : {}),
        ...(m.pricing
          ? { inputCostPerMTok: m.pricing.inputPerMTok, outputCostPerMTok: m.pricing.outputPerMTok }
          : {}),
        ...(LOCAL_PROVIDERS.has(m.provider) ? { local: true } : {}),
      },
    ];
  });
}

/**
 * Marks models whose provider has no key anywhere FlowAId looks: not on the server
 * (`configuredOnServer`) and no `<provider>.api_key` credential saved in the workspace. Local
 * providers need none. Unknown (still loading) key state marks nothing.
 */
export function markKeyless(
  views: readonly ModelView[],
  keys: { server: Readonly<Record<string, boolean>>; saved: readonly string[] } | null,
): ModelView[] {
  if (!keys) return [...views];
  return views.map((m) =>
    m.local || keys.server[m.provider] || keys.saved.includes(`${m.provider}.api_key`)
      ? m
      : { ...m, needsKey: true },
  );
}

/** The workspace's models as picker rows (empty while loading or when the call fails). */
export function useModelViews(): ModelView[] {
  const s = useSession();
  const models = useQuery({
    queryKey: ["catalog", "models"],
    queryFn: () => get<ModelInfo[]>("/v1/models"),
    staleTime: 10 * 60_000,
    select: toModelViews,
  });
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<{ id: string; configuredOnServer: boolean }[]>("/v1/providers"),
    staleTime: 60_000,
  });
  const credentials = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<{ type: string }>("/v1/credentials"),
    enabled: s.can("credentials:read"),
  });
  const keys = useMemo(
    () =>
      providers.data && (credentials.data || !s.can("credentials:read"))
        ? {
            server: Object.fromEntries(providers.data.map((p) => [p.id, p.configuredOnServer])),
            saved: (credentials.data ?? []).map((c) => c.type),
          }
        : null,
    [providers.data, credentials.data, s],
  );
  return useMemo(() => markKeyless(models.data ?? [], keys), [models.data, keys]);
}
