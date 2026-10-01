/**
 * Active agents (Agents page) as entries of the Add node palette (pure, so it is unit tested).
 * Picking one adds an Agent step that points at that agent and carries nothing else but the step
 * bound the compiler requires, so the agent's own model, instructions, tools and limits apply and
 * later edits to the agent reach every step that uses it.
 */
import type { WorkflowDefinition, WorkflowNode } from "@flowaid/workflow-core";
import type { AgentPreset } from "~/agents/logic";
import { modelLabel } from "~/agents/logic";
import { newNode, type Catalog } from "./model";

export const AGENT_NODE_TYPE = "flowaid.ai.agent";
const PREFIX = "agent-preset:";
/** The step bound used when the agent sets none (the Agent node's own default). */
const DEFAULT_MAX_STEPS = 8;

/** The palette entry id of an agent. */
export const agentPresetKind = (id: string) => `${PREFIX}${id}`;

/** The agent id of a palette entry, or undefined for any other entry. */
export const presetIdOf = (kind: string) =>
  kind.startsWith(PREFIX) ? kind.slice(PREFIX.length) : undefined;

/** "Answers order questions · claude-sonnet-5 · 2 tools" */
export function agentPaletteDescription(a: AgentPreset): string {
  const tools = Array.isArray(a.config.tools) ? a.config.tools.length : 0;
  return [
    a.description.trim() || "Your agent",
    modelLabel(a.config.model),
    tools ? `${tools} ${tools === 1 ? "tool" : "tools"}` : "no tools",
  ].join(" · ");
}

/** An Agent step that uses the agent, named after it. */
export function agentStepFor(
  def: WorkflowDefinition,
  a: AgentPreset,
  catalog: Catalog,
  parent?: string,
): WorkflowNode | null {
  const steps = typeof a.config.maxSteps === "number" ? a.config.maxSteps : DEFAULT_MAX_STEPS;
  const node = newNode(
    def,
    AGENT_NODE_TYPE,
    catalog,
    () => ({ agentId: a.id, maxSteps: steps }),
    parent,
  );
  return node ? { ...node, name: a.name } : null;
}
