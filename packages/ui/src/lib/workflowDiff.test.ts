import { describe, expect, it } from "vitest";
import type { WorkflowDiff } from "@/types";
import {
  WORKFLOW_DIFF_SECTIONS,
  emptyWorkflowDiff,
  isEmptyWorkflowDiff,
  patchPaths,
  workflowDiffCounts,
  workflowNodeChanges,
} from "./workflowDiff";

const DIFF: WorkflowDiff = {
  nodes: {
    added: ["n5"],
    removed: ["n3"],
    changed: [
      {
        id: "n1",
        patch: [
          { op: "replace", path: "/config/threshold", value: 0.9 },
          { op: "replace", path: "/config/threshold", value: 0.95 },
          { op: "add", path: "/config/reviewBand", value: 0.2 },
        ],
      },
    ],
  },
  edges: { added: ["e9"], removed: ["e2", "e3"] },
  inputs: [],
  outputs: [{ op: "add", path: "/properties/summary", value: { type: "string" } }],
  variables: [],
  secrets: [],
  execution: [{ op: "replace", path: "/timeoutMs", value: 1000 }],
  layoutOnly: false,
};

describe("workflowDiff helpers", () => {
  it("orders node rows changed → removed → added with distinct patch paths", () => {
    expect(workflowNodeChanges(DIFF)).toEqual([
      { nodeId: "n1", kind: "changed", paths: ["/config/threshold", "/config/reviewBand"] },
      { nodeId: "n3", kind: "removed", paths: [] },
      { nodeId: "n5", kind: "added", paths: [] },
    ]);
    expect(patchPaths([])).toEqual([]);
  });

  it("counts nodes, edges and section ops", () => {
    expect(workflowDiffCounts(DIFF)).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      edgesAdded: 1,
      edgesRemoved: 2,
      sectionOps: 2,
      total: 8,
    });
    expect(WORKFLOW_DIFF_SECTIONS).toEqual([
      "inputs",
      "outputs",
      "variables",
      "secrets",
      "execution",
    ]);
  });

  it("recognises an empty diff and a layout-only diff", () => {
    expect(isEmptyWorkflowDiff(emptyWorkflowDiff())).toBe(true);
    expect(emptyWorkflowDiff(true).layoutOnly).toBe(true);
    expect(isEmptyWorkflowDiff(emptyWorkflowDiff(true))).toBe(true);
    expect(isEmptyWorkflowDiff(DIFF)).toBe(false);
  });
});
