/**
 * The critic's rubric (UPGRADE_PLAN P6-02): deterministic rules over a workflow and its plan.
 * Each rule explains what it found in terms of the workflow's own nodes and, when the remedy is
 * mechanical, carries a fix as an RFC 6902 patch against the definition.
 */
import { jsonPatch } from "@flowaid/workflow-compiler";
import type {
  Diagnostic,
  ExecutionPlan,
  JsonSchema,
  NodeManifest,
  WorkflowDefinition,
  WorkflowNode,
} from "@flowaid/workflow-core";
import type { Advice, ManifestLookup } from "./types.js";

export interface CritiqueInput {
  definition: WorkflowDefinition;
  /** null when the definition does not compile; plan-based rules are skipped */
  plan: ExecutionPlan | null;
  diagnostics: readonly Diagnostic[];
  manifests: ManifestLookup;
  workflow: { evaluationSetId: string | null };
  /** the workspace's decision chain, used when the definition sets none */
  defaultFailover?: readonly unknown[];
  /** the workspace budget and how often the workflow runs */
  budget?: { monthlyCostUsd: number; runsPerMonth: number } | null;
  /** a per-run bound derived from observed costs, offered as the fix for an unbounded workflow */
  suggestedMaxCostUsd?: number | null;
}

export interface RubricRule {
  id: string;
  /** what the rule checks, in a sentence (shown as the critic's checklist) */
  check: string;
  run(input: CritiqueInput): Advice[];
}

const GENERATION_CATEGORIES = new Set(["generation", "agent"]);

function manifestOf(input: CritiqueInput, node: WorkflowNode): NodeManifest | undefined {
  return node.kind === "task" ? input.manifests(node.type, node.typeVersion) : undefined;
}

function generates(input: CritiqueInput, node: WorkflowNode): boolean {
  const m = manifestOf(input, node);
  return m !== undefined && (m.generation || GENERATION_CATEGORIES.has(m.metadata.category));
}

function isDecision(input: CritiqueInput, node: WorkflowNode): boolean {
  const kind = manifestOf(input, node)?.decision?.kind;
  return kind !== undefined && kind !== "gate";
}

function isGate(input: CritiqueInput, node: WorkflowNode): boolean {
  return node.kind === "human" || manifestOf(input, node)?.decision?.kind === "gate";
}

function clone(def: WorkflowDefinition): WorkflowDefinition {
  return JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
}

function ancestors(plan: ExecutionPlan, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const dep of plan.nodes[cur]?.controlIn ?? [])
      if (!seen.has(dep.from.node)) {
        seen.add(dep.from.node);
        stack.push(dep.from.node);
      }
  }
  return seen;
}

/** The containers a node sits in, innermost first. */
function containersOf(def: WorkflowDefinition, node: WorkflowNode): WorkflowNode[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const out: WorkflowNode[] = [];
  let parent = node.parent ? byId.get(node.parent) : undefined;
  while (parent) {
    out.push(parent);
    parent = parent.parent ? byId.get(parent.parent) : undefined;
  }
  return out;
}

const PII_NAME =
  /(^|_)(e_?mail|phone|mobile|ssn|social_security|passport|address|street|postcode|zip|dob|birth(date|day)?|full_name|first_name|last_name|surname|card(_number)?|iban|account_number|tax_id)($|_)/i;

/** Workflow inputs that carry personal data: flagged `x-flowaid.dataClass: pii`, `format: email`, or named like it. */
export function piiInputs(schema: JsonSchema): Set<string> {
  const props = ((schema as { properties?: Record<string, JsonSchema> }).properties ??
    {}) as Record<string, { format?: string; "x-flowaid"?: { dataClass?: string } }>;
  const out = new Set<string>();
  for (const [name, s] of Object.entries(props))
    if (s["x-flowaid"]?.dataClass === "pii" || s.format === "email" || PII_NAME.test(name))
      out.add(name);
  return out;
}

