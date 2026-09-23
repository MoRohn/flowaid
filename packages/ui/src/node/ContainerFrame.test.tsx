import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { foldRunEvents } from "@/lib/adapters";
import { installDomStubs } from "@/primitives/testStubs";
import type { RunView, WorkflowNodeView } from "@/types";
import {
  CONTAINER_DEFAULT_HEIGHT,
  CONTAINER_DEFAULT_WIDTH,
  ContainerFrame,
} from "./ContainerFrame";
import { orderParentsFirst, toFlowNode } from "./nodeTypes";
import { researchAgentEvents, researchAgentLayout, researchAgentNodes } from "./researchAgent";

installDomStubs();
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

function latestRun(run: RunView, nodeId: string) {
  return run.nodeRuns.filter((r) => r.nodeId === nodeId).at(-1);
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

describe("toFlowNode for containers", () => {
  it("gives a node with `parent` its parentId and extent 'parent', and sizes the frame from the layout", () => {
    const child = toFlowNode(node("planner"), { x: 24, y: 64 });
    expect(child.parentId).toBe("research");
    expect(child.extent).toBe("parent");
    expect(child.position).toEqual({ x: 24, y: 64 });

    const frame = toFlowNode(node("research"), { x: 260, y: 220, w: 900, h: 420 });
    expect(frame.type).toBe("container");
    expect(frame.parentId).toBeUndefined();
    expect(frame.extent).toBeUndefined();
    expect([frame.width, frame.height]).toEqual([900, 420]);
    expect(frame.dragHandle).toBe(".fa-frame-drag");

    const nested = toFlowNode(node("search_all"), { x: 0, y: 0 });
    expect([nested.type, nested.parentId, nested.extent]).toEqual([
      "container",
      "research",
      "parent",
    ]);
    expect([nested.width, nested.height]).toEqual([
      CONTAINER_DEFAULT_WIDTH,
      CONTAINER_DEFAULT_HEIGHT,
    ]);

    const top = toFlowNode(node("start"), { x: 0, y: 0 });
    expect(top.parentId).toBeUndefined();
    expect(top.extent).toBeUndefined();
  });

  it("orders every container before the nodes inside it", () => {
    const nodes = researchAgentNodes.map((n) => toFlowNode(n, { x: 0, y: 0 }));
    const reversed = orderParentsFirst([...nodes].reverse());
    const index = new Map(reversed.map((n, i) => [n.id, i]));
    for (const n of reversed) {
      if (n.parentId === undefined) continue;
      expect(index.get(n.parentId), `${n.parentId} before ${n.id}`).toBeLessThan(
        index.get(n.id) ?? -1,
      );
    }
    expect(reversed).toHaveLength(nodes.length);
  });
});

describe("iteration badge and stepper", () => {
  it("follows the folded LOOP_ITERATION_* and FOREACH_ITEM_COMPLETED events", () => {
    const research = node("research");
    const searchAll = node("search_all");
    const at = (count: number) => runFrom(EVENTS.slice(0, count));

    const first = at(afterNth("LOOP_ITERATION_STARTED", 1));
    const { rerender } = render(
      <ContainerFrame node={research} run={latestRun(first, "research")} />,
    );
    expect(screen.getByLabelText("iteration 1 of 5")).toHaveTextContent("1/5");

    const second = at(afterNth("LOOP_ITERATION_STARTED", 2));
    rerender(<ContainerFrame node={research} run={latestRun(second, "research")} />);
    expect(screen.getByLabelText("iteration 2 of 5")).toHaveTextContent("2/5");

    const all = runFrom(EVENTS);
    rerender(<ContainerFrame node={research} run={latestRun(all, "research")} />);
    expect(screen.getByLabelText("iteration 3 of 5")).toHaveTextContent("3/5");

    // The foreach of the third round: 4 items planned, 3 finished so far.
    const oneItem = at(afterNth("FOREACH_ITEM_COMPLETED", 6));
    rerender(<ContainerFrame node={searchAll} run={latestRun(oneItem, "search_all")} />);
    expect(screen.getByLabelText("1 of 4 items done")).toHaveTextContent("1/4");
    rerender(<ContainerFrame node={searchAll} run={latestRun(all, "search_all")} />);
    expect(screen.getByLabelText("3 of 4 items done")).toHaveTextContent("3/4");
  });

  it("steps through the iterations and reports the one the inspector should show", () => {
    const onSelectIteration = vi.fn();
    const run = runFrom(EVENTS);
    render(
      <ContainerFrame
        node={node("research")}
        run={latestRun(run, "research")}
        onSelectIteration={onSelectIteration}
      />,
    );
    const stepper = screen.getByRole("group", { name: "Iteration shown in the inspector" });
    expect(within(stepper).getByText("#3")).toBeInTheDocument();
    expect(within(stepper).getByRole("button", { name: "Next iteration" })).toBeDisabled();
    fireEvent.click(within(stepper).getByRole("button", { name: "Previous iteration" }));
    expect(onSelectIteration).toHaveBeenLastCalledWith("research", {
      index: 1,
      scope: "research#1",
      status: "completed",
    });
    expect(within(stepper).getByText("#2")).toBeInTheDocument();
    fireEvent.click(within(stepper).getByRole("button", { name: "Previous iteration" }));
    expect(onSelectIteration).toHaveBeenLastCalledWith("research", {
      index: 0,
      scope: "research#0",
      status: "completed",
    });
    expect(within(stepper).getByRole("button", { name: "Previous iteration" })).toBeDisabled();
  });

  it("shows the bounds in the header and no badge before the run starts", () => {
    render(<ContainerFrame node={node("research")} />);
    const header = document.querySelector(".fa-frame-header");
    expect(header?.textContent).toContain("max5 iterations");
    expect(header?.textContent).toContain("timeout8 m 00 s");
    expect(header?.textContent).toContain("budget");
    expect(screen.queryByRole("group", { name: "Iteration shown in the inspector" })).toBeNull();
    expect(document.querySelector("[data-iteration-badge]")).toBeNull();
  });
});

describe("researchAgentLayout", () => {
  it("places every body node inside its frame, below the header", () => {
    for (const n of researchAgentNodes) {
      if (n.parent === undefined) continue;
      const frame = researchAgentLayout.nodes[n.parent];
      const own = researchAgentLayout.nodes[n.id];
      expect(frame?.w, n.parent).toBeDefined();
      if (!frame?.w || !frame.h || !own) continue;
      expect(own.x).toBeGreaterThanOrEqual(0);
      expect(own.y).toBeGreaterThanOrEqual(40);
      expect(own.x + (own.w ?? 232)).toBeLessThanOrEqual(frame.w);
      expect(own.y).toBeLessThan(frame.h);
    }
  });
});
