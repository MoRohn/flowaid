import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MiniGraph, layoutMiniGraph, type MiniGraphEdge, type MiniGraphNode } from "./MiniGraph";
import { BUILDER_SAMPLE_TEMPLATES } from "./sampleTemplates";

afterEach(cleanup);

const NODES: MiniGraphNode[] = [
  { id: "a", category: "flow" },
  { id: "b", category: "decision" },
  { id: "c", category: "tool" },
  { id: "d", category: "human" },
  { id: "lonely", category: "developer" },
];
const EDGES: MiniGraphEdge[] = [
  { source: "a", target: "b" },
  { source: "b", target: "c" },
  { source: "b", target: "d" },
];

describe("layoutMiniGraph", () => {
  it("produces a position for every node, including disconnected ones", () => {
    const layout = layoutMiniGraph(NODES, EDGES);
    expect(layout.positions.map((p) => p.id).sort()).toEqual(["a", "b", "c", "d", "lonely"]);
  });

  it("ranks nodes left to right by longest path", () => {
    const { positions } = layoutMiniGraph(NODES, EDGES);
    const col = (id: string) => positions.find((p) => p.id === id)?.column;
    expect(col("a")).toBe(0);
    expect(col("b")).toBe(1);
    expect(col("c")).toBe(2);
    expect(col("d")).toBe(2);
    expect(col("lonely")).toBe(0);
  });

  it("keeps every node inside the box with padding", () => {
    const { positions } = layoutMiniGraph(NODES, EDGES, { width: 200, height: 80, padding: 10 });
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(10);
      expect(p.x).toBeLessThanOrEqual(190);
      expect(p.y).toBeGreaterThanOrEqual(10);
      expect(p.y).toBeLessThanOrEqual(70);
    }
  });

  it("spreads siblings in a column vertically and centres single nodes", () => {
    const { positions } = layoutMiniGraph(NODES, EDGES, { width: 200, height: 80, padding: 10 });
    const y = (id: string) => positions.find((p) => p.id === id)?.y;
    expect(y("c")).not.toBe(y("d"));
    expect(y("b")).toBe(40);
  });

  it("does not loop or throw on cycles", () => {
    const cyc: MiniGraphEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ];
    const layout = layoutMiniGraph(NODES.slice(0, 2), cyc);
    expect(layout.positions).toHaveLength(2);
    expect(layout.columns).toBe(2);
  });

  it("ignores edges that reference unknown nodes", () => {
    const layout = layoutMiniGraph(NODES, [{ source: "a", target: "ghost" }]);
    expect(layout.columns).toBe(1);
  });

  it.each(BUILDER_SAMPLE_TEMPLATES.map((t) => [t.name, t] as const))(
    "lays out template %s",
    (_name, t) => {
      const layout = layoutMiniGraph(t.nodes, t.edges);
      expect(layout.positions).toHaveLength(t.nodes.length);
    },
  );
});

describe("MiniGraph", () => {
  it("renders one circle per node and one path per valid edge", () => {
    const { container } = render(<MiniGraph nodes={NODES} edges={EDGES} />);
    expect(container.querySelectorAll("g[data-node-id]")).toHaveLength(5);
    expect(container.querySelectorAll("path")).toHaveLength(3);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 200 80");
  });

  it("draws a ring for highlighted nodes", () => {
    const { container } = render(<MiniGraph nodes={NODES} edges={EDGES} highlight={["b"]} />);
    expect(container.querySelector('g[data-node-id="b"]')?.querySelectorAll("circle")).toHaveLength(
      2,
    );
    expect(container.querySelector('g[data-node-id="a"]')?.querySelectorAll("circle")).toHaveLength(
      1,
    );
  });
});
