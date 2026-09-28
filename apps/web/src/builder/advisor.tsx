/**
 * The builder's advisor tabs (P6-02): Review (the critic) and Cost (the optimizer). Both run on
 * request against the current draft. Fixes are RFC 6902 patches against the definition they were
 * computed for, so applying one first re-asks the server when the draft has changed since, then
 * applies it through the store as one undoable edit.
 */
import { useCallback, useState } from "react";
import type { Diagnostic, JsonPatch, WorkflowDefinition } from "@flowaid/workflow-core";
import type { CriticFindingView } from "@flowaid/ui";
import {
  CostOptimizerPanel,
  WorkflowCriticPanel,
  type CostOptimizationKind,
  type CostOptimizationView,
} from "@flowaid/ui/builder";
import { Button, EmptyState, toast } from "@flowaid/ui/primitives";
import { ApiError, post } from "~/api/client";
import { FixPreview } from "./FixPreview";
import { categoryOf, type Catalog } from "./model";
import type { BuilderStore } from "./store";

export interface Advice {
  id: string;
  rule: string;
  source: "rubric" | "judge";
  severity: CriticFindingView["severity"];
  category: CriticFindingView["category"];
  title: string;
  detail: string;
  nodeIds: string[];
  fix?: { title: string; patch: JsonPatch };
}

export interface Suggestion {
  id: string;
  kind: "cheaper_model" | "batch_decisions" | "cache_safe_node" | "tighten_bounds";
  nodeIds: string[];
  title: string;
  rationale: string;
  estimatedSavingsUsdPerRun: number;
  currentCostUsdPerRun: number;
  latencyDeltaMs: number;
  risk: "low" | "medium" | "high";
  qualityImpact: string;
  fix: JsonPatch;
}

interface Critique {
  advice: Advice[];
  checks: string[];
  reviewedAt: string;
}

interface Optimization {
  suggestions: Suggestion[];
  diagnostics: Diagnostic[];
  window: { days: number; from: string; runs: number };
}

/** A server answer and the store version it was computed for. */
interface Fetched<T> {
  version: number;
  data: T;
}

const KIND: Record<Suggestion["kind"], CostOptimizationKind> = {
  cheaper_model: "model",
  batch_decisions: "batch",
  cache_safe_node: "cache",
  tighten_bounds: "rule",
};

export function toFindingView(a: Advice): CriticFindingView {
  return {
    id: a.id,
    severity: a.severity,
    category: a.category,
    title: a.title,
    detail: a.detail,
    nodeIds: a.nodeIds,
    fixAvailable: a.fix !== undefined && a.fix.patch.length > 0,
    ...(a.fix?.title ? { fixTitle: a.fix.title } : {}),
    // a rubric finding is a deterministic rule; the judge is a model's opinion
    source: a.source === "judge" ? "judge" : "rule",
  };
}

export function toCostView(
  s: Suggestion,
  definition: WorkflowDefinition,
  catalog: Catalog,
): CostOptimizationView {
  const node = definition.nodes.find((n) => n.id === s.nodeIds[0]);
  const after = Math.max(0, s.currentCostUsdPerRun - s.estimatedSavingsUsdPerRun);
  return {
    id: s.id,
    title: s.title,
    rationale: s.fix.length ? s.rationale : `${s.rationale} (a manual change)`,
    kind: KIND[s.kind],
    nodeId: s.nodeIds[0] ?? "",
    nodeName:
      s.nodeIds.length > 1
        ? `${node?.name ?? s.nodeIds[0]} +${s.nodeIds.length - 1}`
        : (node?.name ?? s.nodeIds[0] ?? ""),
    nodeCategory: node ? categoryOf(node, catalog) : "flow",
    beforeCostPer1k: s.currentCostUsdPerRun * 1000,
    afterCostPer1k: after * 1000,
    latencyDeltaMs: s.latencyDeltaMs,
    confidenceImpact: `${s.qualityImpact} Risk: ${s.risk}.`,
  };
}

/**
 * Which advisor surfaces show: the critic and optimizer with `features.advisor`, the AI builder
 * with `features.ai_builder` (the workspace has a generation model) for people who can create.
 */
