"use client";
/**
 * The model catalog for the builder's pickers: `GET /v1/models` (the API's catalog, with
 * workspace overrides) mapped to the `ModelView` rows `ModelPicker` and `ModelFallbacks` show.
 */
import { useQuery } from "@tanstack/react-query";
import type { ModelView } from "@flowaid/ui";
import type { ModelInfo } from "@flowaid/workflow-core";
import { get } from "~/api/client";

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

/** The workspace's models as picker rows (empty while loading or when the call fails). */
export function useModelViews(): ModelView[] {
  const models = useQuery({
    queryKey: ["catalog", "models"],
    queryFn: () => get<ModelInfo[]>("/v1/models"),
    staleTime: 10 * 60_000,
    select: toModelViews,
  });
  return models.data ?? [];
}
