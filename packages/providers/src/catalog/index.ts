/**
 * The model catalog (ARCHITECTURE.md §6.2): the per-provider JSON catalogs in this directory
 * (versioned in git, with their sources and retrieval date), merged with workspace overrides
 * (the `models` table, custom endpoints) and live discovery cached for 10 minutes.
 *
 * `price()` returns the cost and the `PriceSnapshot` recorded on every completion event, so
 * historical cost never drifts when prices change. Convention: `TokenUsage.inputTokens` includes
 * cache reads and writes; they are billed at their own rates and the rest at the input rate. A
 * model with a long-context tier bills the whole request at that tier once its input exceeds
 * the threshold.
 */
import { z } from "zod";
import {
  PriceSnapshotSchema,
  type ModelCatalog,
  type ModelInfo,
  type PriceSnapshot,
  type TokenUsage,
} from "@flowaid/workflow-core";
import { systemClock, type ProviderClock } from "../signals.js";
import anthropic from "./anthropic.json" with { type: "json" };
import google from "./google.json" with { type: "json" };
import ollama from "./ollama.json" with { type: "json" };
import openaiCompatible from "./openai-compatible.json" with { type: "json" };
import openai from "./openai.json" with { type: "json" };
import typesafe from "./typesafe.json" with { type: "json" };

export interface LongContextTier {
  thresholdTokens: number;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
}

export interface CatalogEntry extends ModelInfo {
  longContext?: LongContextTier;
  /** Provider limits (requests per minute feeds the rate limiter). */
  limits?: { rpm?: number; maxRequestTokens?: number; maxStateTokens?: number };
}

export interface CatalogFile {
  retrievedAt: string;
  sources: string[];
  models: CatalogEntry[];
}

export interface OpenAICompatiblePreset {
  id: string;
  name: string;
  baseUrl: string | null;
}

const CatalogEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  kind: z.enum(["decision", "chat", "embedding", "rerank"]),
  contextTokens: z.int().positive().optional(),
  maxOutputTokens: z.int().positive().optional(),
  pricing: PriceSnapshotSchema.optional(),
  deprecated: z.string().optional(),
  capabilities: z.record(z.string(), z.boolean()),
  longContext: z
    .object({
      thresholdTokens: z.int().positive(),
      inputPerMTok: z.number().min(0),
      outputPerMTok: z.number().min(0),
      cacheReadPerMTok: z.number().min(0).optional(),
    })
    .optional(),
  limits: z
    .object({
      rpm: z.int().positive().optional(),
      maxRequestTokens: z.int().positive().optional(),
      maxStateTokens: z.int().positive().optional(),
    })
    .optional(),
});

const CatalogFileSchema = z.object({
  retrievedAt: z.iso.date(),
  sources: z.array(z.string()).min(1),
  models: z.array(CatalogEntrySchema),
});

const PresetSchema = z.object({ id: z.string(), name: z.string(), baseUrl: z.string().nullable() });

/** The git catalogs, validated on load so a malformed price can never reach the accounting. */
export const CATALOG_FILES: Readonly<Record<string, CatalogFile>> = {
  typesafe: CatalogFileSchema.parse(typesafe),
  openai: CatalogFileSchema.parse(openai),
  anthropic: CatalogFileSchema.parse(anthropic),
  google: CatalogFileSchema.parse(google),
  ollama: CatalogFileSchema.parse(ollama),
};

export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAICompatiblePreset[] = z
  .array(PresetSchema)
  .parse(openaiCompatible.presets);

export const BUILTIN_MODELS: readonly CatalogEntry[] = Object.values(CATALOG_FILES).flatMap(
  (f) => f.models,
);

/** Lists the models a provider serves right now (`/v1/models`, `/models`, `/api/tags`). */
export interface ModelDiscovery {
  provider: string;
  list(): Promise<(string | Partial<CatalogEntry>)[]>;
}

export const DISCOVERY_TTL_MS = 10 * 60_000;

const PER_MILLION = 1_000_000;

export class DefaultModelCatalog implements ModelCatalog {
  private readonly base: CatalogEntry[];
  private overrides: CatalogEntry[];
  private readonly discovered = new Map<string, { at: number; entries: CatalogEntry[] }>();

  constructor(
    options: {
      models?: readonly CatalogEntry[];
      overrides?: readonly CatalogEntry[];
      discovery?: readonly ModelDiscovery[];
      clock?: ProviderClock;
    } = {},
  ) {
    this.base = [...(options.models ?? BUILTIN_MODELS)];
    this.overrides = [...(options.overrides ?? [])];
    this.discovery = new Map((options.discovery ?? []).map((d) => [d.provider, d]));
    this.clock = options.clock ?? systemClock;
  }

