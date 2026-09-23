import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import { useEdgesState, useNodesState, type NodeChange } from "@xyflow/react";
import { useState } from "react";
import { CONTAINER_HEADER_HEIGHT, toFlowNode } from "@/node";
import { dragMouse, installSizedLayoutStubs } from "@/node/flowTestStubs";
import {
  researchAgentDependencies,
  researchAgentEdges,
  researchAgentEvents,
  researchAgentNodes,
} from "@/node/researchAgent";
import { foldRunEvents } from "@/lib/adapters";
import { installDomStubs } from "@/primitives/testStubs";
import type { RunView, WorkflowNodeView } from "@/types";
import { autoLayout, estimateNodeHeight } from "./autoLayout";
import { applyLayoutChanges } from "./containers";
import { toCanvasEdge } from "./edgeTypes";
import { FlowCanvas } from "./FlowCanvas";
import type { CanvasEdge, CanvasLayout, CanvasNode, CanvasPoint } from "./types";

installDomStubs();
let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = installSizedLayoutStubs();
});
afterAll(() => restoreLayout());
afterEach(cleanup);

const byId = new Map(researchAgentNodes.map((n) => [n.id, n]));
function node(id: string): WorkflowNodeView {
  const n = byId.get(id);
  if (!n) throw new Error(`no fixture node ${id}`);
  return n;
}

const EVENTS = researchAgentEvents();

function runFrom(events: readonly unknown[]): RunView {
  const folded = foldRunEvents(events, { categoryFor: (id) => byId.get(id)?.category ?? "flow" });
  expect(folded.invalid).toEqual([]);
  return {
    id: "0192f0a1-5b3c-7d4e-8f60-1a2b3c4d5e6f",
    workflowId: "b4d6f8a0-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
    workflowName: "Research Agent",
    version: 1,
    status: "running",
    origin: "ui",
    createdAt: "2026-09-22T10:00:00.000Z",
    nodeRuns: folded.nodeRuns,
  };
}

/** Index just past the n-th event of `type` in the research log. */
function afterNth(type: string, n: number): number {
  let seen = 0;
  for (let i = 0; i < EVENTS.length; i++) {
    const e = EVENTS[i];
    if (typeof e === "object" && e !== null && "type" in e && e.type === type) {
      seen += 1;
      if (seen === n) return i + 1;
    }
  }
  throw new Error(`fewer than ${n} ${type} events`);
}

function translateOf(el: Element | null): CanvasPoint {
  const match = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(
    el instanceof HTMLElement ? el.style.transform : "",
  );
  if (!match?.[1] || !match[2]) throw new Error("node has no translate transform");
  return { x: Number(match[1]), y: Number(match[2]) };
}

function flowNodeEl(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`node ${id} not rendered`);
  return el;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

interface HarnessProps {
  initial: CanvasNode[];
  run?: RunView;
  onSetParent?: (
    ids: string[],
    parent: string | undefined,
    positions: Record<string, CanvasPoint>,
  ) => void;
  onChanges?: (changes: NodeChange<CanvasNode>[]) => void;
  onLayout?: (layout: CanvasLayout) => void;
  initialLayout?: CanvasLayout;
}

/** A controlled canvas that keeps its nodes in state and mirrors node changes onto a workflow layout. */
function Harness({
  initial,
  run,
  onSetParent,
  onChanges,
  onLayout,
  initialLayout = { nodes: {} },
}: HarnessProps) {
  const [nodes, , onNodesChange] = useNodesState<CanvasNode>(initial);
  const [edges, , onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const [, setLayout] = useState<CanvasLayout>(initialLayout);
  return (
    <div style={{ width: 800, height: 600 }}>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => {
          onChanges?.(changes);
          onNodesChange(changes);
          setLayout((current) => {
            const next = applyLayoutChanges(current, changes);
            onLayout?.(next);
            return next;
          });
        }}
        onEdgesChange={onEdgesChange}
        onSetParent={onSetParent}
        run={run}
        fitViewOnInit={false}
        defaultShowMinimap={false}
      />
    </div>
  );
}

