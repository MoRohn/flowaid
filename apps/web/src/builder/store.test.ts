import { describe, expect, it } from "vitest";
import type { NodeManifest, WorkflowDefinition, WorkflowNode } from "@flowaid/workflow-core";
import {
  Catalog,
  blankDefinition,
  bindingDataEdges,
  parseDataEdgeId,
  project,
  uniqueNodeId,
} from "./model";
import { createBuilderStore } from "./store";

const ID = "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09";

const TEMPLATE: NodeManifest = {
  id: "flowaid.data.template",
  version: "1.0.0",
  metadata: {
    name: "Template",
    description: "Renders text",
    category: "data",
    icon: "type",
    tags: [],
  },
  configSchema: { type: "object", properties: { template: { type: "string", default: "" } } },
  inputs: [{ name: "vars", schema: { type: "object" }, required: false }],
  outputs: [{ name: "text", schema: { type: "string" }, required: true }],
  controlPorts: [],
  portRules: [],
  credentials: [],
  capabilities: [],
  idempotency: { default: "safe" } as unknown as NodeManifest["idempotency"],
  pool: "general",
  generation: false,
  streams: false,
  optionProviders: [],
  migrations: [],
  defaultPolicy: {},
};
const catalog = new Catalog([TEMPLATE]);

function task(id: string, parent?: string): WorkflowNode {
  return {
    id,
    kind: "task",
    name: id,
    type: TEMPLATE.id,
    typeVersion: "1.0.0",
    config: {},
    inputs: {},
    credentials: {},
    disabled: false,
    ...(parent ? { parent } : {}),
  };
}

function loop(id: string): WorkflowNode {
  return {
    id,
    kind: "foreach",
    name: id,
    disabled: false,
    items: { kind: "literal", value: [] },
    concurrency: 4,
    failurePolicy: "fail_fast",
    bounds: { maxIterations: 10 },
  };
}

const fresh = (): WorkflowDefinition => blankDefinition(ID, "Test");

describe("builder store", () => {
  it("records inverse patches: undo and redo replay exact changes", () => {
    const s = createBuilderStore({ workflowId: ID, definition: fresh(), draftRevision: 1 });
    s.getState().addNode(task("t_1"), { x: 10, y: 20 });
    s.getState().renameNode("t_1", "Render");
    expect(s.getState().definition.nodes.find((n) => n.id === "t_1")?.name).toBe("Render");
    s.getState().undo();
    expect(s.getState().definition.nodes.find((n) => n.id === "t_1")?.name).toBe("t_1");
    s.getState().undo();
    expect(s.getState().definition.nodes.some((n) => n.id === "t_1")).toBe(false);
    s.getState().redo();
    s.getState().redo();
    expect(s.getState().definition.nodes.find((n) => n.id === "t_1")?.name).toBe("Render");
    expect(s.getState().definition.layout?.nodes.t_1).toEqual({ x: 10, y: 20 });
  });

  it("does not record layout-only moves", () => {
    const s = createBuilderStore({ workflowId: ID, definition: fresh(), draftRevision: 1 });
    s.getState().moveNodes({ start: { x: 5, y: 5 } });
    expect(s.getState().history.past).toHaveLength(0);
    expect(s.getState().definition.layout?.nodes.start).toEqual({ x: 5, y: 5 });
  });

  it("onConnect from out:* to in:* binds a port ref; deleting the edge unbinds it", () => {
    const s = createBuilderStore({ workflowId: ID, definition: fresh(), draftRevision: 1 });
    s.getState().addNode(task("t_1"), { x: 0, y: 100 });
    s.getState().setBinding("t_1", "vars", {
      kind: "ref",
      ref: { kind: "port", node: "start", port: "message" },
    });
    const t = s.getState().definition.nodes.find((n) => n.id === "t_1");
    expect(t?.kind === "task" && t.inputs.vars).toEqual({
      kind: "ref",
      ref: { kind: "port", node: "start", port: "message" },
    });
    const edges = bindingDataEdges(s.getState().definition);
    expect(edges.map((e) => `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`)).toContain(
      "start.message>t_1.vars",
    );
    s.getState().setBinding("t_1", "vars", undefined);
    const t2 = s.getState().definition.nodes.find((n) => n.id === "t_1");
    expect(t2?.kind === "task" && t2.inputs).toEqual({});
  });

  it("removing a node drops its edges and the bindings that used it, with a notice", () => {
    const s = createBuilderStore({ workflowId: ID, definition: fresh(), draftRevision: 1 });
    s.getState().removeNodes(["start"]);
    const d = s.getState().definition;
    expect(d.edges).toEqual([]);
    const end = d.nodes.find((n) => n.id === "end");
    expect(end?.kind === "output" && end.value).toEqual({ kind: "literal", value: null });
    expect(s.getState().notice?.message).toMatch(/End\.value/);
  });

  it("addControlEdge rejects edges that cross a container boundary (E_EDGE_CROSSES_SCOPE)", () => {
    const s = createBuilderStore({ workflowId: ID, definition: fresh(), draftRevision: 1 });
    s.getState().addNode(loop("each_1"), { x: 0, y: 0 });
    s.getState().addNode(task("inner", "each_1"), { x: 10, y: 10 });
    const r = s.getState().addControlEdge({ node: "start", port: "done" }, "inner");
    expect(r).toMatchObject({ ok: false, code: "E_EDGE_CROSSES_SCOPE" });
    expect(s.getState().addControlEdge({ node: "start", port: "done" }, "each_1")).toEqual({
      ok: true,
    });
  });

  it("setParent clears now-illegal control edges and says so", () => {
    const s = createBuilderStore({ workflowId: ID, definition: fresh(), draftRevision: 1 });
    s.getState().addNode(loop("each_1"), { x: 0, y: 0 });
    s.getState().addNode(task("t_1"), { x: 0, y: 0 });
    s.getState().addControlEdge({ node: "start", port: "done" }, "t_1");
    s.getState().setParent(["t_1"], "each_1", { t_1: { x: 16, y: 40 } });
    expect(s.getState().definition.edges.some((e) => e.to.node === "t_1")).toBe(false);
    expect(s.getState().notice?.message).toMatch(/crossed the container boundary/);
    expect(s.getState().definition.layout?.nodes.t_1).toEqual({ x: 16, y: 40 });
  });
});

