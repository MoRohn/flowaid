import { describe, expect, it } from "vitest";
import { templateGraph } from "./workflows.js";

describe("templateGraph", () => {
  it("lists nodes and derives edges from control edges and port refs, de-duplicated", () => {
    const g = templateGraph({
      nodes: [
        { id: "start", kind: "input", name: "Start" },
        {
          id: "intent",
          kind: "task",
          type: "flowaid.decision.choice",
          inputs: { text: { kind: "ref", ref: { kind: "port", node: "start", port: "message" } } },
        },
        {
          id: "reply",
          kind: "task",
          type: "flowaid.ai.generate",
          inputs: {
            a: { kind: "ref", ref: { kind: "port", node: "intent", port: "decision" } },
            b: { kind: "ref", ref: { kind: "port", node: "intent", port: "value" } },
            c: { kind: "ref", ref: { kind: "port", node: "missing", port: "x" } },
          },
        },
      ],
      edges: [{ id: "e1", from: { node: "intent", port: "billing" }, to: { node: "reply" } }],
    });
    expect(g.nodes).toEqual([
      { id: "start", kind: "input", type: null, name: "Start" },
      { id: "intent", kind: "task", type: "flowaid.decision.choice", name: "intent" },
      { id: "reply", kind: "task", type: "flowaid.ai.generate", name: "reply" },
    ]);
    expect(g.edges).toEqual([
      { source: "intent", target: "reply" },
      { source: "start", target: "intent" },
    ]);
  });
  it("tolerates an empty definition", () => {
    expect(templateGraph({})).toEqual({ nodes: [], edges: [] });
  });
});
