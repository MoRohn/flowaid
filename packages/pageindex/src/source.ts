/**
 * A PageIndex source's configuration (docs/pageindex/API.md, "Sources") and the settings an index
 * records from it at request time. The API (uploads, index requests) and the worker (requests
 * from nodes, the indexing job) read sources through here, so both hash the same configuration.
 */
import { z } from "zod";
import { configHash, type IndexSettings } from "./capabilities.js";

export const PageIndexSourceConfigSchema = z.object({
  indexModel: z.object({
    provider: z.enum(["openai", "anthropic", "ollama"]),
    model: z.string().min(1).max(200),
  }),
  credentialId: z.uuid().nullable().default(null),
  mode: z.enum(["flash", "standard"]).default("flash"),
  /** tree post-processing; off unless the source asks for it */
  optimize: z.enum(["merge", "full", "off"]).default("off"),
});
export type PageIndexSourceConfig = z.infer<typeof PageIndexSourceConfigSchema>;

/** What an index row keeps in `settings`: the source's configuration when it was requested. */
export interface StoredIndexSettings extends IndexSettings {
  credentialId: string | null;
  /** how long one build may run before it fails (default 30 min) */
  timeoutMs?: number;
}

export const StoredIndexSettingsSchema = z.object({
  model: z.object({ provider: z.string(), model: z.string() }),
  mode: z.enum(["flash", "standard"]),
  optimize: z.enum(["merge", "full", "off"]),
  credentialId: z.string().nullable().default(null),
  timeoutMs: z.int().min(1).optional(),
});

/**
 * The settings, configuration hash and model name of an index requested under this source
 * configuration. Throws a descriptive `Error` when the configuration is not a PageIndex one.
 */
export function indexRequestFromSource(config: unknown): {
  settings: StoredIndexSettings;
  configHash: string;
  indexModel: string;
} {
  const parsed = PageIndexSourceConfigSchema.safeParse(config);
  if (!parsed.success)
    throw new Error(
      `the source's PageIndex configuration is invalid: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
        .join("; ")}`,
    );
  const c = parsed.data;
  const settings: StoredIndexSettings = {
    model: c.indexModel,
    mode: c.mode,
    optimize: c.optimize,
    credentialId: c.credentialId,
  };
  return {
    settings,
    configHash: configHash(settings),
    indexModel: `${c.indexModel.provider}/${c.indexModel.model}`,
  };
}