export function advisorAvailability(
  features: Record<string, boolean>,
  canWrite: boolean,
): { advisor: boolean; aiBuilder: boolean } {
  return {
    advisor: features.advisor === true,
    aiBuilder: features.ai_builder === true && canWrite,
  };
}

const message = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback;

/** Critic and optimizer state for one builder, with fresh-before-apply fixes. */
export function useAdvisor(o: { workflowId: string; store: BuilderStore; enabled: boolean }) {
  const { workflowId, store, enabled } = o;
  const [review, setReview] = useState<Fetched<Critique> | null>(null);
  const [cost, setCost] = useState<Fetched<Optimization> | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [applying, setApplying] = useState(false);

  const fetchReview = useCallback(async (): Promise<Fetched<Critique>> => {
    const { definition, version } = store.getState();
    const data = await post<Critique>(`/v1/workflows/${workflowId}/ai/critique`, {
      definition,
      judge: false,
    });
    const out = { version, data };
    setReview(out);
    return out;
  }, [store, workflowId]);

  const fetchCost = useCallback(async (): Promise<Fetched<Optimization>> => {
    const { definition, version } = store.getState();
    const data = await post<Optimization>(`/v1/workflows/${workflowId}/optimize`, {
      definition,
    });
    const out = { version, data };
    setCost(out);
    return out;
  }, [store, workflowId]);

  const runReview = useCallback(() => {
    if (!enabled) return;
    setReviewing(true);
    fetchReview()
      .catch((e: unknown) => toast.error(message(e, "The review failed")))
      .finally(() => setReviewing(false));
  }, [enabled, fetchReview]);

  const runCost = useCallback(() => {
    if (!enabled) return;
    setOptimizing(true);
    fetchCost()
      .catch((e: unknown) => toast.error(message(e, "Could not compute cost suggestions")))
      .finally(() => setOptimizing(false));
  }, [enabled, fetchCost]);

  /** Applies a critic fix, re-reviewing first when the draft changed since the review. */
  const applyAdvice = useCallback(
    async (id: string) => {
      setApplying(true);
      try {
        const current = store.getState().version;
        const r = review?.version === current ? review : await fetchReview();
        const advice = r.data.advice.find((a) => a.id === id);
        if (!advice?.fix?.patch.length) {
          toast("That finding no longer applies to the draft.");
          return;
        }
        if (store.getState().applyPatch(advice.fix.patch, advice.fix.title)) await fetchReview();
      } catch (e) {
        toast.error(message(e, "Could not apply the fix"));
      } finally {
        setApplying(false);
      }
    },
    [fetchReview, review, store],
  );

  /** Applies the chosen suggestions one at a time; each is its own undoable edit. */
  const applySuggestions = useCallback(
    async (ids: readonly string[]) => {
      setApplying(true);
      let applied = 0;
      const manual: string[] = [];
      try {
        for (const id of ids) {
          const current = store.getState().version;
          const r = cost?.version === current && applied === 0 ? cost : await fetchCost();
          const s = r.data.suggestions.find((x) => x.id === id);
          if (!s) continue;
          if (!s.fix.length) {
            manual.push(s.title);
            continue;
          }
          if (!store.getState().applyPatch(s.fix, s.title)) break;
          applied += 1;
        }
        if (applied) {
          toast(`Applied ${applied} suggestion${applied > 1 ? "s" : ""}. Undo reverts each one.`);
          await fetchCost();
        }
        if (manual.length) toast(`Make by hand: ${manual.join("; ")}`);
      } catch (e) {
        toast.error(message(e, "Could not apply the suggestions"));
      } finally {
        setApplying(false);
      }
    },
    [cost, fetchCost, store],
  );

  /**
   * Applies a Problems-panel quick fix (compiler or `I_COST_SUGGESTION`). A fix without a patch
   * ("Choose the resource") is a choice only the author can make: it opens the node instead.
   */
  const applyDiagnosticFix = useCallback(
    (d: Diagnostic) => {
      if (!d.fix) return;
      if (!d.fix.patch.length) {
        const nodeId = d.location.nodeId;
        if (nodeId) store.getState().select({ nodes: [nodeId], edges: [] });
        return;
      }
      if (d.code === "I_COST_SUGGESTION") {
        const s = cost?.data.suggestions.find((x) => x.title === d.fix?.title);
        if (s) {
          void applySuggestions([s.id]);
          return;
        }
      }
      store.getState().applyPatch(d.fix.patch, d.fix.title);
    },
    [applySuggestions, cost, store],
  );

  return {
    review,
    cost,
    reviewing,
    optimizing,
    applying,
    runReview,
    runCost,
    applyAdvice,
    applySuggestions,
    applyDiagnosticFix,
  };
}