  private readonly discovery: Map<string, ModelDiscovery>;
  private readonly clock: ProviderClock;

  /** Replaces the workspace overrides (models table rows). */
  setOverrides(overrides: readonly CatalogEntry[]): void {
    this.overrides = [...overrides];
  }

  /** Refreshes one provider's discovered models unless the cache is younger than 10 minutes. */
  async discover(provider: string, force = false): Promise<CatalogEntry[]> {
    const cached = this.discovered.get(provider);
    if (!force && cached && this.clock.now() - cached.at < DISCOVERY_TTL_MS) return cached.entries;
    const source = this.discovery.get(provider);
    if (!source) return [];
    const listed = await source.list();
    const entries = listed.map((item): CatalogEntry => {
      const known = typeof item === "string" ? { model: item } : item;
      return {
        provider,
        model: known.model ?? "",
        kind: known.kind ?? "chat",
        capabilities: known.capabilities ?? {},
        ...(known.contextTokens !== undefined ? { contextTokens: known.contextTokens } : {}),
      };
    });
    this.discovered.set(provider, { at: this.clock.now(), entries });
    return entries;
  }

  /** Entries for a provider in precedence order: overrides, the git catalog, then discovery. */
  private entries(provider: string): CatalogEntry[] {
    return [
      ...this.overrides.filter((e) => e.provider === provider),
      ...this.base.filter((e) => e.provider === provider),
      ...(this.discovered.get(provider)?.entries ?? []),
    ];
  }

  resolveAlias(provider: string, model: string): string {
    const entries = this.entries(provider);
    if (entries.some((e) => e.model === model)) return model;
    return entries.find((e) => e.aliases?.includes(model))?.model ?? model;
  }

  get(provider: string, model: string): CatalogEntry | undefined {
    const id = this.resolveAlias(provider, model);
    return this.entries(provider).find((e) => e.model === id);
  }

  list(filter: { provider?: string; kind?: ModelInfo["kind"] } = {}): CatalogEntry[] {
    const providers = filter.provider
      ? [filter.provider]
      : [
          ...new Set(
            [...this.overrides, ...this.base]
              .map((e) => e.provider)
              .concat([...this.discovered.keys()]),
          ),
        ];
    const seen = new Set<string>();
    const out: CatalogEntry[] = [];
    for (const provider of providers) {
      for (const entry of this.entries(provider)) {
        const key = `${entry.provider}/${entry.model}`;
        if (seen.has(key) || (filter.kind && entry.kind !== filter.kind)) continue;
        seen.add(key);
        out.push(entry);
      }
    }
    return out;
  }

  /** Requests per minute the rate limiter allows for a model (undefined = unlimited). */
  rateLimitRpm(provider: string, model: string): number | undefined {
    return this.get(provider, model)?.limits?.rpm;
  }

  price(
    provider: string,
    model: string,
    usage: TokenUsage,
  ): { costUsd: number; snapshot: PriceSnapshot | null } {
    const entry = this.get(provider, model);
    const pricing = entry?.pricing;
    if (!pricing) return { costUsd: 0, snapshot: null };
    const tier =
      entry.longContext && usage.inputTokens > entry.longContext.thresholdTokens
        ? entry.longContext
        : undefined;
    const snapshot: PriceSnapshot = {
      inputPerMTok: tier?.inputPerMTok ?? pricing.inputPerMTok,
      outputPerMTok: tier?.outputPerMTok ?? pricing.outputPerMTok,
    };
    const cacheRead = tier?.cacheReadPerMTok ?? pricing.cacheReadPerMTok;
    if (cacheRead !== undefined) snapshot.cacheReadPerMTok = cacheRead;
    if (pricing.cacheWritePerMTok !== undefined)
      snapshot.cacheWritePerMTok = pricing.cacheWritePerMTok;
    return { costUsd: costOf(usage, snapshot), snapshot };
  }
}

/** Cost of `usage` at `snapshot` prices (cache reads/writes at their own rates when priced). */
export function costOf(usage: TokenUsage, snapshot: PriceSnapshot): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const readRate = snapshot.cacheReadPerMTok ?? snapshot.inputPerMTok;
  const writeRate = snapshot.cacheWritePerMTok ?? snapshot.inputPerMTok;
  const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const cost =
    uncached * snapshot.inputPerMTok +
    cacheRead * readRate +
    cacheWrite * writeRate +
    usage.outputTokens * snapshot.outputPerMTok;
  // Round to a micro-dollar fraction so sums stay stable in storage.
  return Math.round((cost / PER_MILLION) * 1e10) / 1e10;
}
