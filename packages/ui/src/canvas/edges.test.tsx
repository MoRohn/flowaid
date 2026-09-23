import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { captureConsole, installLayoutStubs } from "@/node/flowTestStubs";
import { installDomStubs } from "@/primitives/testStubs";
import { controlEdgeLabel, controlEdgeOpacity, controlEdgeStroke } from "./ControlEdge";
import { dataEdgeTooltip, summarizeSchema } from "./DataEdge";
import { edgeTypeFor, edgeTypes, toCanvasEdge } from "./edgeTypes";
import { FlowCanvas, decorateCanvasEdge } from "./FlowCanvas";
import { applyAutoLayout } from "./autoLayout";
import {
  DECISION_SCHEMA,
  SAMPLE_EDGES,
  TICKET_SCHEMA,
  buildSampleRun,
  toCanvasEdges,
  toCanvasNodes,
} from "./sampleWorkflow";
import type { CanvasEdge } from "./types";

installDomStubs();
let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = installLayoutStubs();
});
afterAll(() => restoreLayout());
afterEach(cleanup);

describe("edge type selection", () => {
  it("registers exactly the control and data edge types", () => {
    expect(Object.keys(edgeTypes).sort()).toEqual(["control", "data"]);
  });

  it("uses the explicit kind, else the handle ids", () => {
    expect(edgeTypeFor({ kind: "data", sourceHandle: "ctl:done" })).toBe("data");
    expect(edgeTypeFor({ type: "control" })).toBe("control");
    expect(edgeTypeFor({ sourceHandle: "ctl:pass", targetHandle: "ctl-in" })).toBe("control");
    expect(edgeTypeFor({ targetHandle: "ctl-in" })).toBe("control");
    expect(edgeTypeFor({ sourceHandle: "out:text", targetHandle: "in:text" })).toBe("data");
  });

  it("maps control edges to `control` with ctl-in and the route of the source port", () => {
    const e = toCanvasEdge({
      id: "c1",
      source: "gate",
      sourceHandle: "ctl:review",
      target: "approve",
    });
    expect(e).toEqual({
      id: "c1",
      type: "control",
      source: "gate",
      sourceHandle: "ctl:review",
      target: "approve",
      targetHandle: "ctl-in",
      data: { route: "review" },
    });
    const weighted = toCanvasEdge({
      id: "c2",
      kind: "control",
      source: "r",
      target: "t",
      route: "a",
      probability: 0.4,
      label: "a 0.40",
    });
    expect(weighted).toMatchObject({
      type: "control",
      sourceHandle: "ctl:a",
      data: { route: "a", probability: 0.4, label: "a 0.40" },
    });
  });

  it("maps ref data edges to selectable `data` edges and implicit ones to dotted, non-selectable edges", () => {
    const ref = toCanvasEdge({
      id: "d1",
      source: "a",
      sourceHandle: "out:x",
      target: "b",
      targetHandle: "in:y",
    });
    expect(ref).toMatchObject({ type: "data", data: { via: "ref" } });
    expect(ref.selectable).toBeUndefined();
    for (const via of ["template", "expr", "hoisted"] as const) {
      const implicit = toCanvasEdge({
        id: `d-${via}`,
        source: "a",
        sourceHandle: "out:x",
        target: "b",
        targetHandle: "in:y",
        via,
        optional: true,
      });
      expect(implicit).toMatchObject({
        type: "data",
        selectable: false,
        focusable: false,
        deletable: false,
        data: { via, optional: true },
      });
    }
  });

  it("decorates untyped canvas edges with their type, run state and category", () => {
    const untyped: CanvasEdge = {
      id: "x",
      source: "a",
      sourceHandle: "out:v",
      target: "b",
      targetHandle: "in:v",
      data: { via: "template" },
    };
    const decorated = decorateCanvasEdge(untyped, "taken", "tool");
    expect(decorated).toMatchObject({
      type: "data",
      selectable: false,
      data: { via: "template", state: "taken", category: "tool" },
    });
    const control: CanvasEdge = {
      id: "y",
      source: "a",
      sourceHandle: "ctl:done",
      target: "b",
      targetHandle: "ctl-in",
    };
    expect(decorateCanvasEdge(control, "not-taken", undefined)).toMatchObject({
      type: "control",
      data: { state: "not-taken" },
    });
    const same = decorateCanvasEdge(decorated, "taken", "tool");
    expect(same).toBe(decorated);
  });
});

