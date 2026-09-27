/**
 * The AI critic (UPGRADE_PLAN P6-02): the rubric's deterministic findings, plus an optional judge
 * — one boolean decision through the workspace's decision chain on whether the workflow is safe
 * to run unattended — whose "no" becomes a finding with the judge's confidence.
 */
import type { BooleanDecision, WorkflowDefinition } from "@flowaid/workflow-core";
import { RUBRIC, type CritiqueInput } from "./rubric.js";
import type { Advice, AdviceSeverity, ManifestLookup } from "./types.js";

/** Asks one yes/no question about a state; the API wires it to a decision provider. */
export type Judge = (
  state: Record<string, unknown>,
  question: { instructions: string; criteria: { true: string; false: string } },
) => Promise<BooleanDecision>;

const SEVERITY_ORDER: Record<AdviceSeverity, number> = { error: 0, warning: 1, suggestion: 2 };

/** The rubric's checks, as the critic panel's checklist. */
export const CRITIC_CHECKS: readonly string[] = RUBRIC.map((r) => r.check);

/** A compact, model-readable summary of a workflow (what the judge sees). */
export function workflowSummary(
  def: WorkflowDefinition,
  manifests: ManifestLookup,
): Record<string, unknown> {
  return {
    name: def.name,
    description: def.description,
    inputs: Object.keys((def.inputs as { properties?: object }).properties ?? {}),
    nodes: def.nodes
      .filter((n) => n.kind !== "note")
      .map((n) => {
        const m = n.kind === "task" ? manifests(n.type, n.typeVersion) : undefined;
        return {
          id: n.id,
          name: n.name,
          kind: n.kind === "task" ? n.type : n.kind,
          ...(m ? { category: m.metadata.category } : {}),
          ...(n.kind === "task" && typeof n.config.instructions === "string"
            ? { question: n.config.instructions }
            : {}),
        };
      }),
    edges: def.edges.map((e) => `${e.from.node}.${e.from.port} -> ${e.to.node}`),
    costBoundUsd: def.execution.maxCostUsd ?? null,
    failover: def.execution.decisions.failover.map((h) => h.provider),
  };
}

export async function critique(input: CritiqueInput, judge?: Judge): Promise<Advice[]> {
  const out: Advice[] = RUBRIC.flatMap((rule) => rule.run(input));
  if (judge) {
    const decision = await judge(workflowSummary(input.definition, input.manifests), {
      instructions:
        "Is this workflow safe to run without a person watching it: are irreversible actions checked, are uncertain model answers routed to a person, and are costs bounded?",
      criteria: {
        true: "Safe to run unattended",
        false: "Needs changes before running unattended",
      },
    });
    if (decision.value === false)
      out.push({
        id: "judge",
        rule: "judge",
        source: "judge",
        severity: decision.confidence >= 0.8 ? "warning" : "suggestion",
        category: "safety",
        title: "The reviewer model would not run this unattended",
        detail: `${decision.provider} judged the workflow not safe to run unattended (confidence ${decision.confidence.toFixed(2)}). The rubric findings above are the usual reasons; look at irreversible steps, low-confidence routes and cost bounds.`,
        nodeIds: [],
      });
  }
  return out.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
}
