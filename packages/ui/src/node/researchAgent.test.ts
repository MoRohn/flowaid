import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowDefinitionSchema } from "@flowaid/workflow-core";
import { foldRunEvents } from "@/lib/adapters";
import { researchAgentEdges, researchAgentEvents, researchAgentNodes } from "./researchAgent";

/** `packages/workflow-core/fixtures/research-agent.json`, resolved from this test file. */
function definition() {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("vitest did not report the test path");
  const file = join(dirname(testPath), "../../../workflow-core/fixtures/research-agent.json");
  return WorkflowDefinitionSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

describe("research-agent gallery fixture", () => {
  const def = definition();

  it("mirrors the workflow-core fixture's nodes: ids, kinds, type ids, names and parents", () => {
    const fromJson = def.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      nodeType: n.kind === "task" ? n.type : undefined,
      name: n.name,
      parent: n.parent,
    }));
    const fromView = researchAgentNodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      nodeType: n.nodeType,
      name: n.name,
      parent: n.parent,
    }));
    expect(fromView).toEqual(fromJson);
  });

  it("mirrors the control edges and the loop bounds", () => {
    const control = researchAgentEdges
      .filter((e) => e.kind === "control")
      .map((e) => ({ id: e.id, from: e.source, port: e.sourceHandle, to: e.target }));
    expect(control).toEqual(
      def.edges.map((e) => ({
        id: e.id,
        from: e.from.node,
        port: `ctl:${e.from.port}`,
        to: e.to.node,
      })),
    );
    for (const n of def.nodes) {
      if (n.kind !== "loop" && n.kind !== "foreach") continue;
      const view = researchAgentNodes.find((v) => v.id === n.id);
      expect(view?.bounds?.maxIterations).toBe(n.bounds.maxIterations);
    }
  });

  it("has a mid-run event log that validates and folds into 3/5 and 3/4", () => {
    const folded = foldRunEvents(researchAgentEvents());
    expect(folded.invalid).toEqual([]);
    const research = folded.nodeRuns.filter((r) => r.nodeId === "research").at(-1);
    const searchAll = folded.nodeRuns.filter((r) => r.nodeId === "search_all").at(-1);
    expect(research?.progress).toMatchObject({ mode: "loop", started: 3, completed: 2 });
    expect(searchAll?.progress).toMatchObject({ mode: "foreach", total: 4, completed: 3 });
    expect(searchAll?.scope).toBe("research#2");
  });
});
