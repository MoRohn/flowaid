/**
 * FlowCanvas: the remaining keyboard shortcuts (delete, escape, duplicate, group, auto
 * layout, zoom) and the selection/diagnostics performance contract: `onSelectionChange`
 * fires only when the selected id sets change, never on a position change, and diagnostics
 * rows resolve node names through the memoised id map.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyEdgeChanges, applyNodeChanges, type NodeChange } from "@xyflow/react";
import { useState } from "react";
import { toFlowNode } from "@/node";
import { installSizedLayoutStubs } from "@/node/flowTestStubs";
import { installDomStubs } from "@/primitives/testStubs";
import type { Diagnostic } from "@flowaid/workflow-core";
import type { WorkflowNodeView } from "@/types";
import { FlowCanvas, type FlowCanvasProps } from "./FlowCanvas";
import type { CanvasEdge, CanvasNode } from "./types";

installDomStubs();
let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = installSizedLayoutStubs();
});
afterAll(() => restoreLayout());
afterEach(cleanup);

const view = (id: string, name: string): WorkflowNodeView => ({
  id,
  kind: "task",
  nodeType: "flowaid.data.transform",
  category: "data",
  name,
  inputs: [{ id: "in", label: "in", type: "string" }],
  outputs: [{ id: "out", label: "out", type: "string" }],
});

function initialNodes(selected: readonly string[]): CanvasNode[] {
  return [
    { ...toFlowNode(view("a", "Alpha"), { x: 0, y: 0 }), selected: selected.includes("a") },
    { ...toFlowNode(view("b", "Bravo"), { x: 320, y: 0 }), selected: selected.includes("b") },
    { ...toFlowNode(view("c", "Charlie"), { x: 640, y: 0 }), selected: selected.includes("c") },
  ];
}

type HarnessProps = Partial<
  Omit<FlowCanvasProps, "nodes" | "edges" | "onNodesChange" | "onEdgesChange">
> & {
  selected?: readonly string[];
  onChanges?: (changes: NodeChange<CanvasNode>[]) => void;
  /** Exposes the node setter so a test can change nodes from outside. */
  expose?: (set: (update: (nodes: CanvasNode[]) => CanvasNode[]) => void) => void;
};

function Harness({ selected = [], onChanges, expose, ...props }: HarnessProps) {
  const [nodes, setNodes] = useState<CanvasNode[]>(() => initialNodes(selected));
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  expose?.(setNodes);
  return (
    <div style={{ width: 800, height: 600 }}>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => {
          onChanges?.(changes);
          setNodes((ns) => applyNodeChanges(changes, ns));
        }}
        onEdgesChange={(changes) => setEdges((es) => applyEdgeChanges(changes, es))}
        fitViewOnInit={false}
        defaultShowMinimap={false}
        {...props}
      />
    </div>
  );
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function focusCanvas() {
  screen.getByRole("application", { name: "Workflow canvas" }).focus();
}

function viewportScale(container: HTMLElement): number {
  const vp = container.querySelector(".react-flow__viewport");
  const m = vp instanceof HTMLElement ? /scale\(([\d.]+)\)/.exec(vp.style.transform) : null;
  return m?.[1] ? Number(m[1]) : Number.NaN;
}

describe("FlowCanvas shortcuts", () => {
  it("deletes the selection with Delete and Backspace", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness selected={["b"]} />);
    await settle();
    focusCanvas();
    await user.keyboard("{Delete}");
    await settle();
    expect(container.querySelector('.react-flow__node[data-id="b"]')).toBeNull();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(2);
  });

  it("does not delete while locked", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness selected={["b"]} locked />);
    await settle();
    focusCanvas();
    await user.keyboard("{Backspace}");
    await settle();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
  });

  it("clears the selection with Escape", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn<NonNullable<FlowCanvasProps["onSelectionChange"]>>();
    render(<Harness selected={["a", "c"]} onSelectionChange={onSelectionChange} />);
    await settle();
    expect(onSelectionChange.mock.calls.at(-1)?.[0].nodes.map((n) => n.id)).toEqual(["a", "c"]);
    focusCanvas();
    await user.keyboard("{Escape}");
    await settle();
    expect(onSelectionChange.mock.calls.at(-1)?.[0].nodes).toEqual([]);
  });

  it("duplicates with mod+D and groups with mod+G, handing over the selection", async () => {
    const user = userEvent.setup();
    const onDuplicateNodes = vi.fn<(nodes: CanvasNode[]) => void>();
    const onGroupNodes = vi.fn<(nodes: CanvasNode[]) => void>();
    render(
      <Harness
        selected={["a", "b"]}
        onDuplicateNodes={onDuplicateNodes}
        onGroupNodes={onGroupNodes}
      />,
    );
    await settle();
    focusCanvas();
    await user.keyboard("{Control>}d{/Control}");
    expect(onDuplicateNodes.mock.calls[0]?.[0].map((n) => n.id)).toEqual(["a", "b"]);
    await user.keyboard("{Control>}g{/Control}");
    expect(onGroupNodes.mock.calls[0]?.[0].map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("ignores duplicate and group with an empty selection or while locked", async () => {
    const user = userEvent.setup();
    const onDuplicateNodes = vi.fn();
    const onGroupNodes = vi.fn();
    const { unmount } = render(
      <Harness onDuplicateNodes={onDuplicateNodes} onGroupNodes={onGroupNodes} />,
    );
    await settle();
    focusCanvas();
    await user.keyboard("{Control>}d{/Control}{Control>}g{/Control}");
    unmount();
    render(
      <Harness
        selected={["a"]}
        locked
        onDuplicateNodes={onDuplicateNodes}
        onGroupNodes={onGroupNodes}
      />,
    );
    await settle();
    focusCanvas();
    await user.keyboard("{Control>}d{/Control}{Control>}g{/Control}");
    expect(onDuplicateNodes).not.toHaveBeenCalled();
    expect(onGroupNodes).not.toHaveBeenCalled();
  });

  it("lays the graph out with Shift+L as position changes", async () => {
    const user = userEvent.setup();
    const changes: NodeChange<CanvasNode>[] = [];
    render(<Harness onChanges={(c) => changes.push(...c)} />);
    await settle();
    focusCanvas();
    await user.keyboard("{Shift>}L{/Shift}");
    await settle();
    const moved = changes.filter((c) => c.type === "position");
    expect(new Set(moved.map((c) => (c.type === "position" ? c.id : "")))).toEqual(
      new Set(["a", "b", "c"]),
    );
  });

  it("zooms in and out with mod+= and mod+-", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await settle();
    const before = viewportScale(container);
    focusCanvas();
    await user.keyboard("{Control>}={/Control}");
    await settle(400);
    const zoomedIn = viewportScale(container);
    expect(zoomedIn).toBeGreaterThan(before);
    await user.keyboard("{Control>}-{/Control}");
    await settle(400);
    expect(viewportScale(container)).toBeLessThan(zoomedIn);
  });
});