describe("edge styling helpers", () => {
  it("tints fired control edges ok and fades pruned ones", () => {
    expect(controlEdgeStroke("taken")).toBe("var(--ok)");
    expect(controlEdgeStroke("not-taken")).toBe("var(--border-strong)");
    expect(controlEdgeOpacity("not-taken")).toBe(0.3);
    expect(controlEdgeOpacity("taken")).toBe(1);
    expect(controlEdgeLabel({ route: "done" })).toBeUndefined();
    expect(controlEdgeLabel({ route: "review" })).toBe("review");
    expect(controlEdgeLabel({ route: "review", label: "0.70 ≤ c" })).toBe("0.70 ≤ c");
  });

  it("summarises schemas for the data edge tooltip", () => {
    expect(summarizeSchema(TICKET_SCHEMA)).toBe("object {id, subject, body, customer_id, …}");
    expect(summarizeSchema({ type: "array", items: { type: "string" } })).toBe("array<string>");
    expect(summarizeSchema({ type: "integer", minimum: 0 })).toBe("integer ≥ 0");
    expect(summarizeSchema({ enum: ["a", "b"] })).toBe('"a" | "b"');
    expect(summarizeSchema(undefined)).toBe("any");
    expect(
      dataEdgeTooltip(
        { via: "template", optional: true, path: "/body", schema: DECISION_SCHEMA },
        "out:response",
        "in:context",
      ),
    ).toBe("response/body → context · object {kind, value, confidence} · via template · optional");
  });
});

describe("FlowCanvas edges", () => {
  function renderSample(progress?: number) {
    const nodes = applyAutoLayout(toCanvasNodes(), SAMPLE_EDGES);
    return render(
      <div style={{ width: 1200, height: 800 }}>
        <FlowCanvas
          nodes={nodes}
          edges={toCanvasEdges()}
          onNodesChange={vi.fn()}
          onEdgesChange={vi.fn()}
          run={progress === undefined ? undefined : buildSampleRun(progress)}
          defaultShowMinimap={false}
        />
      </div>,
    );
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  it("draws control edges dashed with arrowheads, weighted router exits, and implicit data edges dotted and unselectable", async () => {
    const console = captureConsole();
    try {
      const { container } = renderSample();
      await settle();
      const edge = (id: string) => container.querySelector(`.react-flow__edge[data-id="${id}"]`);
      const control = edge("c-start-intent");
      expect(control).toHaveClass("react-flow__edge-control");
      expect(control?.querySelector(".fa-control-edge")).toHaveStyle({ strokeDasharray: "5 4" });
      expect(control?.querySelector(".fa-edge-arrow")).not.toBeNull();
      expect(edge("c-router-security")?.querySelector("[data-weighted='true']")).not.toBeNull();

      const ref = edge("d-start-intent");
      expect(ref).toHaveClass("react-flow__edge-data");
      expect(ref).toHaveClass("selectable");
      expect(ref?.querySelector(".fa-data-edge")).toHaveAttribute("data-implicit", "false");
      expect(ref?.querySelector("title")?.textContent).toBe(
        "ticket → state · object {id, subject, body, customer_id, …}",
      );

      const implicit = edge("d-incident-draft");
      expect(implicit).toHaveClass("react-flow__edge-data");
      expect(implicit).not.toHaveClass("selectable");
      expect(implicit?.querySelector(".fa-data-edge")).toHaveAttribute("data-implicit", "true");
      expect(implicit?.querySelector(".fa-edge-path")).toHaveStyle({ strokeDasharray: "0.5 4" });
      expect(console.messages().filter((m) => m.includes("React Flow"))).toEqual([]);
    } finally {
      console.restore();
    }
  });

  it("tints fired control edges and fades pruned ones during a run", async () => {
    const { container } = renderSample(6);
    await settle();
    const path = (id: string) =>
      container.querySelector(`.react-flow__edge[data-id="${id}"] .fa-edge-path`);
    expect(
      container.querySelector(`.react-flow__edge[data-id="c-start-intent"] .fa-control-edge`),
    ).toHaveAttribute("data-state", "taken");
    expect(path("c-start-intent")?.getAttribute("style")).toContain("stroke: var(--ok)");
    expect(path("c-router-billing")).toHaveStyle({ opacity: "0.3" });
    expect(
      container.querySelector(`.react-flow__edge[data-id="c-incident-draft"] .fa-control-edge`),
    ).toHaveAttribute("data-state", "active");
  });

  it("names edge label chips as route notes", async () => {
    const { container } = renderSample();
    await settle();
    const notes = Array.from(container.querySelectorAll(".fa-edge-label"));
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.tagName).toBe("SPAN");
      expect(note).toHaveAttribute("role", "note");
      expect(note.getAttribute("aria-label")).toBe(`route ${note.textContent ?? ""}`);
    }
  });

  it("renders only prefixed handle ids", async () => {
    const { container } = renderSample();
    await settle();
    const ids = Array.from(container.querySelectorAll("[data-handleid]")).map((h) =>
      h.getAttribute("data-handleid"),
    );
    expect(ids.length).toBeGreaterThan(50);
    for (const id of ids) expect(id).toMatch(/^(out|in|ctl):[a-z][a-z0-9_]*$|^ctl-in$/);
  });
});