describe("projection", () => {
  it("projects control edges from the definition and data edges from bindings without a plan", () => {
    const { nodes, edges } = project(fresh(), null, [], catalog);
    expect(nodes.map((n) => n.id)).toEqual(["start", "end"]);
    expect(nodes[0]?.outputs.map((p) => p.id)).toEqual(["message"]);
    expect(nodes[0]?.routes?.map((r) => r.id)).toEqual(["done"]);
    const control = edges.find((e) => e.kind === "control");
    expect(control).toMatchObject({ sourceHandle: "ctl:done", targetHandle: "ctl-in" });
    const data = edges.find((e) => e.kind === "data");
    expect(data).toMatchObject({
      sourceHandle: "out:message",
      targetHandle: "in:value",
      via: "ref",
    });
    expect(parseDataEdgeId(data?.id ?? "")).toEqual({ node: "end", port: "value" });
  });

  it("uses manifest ports and categories for task nodes and attaches diagnostics", () => {
    const def = fresh();
    def.nodes.push(task("t_1"));
    const { nodes } = project(
      def,
      null,
      [{ code: "E_SCHEMA", severity: "error", message: "bad", location: { nodeId: "t_1" } }],
      catalog,
    );
    const t = nodes.find((n) => n.id === "t_1");
    expect(t).toMatchObject({ category: "data", nodeType: TEMPLATE.id });
    expect(t?.inputs.map((p) => p.id)).toEqual(["vars"]);
    expect(t?.outputs.map((p) => [p.id, p.type])).toEqual([["text", "string"]]);
    expect(t?.diagnostics).toHaveLength(1);
  });

  it("generates unused snake_case ids", () => {
    const def = fresh();
    def.nodes.push(task("template_1"));
    expect(uniqueNodeId(def, "Template")).toBe("template_2");
    expect(uniqueNodeId(def, "9 HTTP call!")).toBe("http_call_1");
  });
});

describe("projection edge ids", () => {
  it("draws one data edge per port pair, preferring the ref binding", () => {
    const def = fresh();
    const plan = {
      nodes: {},
      dataEdges: [
        {
          from: { node: "start", port: "message" },
          to: { node: "end", port: "value" },
          optional: false,
          via: "template",
          path: "/a",
        },
        {
          from: { node: "start", port: "message" },
          to: { node: "end", port: "value" },
          optional: false,
          via: "ref",
        },
        {
          from: { node: "start", port: "message" },
          to: { node: "end", port: "value" },
          optional: false,
          via: "template",
          path: "/b",
        },
      ],
    } as unknown as Parameters<typeof project>[1];
    const { edges } = project(def, plan, [], catalog);
    const data = edges.filter((e) => e.kind === "data");
    expect(data).toHaveLength(1);
    expect(data[0]?.via).toBe("ref");
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });
});

describe("needsLayout", () => {
  it("lays out graphs with missing positions or a single row", async () => {
    const { needsLayout } = await import("./model");
    const def = fresh();
    expect(needsLayout(def)).toBe(false);
    def.nodes.push(task("a"), task("b"), task("c"));
    expect(needsLayout(def)).toBe(true);
    def.layout = {
      nodes: Object.fromEntries(def.nodes.map((n, i) => [n.id, { x: i * 260, y: 220 }])),
    };
    expect(needsLayout(def)).toBe(true);
    def.layout.nodes.b = { x: 520, y: 400 };
    expect(needsLayout(def)).toBe(false);
  });

  it("lays out containers whose children were placed with absolute positions", async () => {
    const { needsLayout } = await import("./model");
    const def = fresh();
    def.nodes.push(loop("loop"), task("inner", "loop"));
    def.layout = {
      nodes: {
        ...Object.fromEntries(def.nodes.map((n, i) => [n.id, { x: i * 260, y: i * 90 }])),
        loop: { x: 300, y: 200 },
        inner: { x: 20, y: 60 },
      },
    };
    // the container has no size yet
    expect(needsLayout(def)).toBe(true);
    def.layout.nodes.loop = { x: 300, y: 200, w: 400, h: 200 };
    expect(needsLayout(def)).toBe(false);
    // a child placed on the canvas, outside its frame
    def.layout.nodes.inner = { x: 580, y: 500 };
    expect(needsLayout(def)).toBe(true);
  });
});

describe("runErrorMessage", () => {
  it("names the server's diagnostics instead of a count", async () => {
    const { runErrorMessage } = await import("./errors");
    const { ApiError } = await import("~/api/client");
    const e = new ApiError(422, "WORKFLOW_VALIDATION_ERROR", "1 diagnostic(s)", {
      diagnostics: [{ message: "secret TYPESAFE_API_KEY is not bound in this environment" }],
    });
    expect(runErrorMessage(e)).toBe(
      "The run could not start: secret TYPESAFE_API_KEY is not bound in this environment",
    );
    expect(runErrorMessage(new Error("x"))).toBe("The run could not start.");
  });
});
