/**
 * Read-only helpers over a compiler `WorkflowDiff` (ARCHITECTURE.md §4.7)
 * for the inspector and builder views.
 */
import type { JsonPatch, WorkflowDiff } from "@/types";

export type WorkflowDiffSection = "inputs" | "outputs" | "variables" | "secrets" | "execution";

export const WORKFLOW_DIFF_SECTIONS: readonly WorkflowDiffSection[] = [
  "inputs",
  "outputs",
  "variables",
  "secrets",
  "execution",
];

export const WORKFLOW_DIFF_SECTION_LABEL: Record<WorkflowDiffSection, string> = {
  inputs: "Inputs",
  outputs: "Outputs",
  variables: "Variables",
  secrets: "Secrets",
  execution: "Execution",
};

export type WorkflowNodeChangeKind = "added" | "removed" | "changed";

/** One node-level row of a diff. `paths` are the patch paths inside the node (empty for added/removed). */
export interface WorkflowNodeChange {
  nodeId: string;
  kind: WorkflowNodeChangeKind;
  paths: string[];
}

export interface WorkflowDiffCounts {
  added: number;
  removed: number;
  changed: number;
  edgesAdded: number;
  edgesRemoved: number;
  /** Patch ops across the non-node sections. */
  sectionOps: number;
  total: number;
}

/** Node rows in a stable order: changed (by id), then removed, then added. */
export function workflowNodeChanges(diff: WorkflowDiff): WorkflowNodeChange[] {
  const out: WorkflowNodeChange[] = [];
  for (const c of diff.nodes.changed)
    out.push({ nodeId: c.id, kind: "changed", paths: patchPaths(c.patch) });
  for (const id of diff.nodes.removed) out.push({ nodeId: id, kind: "removed", paths: [] });
  for (const id of diff.nodes.added) out.push({ nodeId: id, kind: "added", paths: [] });
  return out;
}

/** Distinct patch paths, in order of first appearance. */
export function patchPaths(patch: JsonPatch): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const op of patch) {
    if (seen.has(op.path)) continue;
    seen.add(op.path);
    out.push(op.path);
  }
  return out;
}

export function workflowDiffCounts(diff: WorkflowDiff): WorkflowDiffCounts {
  const sectionOps = WORKFLOW_DIFF_SECTIONS.reduce((n, s) => n + diff[s].length, 0);
  const added = diff.nodes.added.length;
  const removed = diff.nodes.removed.length;
  const changed = diff.nodes.changed.length;
  const edgesAdded = diff.edges.added.length;
  const edgesRemoved = diff.edges.removed.length;
  return {
    added,
    removed,
    changed,
    edgesAdded,
    edgesRemoved,
    sectionOps,
    total: added + removed + changed + edgesAdded + edgesRemoved + sectionOps,
  };
}

/** True when nothing but layout differs. */
export function isEmptyWorkflowDiff(diff: WorkflowDiff): boolean {
  return workflowDiffCounts(diff).total === 0;
}

/** An empty diff, for galleries and defaults. */
export function emptyWorkflowDiff(layoutOnly = false): WorkflowDiff {
  return {
    nodes: { added: [], removed: [], changed: [] },
    edges: { added: [], removed: [] },
    inputs: [],
    outputs: [],
    variables: [],
    secrets: [],
    execution: [],
    layoutOnly,
  };
}
