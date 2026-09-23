import { describe, expect, it } from "vitest";
import type { NodeChange } from "@xyflow/react";
import { CONTAINER_HEADER_HEIGHT } from "@/node";
import {
  applyLayoutChanges,
  containerDepth,
  frameAt,
  isInside,
  planParentDrops,
  type FlowBox,
} from "./containers";
import type { CanvasLayout, CanvasNode } from "./types";

const PARENTS: Record<string, string | undefined> = {
  research: undefined,
  search_all: "research",
  web: "search_all",
  planner: "research",
  start: undefined,
};
const parentOf = (id: string) => PARENTS[id];

const research: FlowBox = { id: "research", x: 100, y: 100, width: 800, height: 400 };
const searchAll: FlowBox = { id: "search_all", x: 400, y: 200, width: 300, height: 200 };
const FRAMES = [research, searchAll];

describe("container tree helpers", () => {
  it("measures depth and ancestry, stopping on cycles", () => {
    expect(containerDepth("web", parentOf)).toBe(2);
    expect(containerDepth("research", parentOf)).toBe(0);
    expect(isInside("web", "research", parentOf)).toBe(true);
    expect(isInside("planner", "search_all", parentOf)).toBe(false);
    const cyclic = (id: string) => (id === "a" ? "b" : id === "b" ? "a" : undefined);
    expect(containerDepth("a", cyclic)).toBe(1);
    expect(isInside("a", "c", cyclic)).toBe(false);
  });

  it("finds the innermost frame under a point", () => {
    expect(frameAt({ x: 500, y: 300 }, FRAMES, parentOf)?.id).toBe("search_all");
    expect(frameAt({ x: 150, y: 150 }, FRAMES, parentOf)?.id).toBe("research");
    expect(frameAt({ x: 50, y: 50 }, FRAMES, parentOf)).toBeUndefined();
    expect(frameAt({ x: 500, y: 300 }, FRAMES, parentOf, new Set(["search_all"]))?.id).toBe(
      "research",
    );
  });
});

describe("planParentDrops", () => {
  it("moves a top-level node into the frame under its centre, positioned relative to the frame", () => {
    const drops = planParentDrops(
      [{ id: "start", x: 150, y: 180, width: 100, height: 40 }],
      FRAMES,
      parentOf,
    );
    expect(drops).toEqual([
      { parent: "research", ids: ["start"], positions: { start: { x: 50, y: 80 } } },
    ]);
  });

  it("picks the nested frame and keeps the node below the frame header", () => {
    const drops = planParentDrops(
      [{ id: "planner", parent: "research", x: 420, y: 195, width: 100, height: 40 }],
      FRAMES,
      parentOf,
    );
    expect(drops).toEqual([
      {
        parent: "search_all",
        ids: ["planner"],
        positions: { planner: { x: 20, y: CONTAINER_HEADER_HEIGHT } },
      },
    ]);
  });

  it("moves a node dropped outside every frame to the top level, with absolute coordinates", () => {
    const drops = planParentDrops(
      [{ id: "web", parent: "search_all", x: 950, y: 40, width: 100, height: 40 }],
      FRAMES,
      parentOf,
    );
    expect(drops).toEqual([
      { parent: undefined, ids: ["web"], positions: { web: { x: 950, y: 40 } } },
    ]);
  });

  it("leaves nodes that stay in their frame alone", () => {
    expect(
      planParentDrops(
        [{ id: "planner", parent: "research", x: 120, y: 160, width: 100, height: 40 }],
        FRAMES,
        parentOf,
      ),
    ).toEqual([]);
  });

  it("never drops a frame into itself or into a frame inside it, and keeps children dragged with their frame", () => {
    const drops = planParentDrops(
      [
        { id: "research", x: 380, y: 180, width: 800, height: 400 },
        { id: "planner", parent: "research", x: 400, y: 220, width: 100, height: 40 },
      ],
      FRAMES,
      parentOf,
    );
    expect(drops).toEqual([]);
  });

  it("groups several dropped nodes by their new parent", () => {
    const drops = planParentDrops(
      [
        { id: "start", x: 120, y: 160, width: 100, height: 40 },
        { id: "planner", parent: "research", x: 450, y: 250, width: 100, height: 40 },
        { id: "extra", x: 130, y: 300, width: 100, height: 40 },
      ],
      FRAMES,
      parentOf,
    );
    expect(drops).toEqual([
      {
        parent: "research",
        ids: ["start", "extra"],
        positions: { start: { x: 20, y: 60 }, extra: { x: 30, y: 200 } },
      },
      { parent: "search_all", ids: ["planner"], positions: { planner: { x: 50, y: 50 } } },
    ]);
  });
});

describe("applyLayoutChanges", () => {
  const layout: CanvasLayout = {
    nodes: { research: { x: 100, y: 100, w: 800, h: 400 }, planner: { x: 24, y: 64 } },
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  it("writes NodeResizer dimension changes to w/h and positions to x/y", () => {
    const changes: NodeChange<CanvasNode>[] = [
      {
        id: "research",
        type: "dimensions",
        dimensions: { width: 880, height: 440 },
        resizing: true,
        setAttributes: true,
      },
      { id: "research", type: "position", position: { x: 92, y: 100 } },
      { id: "planner", type: "position", position: { x: 40, y: 72 }, dragging: true },
    ];
    expect(applyLayoutChanges(layout, changes)).toEqual({
      nodes: { research: { x: 92, y: 100, w: 880, h: 440 }, planner: { x: 40, y: 72 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(layout.nodes.research).toEqual({ x: 100, y: 100, w: 800, h: 400 });
  });

  it("honours a width- or height-only resize", () => {
    const next = applyLayoutChanges(layout, [
      {
        id: "research",
        type: "dimensions",
        dimensions: { width: 900, height: 999 },
        setAttributes: "width",
      },
    ]);
    expect(next.nodes.research).toEqual({ x: 100, y: 100, w: 900, h: 400 });
  });

  it("ignores measurements, selection and no-op moves, returning the same layout", () => {
    const changes: NodeChange<CanvasNode>[] = [
      { id: "research", type: "dimensions", dimensions: { width: 812, height: 410 } },
      { id: "research", type: "select", selected: true },
      { id: "planner", type: "position", position: { x: 24, y: 64 } },
      { id: "planner", type: "position" },
    ];
    expect(applyLayoutChanges(layout, changes)).toBe(layout);
  });

  it("drops removed nodes", () => {
    expect(applyLayoutChanges(layout, [{ id: "planner", type: "remove" }]).nodes).toEqual({
      research: { x: 100, y: 100, w: 800, h: 400 },
    });
    expect(applyLayoutChanges(layout, [{ id: "ghost", type: "remove" }])).toBe(layout);
  });
});