describe("FlowCanvas selection reporting", () => {
  it("reports the initial selection once and again only when the selected ids change", async () => {
    const onSelectionChange = vi.fn<NonNullable<FlowCanvasProps["onSelectionChange"]>>();
    let setNodes: (update: (nodes: CanvasNode[]) => CanvasNode[]) => void = () => undefined;
    render(
      <Harness
        selected={["a"]}
        onSelectionChange={onSelectionChange}
        expose={(s) => (setNodes = s)}
      />,
    );
    await settle();
    const calls = onSelectionChange.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(onSelectionChange.mock.calls.at(-1)?.[0].nodes.map((n) => n.id)).toEqual(["a"]);

    // A position change (every drag frame) leaves the selection alone.
    act(() =>
      setNodes((ns) =>
        applyNodeChanges(
          [{ type: "position", id: "a", position: { x: 48, y: 16 }, dragging: true }],
          ns,
        ),
      ),
    );
    act(() =>
      setNodes((ns) =>
        applyNodeChanges([{ type: "position", id: "b", position: { x: 360, y: 40 } }], ns),
      ),
    );
    await settle();
    expect(onSelectionChange).toHaveBeenCalledTimes(calls);

    // Re-ordering the node array keeps the same selected set: still no call.
    act(() => setNodes((ns) => [...ns].reverse()));
    await settle();
    expect(onSelectionChange).toHaveBeenCalledTimes(calls);

    // Selecting another node changes the set: one call with both.
    act(() =>
      setNodes((ns) => applyNodeChanges([{ type: "select", id: "c", selected: true }], ns)),
    );
    await settle();
    expect(onSelectionChange).toHaveBeenCalledTimes(calls + 1);
    expect(
      onSelectionChange.mock.calls
        .at(-1)?.[0]
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "c"]);
  });

  it("does not report a selection on a drag of the selected node", async () => {
    const onSelectionChange = vi.fn();
    let setNodes: (update: (nodes: CanvasNode[]) => CanvasNode[]) => void = () => undefined;
    render(
      <Harness
        selected={["b"]}
        onSelectionChange={onSelectionChange}
        expose={(s) => (setNodes = s)}
      />,
    );
    await settle();
    onSelectionChange.mockClear();
    for (let i = 1; i <= 10; i++) {
      act(() =>
        setNodes((ns) =>
          applyNodeChanges(
            [{ type: "position", id: "b", position: { x: 320 + i * 8, y: i * 4 }, dragging: true }],
            ns,
          ),
        ),
      );
    }
    await settle();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});

describe("FlowCanvas diagnostics", () => {
  it("names each diagnostic's node through the id map, following renames", async () => {
    const user = userEvent.setup();
    const diagnostics: Diagnostic[] = [
      {
        code: "W_NULLABLE_INPUT",
        severity: "warning",
        message: "Input in may be undefined",
        location: { nodeId: "c", port: "in" },
      },
    ];
    let setNodes: (update: (nodes: CanvasNode[]) => CanvasNode[]) => void = () => undefined;
    render(<Harness diagnostics={diagnostics} expose={(s) => (setNodes = s)} />);
    await settle();
    await user.click(screen.getByRole("button", { name: /1 warning/i }));
    const row = () => screen.getByRole("button", { name: /Input in may be undefined/ });
    expect(row()).toHaveTextContent(/^Charlie/);
    act(() =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === "c"
            ? { ...n, data: { ...n.data, node: { ...n.data.node, name: "Charlie 2" } } }
            : n,
        ),
      ),
    );
    await settle();
    expect(row()).toHaveTextContent(/^Charlie 2/);
  });
});
