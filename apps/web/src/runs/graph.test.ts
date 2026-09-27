import { describe, expect, it } from "vitest";
import type { ExecutionPlan, NodeManifest, WorkflowDefinition } from "@flowaid/workflow-core";
import { toEdgeViews, toNodeViews, toReadOnlyGraph } from "./graph";

const definition = {
  inputs: { type: "object", properties: { amount: { type: "number" } } },
  outputs: { type: "object" },
  nodes: [
    { id: "start", name: "Start", kind: "input" },
    {
      id: "draft",
      name: "Draft",
      kind: "task",
      type: "flowaid.data.template",
      typeVersion: "1.0.0",
      config: {},
      inputs: {},
    },
    { id: "approve", name: "Approve", kind: "human" },
    { id: "done", name: "Done", kind: "output" },
  ],
  edges: [
    { id: "e1", from: { node: "start", port: "done" }, to: { node: "draft" } },
    { id: "e2", from: { node: "approve", port: "approved" }, to: { node: "done" } },
  ],
} as unknown as WorkflowDefinition;

const plan = {
  nodes: {
    approve: {
      controlOut: ["approved", "rejected"],
      outputs: { decision: { type: "object" } },
      dataIn: [],
    },
    draft: { controlOut: ["done"], outputs: { text: { type: "string" } }, dataIn: [] },
  },
  dataEdges: [
    {
      from: { node: "draft", port: "text" },
      to: { node: "done", port: "value" },
      optional: false,
      via: "ref",
    },
  ],
} as unknown as ExecutionPlan;

const catalog = new Map([
  [
    "flowaid.data.template",
    {
      id: "flowaid.data.template",
      metadata: { category: "data" },
      inputs: [],
      outputs: [{ name: "text", schema: { type: "string" }, required: true }],
    } as unknown as NodeManifest,
  ],
]);

describe("read-only graph projection", () => {
  it("builds node views with categories, ports and control-outs", () => {
    const views = toNodeViews(definition, plan, catalog);
    const byId = Object.fromEntries(views.map((v) => [v.id, v]));
    expect(byId.start?.outputs.map((p) => p.id)).toEqual(["amount"]);
    expect(byId.draft).toMatchObject({ category: "data", nodeType: "flowaid.data.template" });
    expect(byId.draft?.outputs).toEqual([expect.objectContaining({ id: "text", type: "string" })]);
    expect(byId.approve).toMatchObject({ category: "human" });
    expect(byId.approve?.routes?.map((r) => r.id)).toEqual(["approved", "rejected"]);
    expect(byId.done?.inputs.map((p) => p.id)).toEqual(["value"]);
  });

  it("uses the UI.md §4.2 handle ids for control and data edges", () => {
    const edges = toEdgeViews(definition, plan);
    expect(edges[1]).toMatchObject({
      sourceHandle: "ctl:approved",
      targetHandle: "ctl-in",
      kind: "control",
    });
    expect(edges[2]).toMatchObject({
      id: "d:draft.text→done.value",
      sourceHandle: "out:text",
      targetHandle: "in:value",
      via: "ref",
    });
  });

  it("lays out nodes without saved positions and keeps saved ones", () => {
    const g = toReadOnlyGraph(
      { ...definition, layout: { nodes: { start: { x: 10, y: 20 } } } },
      plan,
      catalog,
    );
    expect(g.nodes).toHaveLength(4);
    expect(g.nodes.find((n) => n.id === "start")?.position).toEqual({ x: 10, y: 20 });
    expect(g.edges).toHaveLength(3);
  });
});