export type AdvisorState = ReturnType<typeof useAdvisor>;

/** Cost diagnostics for the Problems panel: only while they describe the current draft. */
export function costDiagnostics(advisor: AdvisorState, version: number): Diagnostic[] {
  return advisor.cost?.version === version ? advisor.cost.data.diagnostics : [];
}

export function ReviewTab({
  advisor,
  definition,
  onFocusNode,
}: {
  advisor: AdvisorState;
  definition: WorkflowDefinition;
  onFocusNode: (id: string) => void;
}) {
  const { review } = advisor;
  if (!review && !advisor.reviewing)
    return (
      <div className="p-3">
        <EmptyState
          size="sm"
          title="Not reviewed yet"
          description="Check the draft for unbounded loops, unguarded irreversible steps, personal data in prompts, and missing evaluations, failover or cost bounds."
          primaryAction={
            <Button size="sm" onClick={advisor.runReview}>
              Review the draft
            </Button>
          }
        />
      </div>
    );
  return (
    <WorkflowCriticPanel
      flush
      className="h-full"
      findings={review?.data.advice.map(toFindingView) ?? []}
      checks={review?.data.checks ?? []}
      reviewing={advisor.reviewing || advisor.applying}
      {...(review ? { reviewedAt: new Date(review.data.reviewedAt).toLocaleTimeString() } : {})}
      nodeName={(id) => definition.nodes.find((n) => n.id === id)?.name ?? id}
      onFocusNode={onFocusNode}
      onApplyFix={(f) => void advisor.applyAdvice(f.id)}
      renderFixPreview={(f) => {
        const fix = review?.data.advice.find((a) => a.id === f.id)?.fix;
        return fix ? <FixPreview patch={fix.patch} definition={definition} /> : null;
      }}
      onRerun={advisor.runReview}
    />
  );
}

export function CostTab({
  advisor,
  definition,
  catalog,
}: {
  advisor: AdvisorState;
  definition: WorkflowDefinition;
  catalog: Catalog;
}) {
  const { cost } = advisor;
  if (!cost && advisor.optimizing)
    return (
      <div className="p-3">
        <EmptyState size="sm" title="Looking at the last 30 days of runs…" />
      </div>
    );
  if (!cost)
    return (
      <div className="p-3">
        <EmptyState
          size="sm"
          title="No suggestions yet"
          description="Look at the last 30 days of runs for cheaper models, decisions to batch, cacheable steps and loose loop bounds."
          primaryAction={
            <Button size="sm" onClick={advisor.runCost}>
              Find savings
            </Button>
          }
        />
      </div>
    );
  if (cost && cost.data.suggestions.length === 0)
    return (
      <div className="p-3">
        <EmptyState
          size="sm"
          title="Nothing to suggest"
          description={
            cost.data.window.runs < 20
              ? `Suggestions need at least 20 runs in the last ${cost.data.window.days} days; this workflow has ${cost.data.window.runs}.`
              : "The draft already uses the cheapest options the runs support."
          }
          primaryAction={
            <Button size="sm" onClick={advisor.runCost}>
              Check again
            </Button>
          }
        />
      </div>
    );
  return (
    <CostOptimizerPanel
      // a new set of suggestions starts with all of them selected
      key={cost.data.suggestions.map((s) => s.id).join(" ")}
      flush
      className="h-full"
      items={cost.data.suggestions.map((s) => toCostView(s, definition, catalog))}
      applying={advisor.applying || advisor.optimizing}
      onApply={(ids) => void advisor.applySuggestions(ids)}
    />
  );
}
