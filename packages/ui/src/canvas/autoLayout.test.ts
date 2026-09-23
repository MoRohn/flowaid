import { describe, expect, it } from "vitest";
import { applyAutoLayout, autoLayout, estimateNodeHeight, findBackEdges } from "./autoLayout";
import { CONTAINER_HEADER_HEIGHT, CONTAINER_PADDING } from "@/node";
import { researchAgentDependencies, researchAgentNodes } from "@/node/researchAgent";
import { SAMPLE_EDGES, SAMPLE_NODES, toCanvasNodes } from "./sampleWorkflow";

interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("autoLayout", () => {
  const nodes = SAMPLE_NODES.map((n) => ({
    id: n.id,
    width: 232,
    height: estimateNodeHeight(n, true),
  }));
  const { positions, layers, backEdges } = autoLayout(nodes, SAMPLE_EDGES, {
    nodeGap: 40,
    layerGap: 96,
  });

  it("positions every node", () => {
    expect(positions.size).toBe(SAMPLE_NODES.length);
    expect(backEdges).toEqual([]);
  });

  it("produces no overlapping cards for the sample graph", () => {
    const rects: Rect[] = nodes.map((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      return { id: n.id, x: p.x, y: p.y, w: n.width, h: n.height };
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) continue;
        expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("keeps every edge pointing left to right with a gap", () => {
    for (const e of SAMPLE_EDGES) {
      const s = positions.get(e.source);
      const t = positions.get(e.target);
      expect(s).toBeDefined();
      expect(t).toBeDefined();
      if (!s || !t) continue;
      expect(t.x - (s.x + 232), `${e.source} → ${e.target}`).toBeGreaterThanOrEqual(96);
    }
  });

  it("layers by longest path", () => {
    expect(layers[0]).toEqual(["start"]);
    const layerOf = new Map<string, number>();
    layers.forEach((l, i) => l.forEach((id) => layerOf.set(id, i)));
    expect(layerOf.get("router")).toBe(2);
    expect(layerOf.get("gate")).toBe(6);
    expect(layerOf.get("send")).toBe(8);
  });

  it("aligns nodes in the same layer on the same x", () => {
    const xs = new Set(["intent", "urgency", "escalation"].map((id) => positions.get(id)?.x));
    expect(xs.size).toBe(1);
  });

  it("ignores back edges so cycles still lay out", () => {
    const cyc = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
    ];
    const ids = ["a", "b", "c"].map((id) => ({ id }));
    expect(findBackEdges(["a", "b", "c"], cyc)).toEqual([{ source: "c", target: "a" }]);
    const res = autoLayout(ids, cyc);
    expect(res.backEdges).toHaveLength(1);
    expect(res.layers).toEqual([["a"], ["b"], ["c"]]);
  });

  it("starts the top-most node at the origin", () => {
    let minY = Number.POSITIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    for (const p of positions.values()) {
      minY = Math.min(minY, p.y);
      minX = Math.min(minX, p.x);
    }
    expect(minY).toBe(0);
    expect(minX).toBe(0);
  });

  it("applyAutoLayout returns nodes with positions and keeps the rest", () => {
    const laid = applyAutoLayout(toCanvasNodes(), SAMPLE_EDGES);
    expect(laid).toHaveLength(SAMPLE_NODES.length);
    const router = laid.find((n) => n.id === "router");
    expect(router?.position.x).toBeGreaterThan(0);
    expect(router?.data.node.name).toBe("Router");
  });

  it("estimates taller cards for routes and distributions", () => {
    const gate = SAMPLE_NODES.find((n) => n.id === "gate");
    const intent = SAMPLE_NODES.find((n) => n.id === "intent");
    const start = SAMPLE_NODES.find((n) => n.id === "start");
    if (!gate || !intent || !start) throw new Error("sample nodes missing");
    expect(estimateNodeHeight(gate)).toBeGreaterThan(estimateNodeHeight(intent));
    expect(estimateNodeHeight(intent, true)).toBeGreaterThan(estimateNodeHeight(intent));
    expect(estimateNodeHeight(start)).toBeLessThan(estimateNodeHeight(intent));
  });
});

describe("autoLayout with containers (compound)", () => {
  const input = researchAgentNodes.map((n) => ({
    id: n.id,
    ...(n.parent !== undefined ? { parent: n.parent } : null),
    width: 232,
    height: estimateNodeHeight(n),
  }));
  const parentOf = new Map(researchAgentNodes.map((n) => [n.id, n.parent]));
  const { positions, sizes, layers } = autoLayout(input, researchAgentDependencies, {
    nodeGap: 40,
    layerGap: 96,
  });
  const sizeOf = (id: string) => {
    const fitted = sizes.get(id);
    if (fitted) return { w: fitted.width, h: fitted.height };
    const n = input.find((i) => i.id === id);
    return { w: n?.width ?? 232, h: n?.height ?? 96 };
  };
  const rectOf = (id: string): Rect => {
    const p = positions.get(id);
    if (!p) throw new Error(`no position for ${id}`);
    const { w, h } = sizeOf(id);
    return { id, x: p.x, y: p.y, w, h };
  };

  it("fits every container that has children", () => {
    expect([...sizes.keys()].sort()).toEqual(["research", "search_all"]);
  });

  it("keeps every child inside its frame, below the header, with the padding", () => {
    for (const n of researchAgentNodes) {
      if (n.parent === undefined) continue;
      const frame = sizeOf(n.parent);
      const child = rectOf(n.id);
      expect(child.x, `${n.id} left`).toBeGreaterThanOrEqual(CONTAINER_PADDING);
      expect(child.y, `${n.id} top`).toBeGreaterThanOrEqual(
        CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING,
      );
      expect(child.x + child.w, `${n.id} right`).toBeLessThanOrEqual(frame.w - CONTAINER_PADDING);
      expect(child.y + child.h, `${n.id} bottom`).toBeLessThanOrEqual(frame.h - CONTAINER_PADDING);
    }
  });

  it("sizes each frame to fit its children exactly (padding on the right and bottom edge)", () => {
    for (const frameId of ["research", "search_all"]) {
      const children = researchAgentNodes
        .filter((n) => n.parent === frameId)
        .map((n) => rectOf(n.id));
      const right = Math.max(...children.map((c) => c.x + c.w));
      const bottom = Math.max(...children.map((c) => c.y + c.h));
      expect(sizeOf(frameId)).toEqual({
        w: right + CONTAINER_PADDING,
        h: bottom + CONTAINER_PADDING,
      });
    }
  });

  it("lays out siblings without overlaps at every level", () => {
    const levels = new Map<string | undefined, Rect[]>();
    for (const n of researchAgentNodes) {
      const list = levels.get(n.parent) ?? [];
      list.push(rectOf(n.id));
      levels.set(n.parent, list);
    }
    for (const rects of levels.values()) {
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          if (!a || !b) continue;
          expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });

  it("orders the body left to right by its dependencies and lifts edges that cross a frame", () => {
    const x = (id: string) => rectOf(id).x;
    expect(x("planner")).toBeLessThan(x("search_all"));
    expect(x("search_all")).toBeLessThan(x("store"));
    expect(x("store")).toBeLessThan(x("synthesis"));
    expect(x("synthesis")).toBeLessThan(x("completeness"));
    expect(x("web")).toBeLessThan(x("judge"));
    // start → judge (inside search_all inside research) counts as start → research at the top level.
    expect(layers[0]).toEqual(["start"]);
    expect(layers[1]).toEqual(["research"]);
    expect(parentOf.get("judge")).toBe("search_all");
  });

  it("returns child positions relative to the frame and fitted sizes through applyAutoLayout", () => {
    const laid = applyAutoLayout(
      input.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
      researchAgentDependencies,
    );
    const research = laid.find((n) => n.id === "research");
    const planner = laid.find((n) => n.id === "planner");
    expect(research?.width).toBe(sizes.get("research")?.width);
    expect(research?.height).toBe(sizes.get("research")?.height);
    expect(planner?.position.x).toBe(CONTAINER_PADDING);
    expect(planner?.position.y).toBe(positions.get("planner")?.y);
  });

  it("treats a parent missing from the graph, or a parent cycle, as the top level", () => {
    const res = autoLayout(
      [
        { id: "a", parent: "ghost" },
        { id: "b", parent: "c" },
        { id: "c", parent: "b" },
      ],
      [],
    );
    expect(res.positions.size).toBe(3);
    expect(res.sizes.size).toBe(0);
  });
});