const loop: WorkflowNodeView = {
  id: "loop",
  kind: "loop",
  category: "flow",
  name: "Loop",
  bounds: { maxIterations: 10 },
  inputs: [],
  outputs: [],
};
const task = (id: string, parent?: string): WorkflowNodeView => ({
  id,
  kind: "task",
  nodeType: "flowaid.data.transform",
  category: "data",
  name: id,
  inputs: [],
  outputs: [],
  ...(parent !== undefined ? { parent } : null),
});

describe("ContainerFrame on the canvas", () => {
  function researchNodes(): { nodes: CanvasNode[]; layout: CanvasLayout } {
    const { positions, sizes } = autoLayout(
      researchAgentNodes.map((n) => ({
        id: n.id,
        ...(n.parent !== undefined ? { parent: n.parent } : null),
        height: 96,
      })),
      researchAgentDependencies,
    );
    const layout: CanvasLayout = { nodes: {} };
    const nodes = researchAgentNodes.map((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      const size = sizes.get(n.id);
      const placement = size ? { ...p, w: size.width, h: size.height } : p;
      layout.nodes[n.id] = placement;
      return toFlowNode(n, placement);
    });
    return { nodes, layout };
  }

  it("renders the loop and foreach bodies nested inside their frames", async () => {
    const { nodes, layout } = researchNodes();
    const { container } = render(<Harness initial={nodes} initialLayout={layout} />);
    await settle();
    expect(container.querySelectorAll(".react-flow__node-container .fa-frame")).toHaveLength(2);
    const abs = (id: string): CanvasPoint => translateOf(flowNodeEl(container, id));
    for (const n of researchAgentNodes) {
      if (n.parent === undefined) continue;
      const frame = layout.nodes[n.parent];
      const own = layout.nodes[n.id];
      if (!frame?.w || !frame.h || !own) throw new Error("layout missing");
      const f = abs(n.parent);
      const c = abs(n.id);
      // xyflow draws the child at the frame's origin plus its relative position.
      expect(c).toEqual({ x: f.x + own.x, y: f.y + own.y });
      const size =
        own.w !== undefined && own.h !== undefined ? { w: own.w, h: own.h } : { w: 232, h: 96 };
      expect(c.x).toBeGreaterThanOrEqual(f.x);
      expect(c.y).toBeGreaterThanOrEqual(f.y + CONTAINER_HEADER_HEIGHT);
      expect(c.x + size.w).toBeLessThanOrEqual(f.x + frame.w);
      expect(c.y + size.h).toBeLessThanOrEqual(f.y + frame.h);
    }
  });

  it("holds a child inside its frame while it is dragged (extent: 'parent')", async () => {
    const changes: NodeChange<CanvasNode>[] = [];
    const initial = [
      toFlowNode(loop, { x: 100, y: 100, w: 400, h: 300 }),
      toFlowNode(task("a", "loop"), { x: 24, y: 64 }),
    ];
    const { container } = render(
      <Harness initial={initial} onChanges={(c) => changes.push(...c)} />,
    );
    await settle();
    act(() => {
      dragMouse(flowNodeEl(container, "a"), { x: 200, y: 200 }, { x: 700, y: 560 });
    });
    const last = changes.filter((c) => c.type === "position" && c.id === "a").at(-1);
    expect(last?.type === "position" ? last.position : undefined).toEqual({
      x: 400 - 232,
      y: 300 - 96,
    });
  });

  it("reports a NodeResizer drag as dimension changes that update layout.nodes[id].w/h", async () => {
    let layout: CanvasLayout = { nodes: {} };
    const changes: NodeChange<CanvasNode>[] = [];
    const initial = [{ ...toFlowNode(loop, { x: 100, y: 100, w: 300, h: 200 }), selected: true }];
    const { container } = render(
      <Harness
        initial={initial}
        initialLayout={{ nodes: { loop: { x: 100, y: 100, w: 300, h: 200 } } }}
        onChanges={(c) => changes.push(...c)}
        onLayout={(next) => {
          layout = next;
        }}
      />,
    );
    await settle();
    const handle = flowNodeEl(container, "loop").querySelector(
      ".react-flow__resize-control.handle.bottom.right",
    );
    expect(handle).not.toBeNull();
    if (!handle) return;
    act(() => {
      dragMouse(handle, { x: 400, y: 300 }, { x: 480, y: 360 });
    });
    const resized = changes
      .filter((c) => c.type === "dimensions" && c.id === "loop" && c.setAttributes === true)
      .at(-1);
    const size = resized?.type === "dimensions" ? resized.dimensions : undefined;
    // The bottom-right handle moved by (80, 60); the resizer snaps to the 8px grid.
    expect(size?.width).toBeCloseTo(380, -1);
    expect(size?.height).toBeCloseTo(260, -1);
    expect(layout.nodes.loop).toEqual({ x: 100, y: 100, w: size?.width, h: size?.height });
    expect(flowNodeEl(container, "loop").style.width).toBe(`${size?.width ?? 0}px`);
  });

  it("calls onSetParent when a node is dropped into a frame, with its position inside the frame", async () => {
    const onSetParent = vi.fn();
    const initial = [
      toFlowNode(task("a"), { x: 0, y: 0 }),
      toFlowNode(loop, { x: 300, y: 100, w: 400, h: 300 }),
    ];
    const { container } = render(<Harness initial={initial} onSetParent={onSetParent} />);
    await settle();
    act(() => {
      dragMouse(flowNodeEl(container, "a"), { x: 100, y: 40 }, { x: 440, y: 240 });
    });
    expect(onSetParent).toHaveBeenCalledTimes(1);
    // `a` moved by (340 − 4 px drag-start nudge, 200) to (336, 200); the frame's origin is (300, 100).
    expect(onSetParent).toHaveBeenCalledWith(["a"], "loop", { a: { x: 36, y: 100 } });
  });

  it("does not reparent a node dropped where it already belongs", async () => {
    const onSetParent = vi.fn();
    const initial = [
      toFlowNode(loop, { x: 100, y: 100, w: 500, h: 400 }),
      toFlowNode(task("a", "loop"), { x: 24, y: 64 }),
    ];
    const { container } = render(<Harness initial={initial} onSetParent={onSetParent} />);
    await settle();
    act(() => {
      dragMouse(flowNodeEl(container, "a"), { x: 150, y: 200 }, { x: 250, y: 260 });
    });
    expect(onSetParent).not.toHaveBeenCalled();
  });

  it("with ⌥/Alt held, lets a child leave its frame and reports the drop onto the top level", async () => {
    const onSetParent = vi.fn();
    const initial = [
      toFlowNode(loop, { x: 100, y: 100, w: 400, h: 300 }),
      toFlowNode(task("a", "loop"), { x: 24, y: 64 }),
    ];
    const { container } = render(<Harness initial={initial} onSetParent={onSetParent} />);
    await settle();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true }));
    });
    await settle();
    act(() => {
      dragMouse(flowNodeEl(container, "a"), { x: 150, y: 200 }, { x: 650, y: 500 });
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", altKey: false }));
    });
    expect(onSetParent).toHaveBeenCalledTimes(1);
    expect(onSetParent.mock.calls[0]?.[0]).toEqual(["a"]);
    expect(onSetParent.mock.calls[0]?.[1]).toBeUndefined();
    const positions: unknown = onSetParent.mock.calls[0]?.[2];
    // From (124, 164) absolute by (500 − 4, 300), snapped to the 8px grid.
    expect(positions).toEqual({ a: { x: 624, y: 464 } });
  });
  it("updates on the canvas as the run advances", async () => {
    const nodes = researchAgentNodes.map((n) =>
      toFlowNode(n, { x: 0, y: 0, ...(n.kind === "task" ? null : { w: 600, h: 300 }) }),
    );
    const edges = researchAgentEdges.map(toCanvasEdge);
    const partial = runFrom(EVENTS.slice(0, afterNth("LOOP_ITERATION_STARTED", 2)));
    const view = (run: RunView) => (
      <div style={{ width: 800, height: 600 }}>
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={() => undefined}
          onEdgesChange={() => undefined}
          run={run}
          fitViewOnInit={false}
        />
      </div>
    );
    const { container, rerender } = render(view(partial));
    await settle();
    const frame = () => within(flowNodeEl(container, "research"));
    expect(frame().getByLabelText("iteration 2 of 5")).toHaveTextContent("2/5");
    rerender(view(runFrom(EVENTS)));
    await settle();
    expect(frame().getByLabelText("iteration 3 of 5")).toHaveTextContent("3/5");
  });
});

describe("estimateNodeHeight", () => {
  it("gives containers the frame minimum", () => {
    expect(estimateNodeHeight(node("research"))).toBeGreaterThan(96);
  });
});
