/**
 * The advisor's vocabulary: optimizer suggestions, critic advice and the statistics the optimizer
 * reads. Every automatic change is an RFC 6902 patch against the workflow definition, so a client
 * can apply it as one undoable edit and the server can check it before anyone accepts it.
 */
import type { JsonPatch, ModelRef, NodeManifest } from "@flowaid/workflow-core";

export type SuggestionKind =
  "cheaper_model" | "batch_decisions" | "cache_safe_node" | "tighten_bounds";
export type Risk = "low" | "medium" | "high";

/** One cost suggestion (`optimize`). `fix` is empty when the change must be made by hand. */
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  nodeIds: string[];
  title: string;
  rationale: string;
  /** Estimated saving per run in USD (0 when the change caps a worst case rather than the average). */
  estimatedSavingsUsdPerRun: number;
  /** Average cost of the affected nodes per run today, USD. */
  currentCostUsdPerRun: number;
  /** Estimated change in latency per run, ms (negative is faster). */
  latencyDeltaMs: number;
  risk: Risk;
  /** What the change does to answer quality, in words. */
  qualityImpact: string;
  fix: JsonPatch;
}

/** 30-day aggregates of one node's runs (`node_runs`, completed attempts only). */
export interface NodeStats {
  nodeId: string;
  runs: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  /** distinct input hashes among `runs` (repeat rate = 1 − distinct / runs) */
  distinctInputs: number;
  /** loop / foreach containers: iterations per run */
  iterations?: { p95: number; max: number };
}

/** What the optimizer needs from the model catalog. */
export interface PriceCatalog {
  list(filter?: { provider?: string; kind?: "decision" | "chat" | "embedding" | "rerank" }): {
    provider: string;
    model: string;
    kind: string;
    deprecated?: string;
    pricing?: { inputPerMTok: number; outputPerMTok: number };
    capabilities: Record<string, boolean>;
  }[];
  resolveAlias(provider: string, model: string): string;
}

/** The evaluation report the optimizer weighs risk with (the latest run of the linked set). */
export interface EvalSignal {
  passRate: number;
  cases: number;
}

/** Looks a node type up in the catalog the definition compiles against. */
export type ManifestLookup = (type: string, version?: string) => NodeManifest | undefined;

export type AdviceSeverity = "error" | "warning" | "suggestion";
export type AdviceCategory =
  "cost" | "safety" | "reliability" | "correctness" | "performance" | "style";

/** One critic finding (`critique`): a rubric rule or the judge. */
export interface Advice {
  id: string;
  /** rubric rule id, or `judge` */
  rule: string;
  source: "rubric" | "judge";
  severity: AdviceSeverity;
  category: AdviceCategory;
  title: string;
  detail: string;
  nodeIds: string[];
  fix?: { title: string; patch: JsonPatch };
}

/** A model the advisor generates with. */
export type AdvisorModel = ModelRef;
