import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowNode } from "@flowaid/workflow-core";
import type { NodeDefinitionView } from "@flowaid/ui";
import { blankDefinition } from "./model";
import { freeControlPort, lastStep, placeNewStep, suggestNext } from "./quickAdd";

const view = (kind: string, category: NodeDefinitionView["category"]): NodeDefinitionView => ({
  kind,
  name: kind,
  category,
  description: "",
});
const palette: NodeDefinitionView[] = [
  view("branch", "flow"),
  view("output", "flow"),
  view("join", "flow"),
  view("human", "human"),
  view("note", "flow"),
  view("flowaid.decision.batch", "decision"),
  view("flowaid.decision.choice", "decision"),
  view("flowaid.decision.confidence_gate", "decision"),
  view("flowaid.decision.validator", "decision"),
  view("flowaid.decision.consensus", "decision"),
  view("flowaid.ai.generate", "generation"),
  view("flowaid.safety.guard", "safety"),
  view("flowaid.data.transform", "data"),
];

const task = (id: string, type: string): WorkflowNode =>
  ({
    id,
    kind: "task",
    type,
    typeVersion: "1.0.0",
    name: id,
    config: {},
    inputs: {},
    credentials: {},
    disabled: false,
  }) as never;

function def(): WorkflowDefinition {
  const d = blankDefinition("3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09", "Test");
  d.layout = { nodes: Object.fromEntries(d.nodes.map((n, i) => [n.id, { x: i * 300, y: 0 }])) };
  return d;
}

describe("suggestNext", () => {
  it("suggests what usually follows a decision, with reasons", () => {
    const d = def();
    const choice = task("classify", "flowaid.decision.choice");
    d.nodes.push(choice);
    const out = suggestNext(d, choice, palette);
    expect(out[0]).toEqual({
      kind: "flowaid.decision.confidence_gate",
      reason: "Act only when the choice is sure enough",
    });
    expect(out.map((s) => s.kind)).toContain("human");
    expect(out.every((s) => s.reason.length > 0)).toBe(true);
  });

  it("falls back on the category for a type without its own entry", () => {
    const d = def();
    const vote = task("vote", "flowaid.decision.consensus");
    expect(suggestNext(d, vote, palette)[0]?.kind).toBe("flowaid.decision.confidence_gate");
  });

  it("never suggests a start node, a note or a kind the palette lacks", () => {
    const d = def();
    const kinds = suggestNext(
      d,
      d.nodes[0],
      palette,
      ["note", "input", "flowaid.tools.http"],
      20,
    ).map((s) => s.kind);
    expect(kinds).not.toContain("note");
    expect(kinds).not.toContain("input");
    expect(kinds).not.toContain("flowaid.tools.http");
  });

  it("suggests an Output when the workflow has none", () => {
    const d = def();
    d.nodes = d.nodes.filter((n) => n.kind !== "output");
    const kinds = suggestNext(d, undefined, palette).map((s) => s.kind);
    expect(kinds).toContain("output");
  });

  it("puts recent kinds in when nothing else says more", () => {
    const d = def();
    expect(
      suggestNext(d, undefined, palette, ["flowaid.safety.guard"]).map((s) => s.kind),
    ).toContain("flowaid.safety.guard");
  });
});

describe("placeNewStep", () => {
  it("goes right of the step it follows, below anything already there", () => {
    const d = def();
    const start = d.nodes[0] as WorkflowNode;
    d.nodes.push(task("taken", "flowaid.data.transform"));
    (d.layout ?? { nodes: {} }).nodes.taken = { x: 232 + 72, y: 0 };
    const at = placeNewStep(d, { x: 0, y: 0 }, start);
    expect(at.x).toBe(232 + 72);
    expect(at.y).not.toBe(0);
  });

  it("moves a wanted spot clear of the steps it would cover", () => {
    const d = def();
    const at = placeNewStep(d, { x: 10, y: 10 });
    expect(at).not.toEqual({ x: 10, y: 10 });
  });
});

describe("freeControlPort and lastStep", () => {
  it("picks the first port nothing follows yet", () => {
    const d = def();
    const branch = { id: "b", kind: "branch" } as unknown as WorkflowNode;
    d.edges.push({ id: "e1", from: { node: "b", port: "yes" }, to: { node: "x" } });
    expect(freeControlPort(d, branch, ["yes", "no"])).toBe("no");
    expect(
      freeControlPort(d, { id: "o", kind: "output" } as unknown as WorkflowNode, ["done"]),
    ).toBeUndefined();
  });

  it("finds the rightmost step that can lead somewhere", () => {
    const d = def();
    expect(lastStep(d)?.kind).not.toBe("output");
  });
});