export const RUBRIC: readonly RubricRule[] = [
  {
    id: "unbounded_generation_loop",
    check: "Loops and for-each containers that generate text have a cost or token bound.",
    run(input) {
      const out: Advice[] = [];
      const def = input.definition;
      for (const container of def.nodes) {
        if (container.kind !== "loop" && container.kind !== "foreach") continue;
        if (container.bounds.maxCostUsd !== undefined || container.bounds.maxTokens !== undefined)
          continue;
        const inside = def.nodes.filter(
          (n) => generates(input, n) && containersOf(def, n).some((c) => c.id === container.id),
        );
        if (inside.length === 0) continue;
        const next = clone(def);
        const target = next.nodes.find((n) => n.id === container.id);
        if (target?.kind !== "loop" && target?.kind !== "foreach") continue;
        const bound = Math.min(def.execution.maxCostUsd ?? 1, 1);
        target.bounds = { ...target.bounds, maxCostUsd: bound };
        out.push({
          id: `unbounded_generation_loop:${container.id}`,
          rule: "unbounded_generation_loop",
          source: "rubric",
          severity: "warning",
          category: "cost",
          title: `“${container.name}” can spend without limit`,
          detail: `It runs ${inside.map((n) => `“${n.name}”`).join(", ")} on every iteration and bounds only the iteration count. Add a cost or token bound so a runaway run stops.`,
          nodeIds: [container.id, ...inside.map((n) => n.id)],
          fix: {
            title: `Bound “${container.name}” at $${bound} per run`,
            patch: jsonPatch(def, next),
          },
        });
      }
      return out;
    },
  },
  {
    id: "irreversible_after_decision",
    check:
      "Irreversible tool calls that follow a model decision pass a human approval or a confidence gate first.",
    run(input) {
      const { plan, definition: def } = input;
      if (!plan) return [];
      const byId = new Map(def.nodes.map((n) => [n.id, n]));
      const out: Advice[] = [];
      for (const node of def.nodes) {
        if (node.kind !== "task" || plan.nodes[node.id]?.idempotency !== "none") continue;
        if (manifestOf(input, node)?.metadata.category !== "tool") continue;
        const before = ancestors(plan, node.id);
        for (const id of before) {
          const decision = byId.get(id);
          if (!decision || !isDecision(input, decision)) continue;
          const gated = [...before].some((g) => {
            const gate = byId.get(g);
            return gate !== undefined && isGate(input, gate) && ancestors(plan, g).has(id);
          });
          if (gated) continue;
          out.push({
            id: `irreversible_after_decision:${node.id}:${id}`,
            rule: "irreversible_after_decision",
            source: "rubric",
            severity: "error",
            category: "safety",
            title: `“${node.name}” acts on “${decision.name}” without a check`,
            detail: `“${node.name}” has side effects that cannot be undone, and it runs on the answer of “${decision.name}” with no human approval or confidence gate in between. Add a confidence gate (low-confidence answers go to a person) or an approval before it.`,
            nodeIds: [id, node.id],
          });
          break;
        }
      }
      return out;
    },
  },
  {
    id: "pii_into_prompt",
    check: "Personal data from the workflow input reaches a prompt only with redaction configured.",
    run(input) {
      const { plan, definition: def } = input;
      if (!plan) return [];
      const inputNode = def.nodes.find((n) => n.kind === "input");
      if (!inputNode) return [];
      const pii = piiInputs(def.inputs);
      if (pii.size === 0 || def.execution.privacy.redactFields.length > 0) return [];
      const byId = new Map(def.nodes.map((n) => [n.id, n]));
      const hits = new Map<string, { fields: Set<string>; ports: Set<string> }>();
      for (const edge of plan.dataEdges) {
        if (edge.from.node !== inputNode.id || !pii.has(edge.from.port)) continue;
        const target = byId.get(edge.to.node);
        if (!target || !generates(input, target)) continue;
        if ((target.policy?.privacy?.redactFields.length ?? 0) > 0) continue;
        const hit = hits.get(target.id) ?? { fields: new Set(), ports: new Set() };
        hit.fields.add(edge.from.port);
        hit.ports.add(edge.to.port);
        hits.set(target.id, hit);
      }
      return [...hits].map(([id, hit]) => {
        const node = byId.get(id) as WorkflowNode;
        const next = clone(def);
        const target = next.nodes.find((n) => n.id === id) as WorkflowNode;
        const privacy = target.policy?.privacy;
        target.policy = {
          ...(target.policy ?? { onError: "fail" }),
          privacy: {
            sensitive: privacy?.sensitive ?? false,
            doNotPersist: privacy?.doNotPersist ?? false,
            containsPII: true,
            redactFields: [...hit.ports].map((p) => `/${p}`),
          },
        };
        return {
          id: `pii_into_prompt:${id}`,
          rule: "pii_into_prompt",
          source: "rubric",
          severity: "warning",
          category: "safety",
          title: `Personal data reaches “${node.name}”'s prompt`,
          detail: `${[...hit.fields].map((f) => `\`${f}\``).join(", ")} from the workflow input flow into this model's prompt and are stored with the run as-is. Mark the node as handling personal data and redact the fields before they are persisted, or remove them from the prompt (a PII detector node can strip them).`,
          nodeIds: [id],
          fix: {
            title: `Redact ${[...hit.ports].join(", ")} on “${node.name}”`,
            patch: jsonPatch(def, next),
          },
        } satisfies Advice;
      });
    },
  },
  {
    id: "no_evaluation_set",
    check: "A workflow that makes model decisions or generates text has an evaluation set.",
    run(input) {
      if (input.workflow.evaluationSetId !== null) return [];
      const ai = input.definition.nodes.filter((n) => isDecision(input, n) || generates(input, n));
      if (ai.length === 0) return [];
      return [
        {
          id: "no_evaluation_set",
          rule: "no_evaluation_set",
          source: "rubric",
          severity: "suggestion",
          category: "reliability",
          title: "No evaluation set is linked",
          detail: `${ai.length} node${ai.length > 1 ? "s" : ""} rely on a model. Link an evaluation set in the workflow settings so every change is measured, and gate publishing on it.`,
          nodeIds: ai.map((n) => n.id),
        },
      ];
    },
  },
  {
    id: "no_failover",
    check: "Decisions have a failover hop when the primary provider is unavailable.",
    run(input) {
      const def = input.definition;
      const decisions = def.nodes.filter((n) => isDecision(input, n));
      if (decisions.length === 0) return [];
      const failover = def.execution.decisions.failover.length
        ? def.execution.decisions.failover
        : (input.defaultFailover ?? []);
      if (failover.length > 0) return [];
      const next = clone(def);
      next.execution = {
        ...next.execution,
        decisions: { ...next.execution.decisions, failover: [{ provider: "human" }] },
      };
      return [
        {
          id: "no_failover",
          rule: "no_failover",
          source: "rubric",
          severity: "warning",
          category: "reliability",
          title: "Decisions stop when the primary provider is down",
          detail: `${decisions.map((n) => `“${n.name}”`).join(", ")} use the ${def.execution.decisions.primary.provider} provider with no failover, so an outage fails the run. Add a failover hop; a person answering is the safest one.`,
          nodeIds: decisions.map((n) => n.id),
          fix: { title: "Fail over to a person", patch: jsonPatch(def, next) },
        },
      ];
    },
  },
  {
    id: "cost_over_budget",
    check: "The workflow has a cost bound, and its worst case fits the workspace budget.",
    run(input) {
      const def = input.definition;
      const out: Advice[] = [];
      if (input.diagnostics.some((d) => d.code === "W_COST_ESTIMATE")) {
        const bound = input.suggestedMaxCostUsd;
        let fix: Advice["fix"];
        if (bound !== undefined && bound !== null && bound > 0) {
          const next = clone(def);
          next.execution = { ...next.execution, maxCostUsd: bound };
          fix = { title: `Bound every run at $${bound}`, patch: jsonPatch(def, next) };
        }
        out.push({
          id: "cost_unbounded",
          rule: "cost_over_budget",
          source: "rubric",
          severity: "warning",
          category: "cost",
          title: "Runs have no cost ceiling",
          detail:
            "Nothing limits what one run can spend on models. Set a per-run bound (execution.maxCostUsd); the run fails instead of overspending.",
          nodeIds: [],
          ...(fix ? { fix } : {}),
        });
      }
      const worst = input.plan?.estimate.maxCostUsd;
      if (input.budget && worst !== null && worst !== undefined) {
        const monthly = worst * input.budget.runsPerMonth;
        if (monthly > input.budget.monthlyCostUsd)
          out.push({
            id: "cost_over_budget",
            rule: "cost_over_budget",
            source: "rubric",
            severity: "error",
            category: "cost",
            title: "The worst case exceeds the workspace budget",
            detail: `At ${input.budget.runsPerMonth} runs a month and up to $${worst} per run, this workflow could spend $${monthly.toFixed(2)} against a monthly budget of $${input.budget.monthlyCostUsd}. Lower the per-run bound or the models' cost.`,
            nodeIds: [],
          });
      }
      return out;
    },
  },
];
