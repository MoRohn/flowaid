/**
 * The AI builder's answer as the `AIBuilderPanel` plan (P6-02): the generated definition's
 * decisions, steps, tools, approval gates and graph, read with the catalog's manifests.
 */
import type { BuilderPlan, BuilderPlanDecision } from "@flowaid/ui/builder";
import type { Diagnostic, NodeManifest, WorkflowDefinition } from "@flowaid/workflow-core";
import { Catalog, categoryOf } from "./model";

export interface GeneratedWorkflow {
  definition: WorkflowDefinition | null;
  diagnostics: Diagnostic[];
  rationale: string;
  iterations: number;
  model: { provider: string; model: string };
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
}

const DECISION_KINDS = ["boolean", "choice", "score"] as const;

function decisionOf(
  node: WorkflowDefinition["nodes"][number],
  manifest: NodeManifest | undefined,
): BuilderPlanDecision | null {
  if (node.kind !== "task" || manifest?.metadata.category !== "decision") return null;
  const kind = DECISION_KINDS.find((k) => node.type.endsWith(`.${k}`));
  if (!kind) return null;
  const config = node.config as { instructions?: unknown; options?: unknown; levels?: unknown };
  const options = Array.isArray(config.options)
    ? config.options.map((o) =>
        typeof o === "string" ? o : (((o as { id?: unknown }).id as string | undefined) ?? ""),
      )
    : Array.isArray(config.levels)
      ? config.levels.map(String)
      : undefined;
  return {
    id: node.id,
    kind,
    question: typeof config.instructions === "string" ? config.instructions : node.name,
    ...(options?.length ? { options } : {}),
  };
}

export function planFromGenerated(
  out: GeneratedWorkflow,
  manifests: readonly NodeManifest[],
): BuilderPlan {
  const def = out.definition;
  if (!def) return { outcome: out.rationale };
  const catalog = new Catalog(manifests);
  const errors = out.diagnostics.filter((d) => d.severity === "error").length;
  const nodes = def.nodes.filter((n) => n.kind !== "input" && n.kind !== "output");
  const decisions = nodes.flatMap((n) => {
    const d = decisionOf(n, n.kind === "task" ? catalog.get(n.type, n.typeVersion) : undefined);
    return d ? [d] : [];
  });
  const tools = nodes.flatMap((n) => {
    if (n.kind !== "task") return [];
    const category = categoryOf(n, catalog);
    if (category !== "tool" && category !== "retrieval") return [];
    return [{ id: n.id, name: n.name, kind: category === "tool" ? "Tool" : "Retrieval" }];
  });
  const gates = def.nodes.filter((n) => n.kind === "human").map((n) => n.name);
  return {
    outcome:
      errors > 0
        ? `${out.rationale} (${errors} compiler error${errors > 1 ? "s" : ""} left to fix in the builder)`
        : out.rationale,
    decisions,
    steps: nodes.map((n) => n.name),
    tools,
    approvalGates: gates,
    dataRequirements: Object.keys(
      (def.inputs as { properties?: Record<string, unknown> }).properties ?? {},
    ),
    workflow: {
      nodes: def.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.kind === "task" ? n.type : n.kind,
        category: categoryOf(n, catalog),
      })),
      edges: def.edges.map((e) => ({ source: e.from.node, target: e.to.node })),
    },
  };
}
