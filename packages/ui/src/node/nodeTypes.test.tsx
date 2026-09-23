import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Position, ReactFlowProvider } from "@xyflow/react";
import { installDomStubs } from "@/primitives/testStubs";
import type { WorkflowNodeView } from "@/types";
import {
  HANDLE_ID_PATTERN,
  NODE_CARD_VARIANTS,
  cardVariantFor,
  controlOutsFor,
  handleId,
  handleOffset,
  nodeTypeLabel,
  nodeTypeTail,
  parseHandleId,
} from "./nodeUtils";
import {
  flowNodeHandles,
  flowNodeTypeFor,
  nodeTypes,
  toFlowNode,
  type FlowNodeProps,
} from "./nodeTypes";
import { triage, triageRuns } from "./fixtures";

installDomStubs();
afterEach(cleanup);

const task = (nodeType: string, category: WorkflowNodeView["category"] = "data") => ({
  kind: "task" as const,
  nodeType,
  category,
});

describe("cardVariantFor", () => {
  it("resolves canonical task ids from CONTRACTS.ts by their tail", () => {
    expect(cardVariantFor(task("flowaid.decision.choice", "decision"))).toBe("decision");
    expect(cardVariantFor(task("flowaid.decision.score", "decision"))).toBe("decision");
    expect(cardVariantFor(task("flowaid.decision.boolean", "decision"))).toBe("decision");
    expect(cardVariantFor(task("flowaid.decision.batch", "decision"))).toBe("decision");
    expect(cardVariantFor(task("flowaid.decision.confidence_gate", "decision"))).toBe("gate");
    expect(cardVariantFor(task("flowaid.decision.router", "decision"))).toBe("router");
    expect(cardVariantFor(task("flowaid.tools.http", "tool"))).toBe("http");
    expect(cardVariantFor(task("flowaid.tools.mcp", "tool"))).toBe("tool");
    expect(cardVariantFor(task("flowaid.tools.openapi", "tool"))).toBe("tool");
    expect(cardVariantFor(task("flowaid.tools.code", "tool"))).toBe("code");
    expect(cardVariantFor(task("flowaid.tools.shell", "tool"))).toBe("code");
    expect(cardVariantFor(task("flowaid.ai.generate", "generation"))).toBe("generation");
    expect(cardVariantFor(task("flowaid.ai.structured_generate", "generation"))).toBe("generation");
    expect(cardVariantFor(task("flowaid.ai.agent", "agent"))).toBe("agent");
    expect(cardVariantFor(task("flowaid.safety.guard", "safety"))).toBe("safety");
    expect(cardVariantFor(task("flowaid.state.memory", "state"))).toBe("state");
    expect(cardVariantFor(task("flowaid.retrieval.retriever", "retrieval"))).toBe("retrieval");
  });

  it("sends flowaid.data.transform to the default task card", () => {
    expect(cardVariantFor(task("flowaid.data.transform"))).toBe("default");
  });

  it("maps structural kinds before looking at the type id", () => {
    const base = { category: "flow" as const };
    expect(cardVariantFor({ ...base, kind: "input" })).toBe("start");
    expect(cardVariantFor({ ...base, kind: "output" })).toBe("end");
    expect(cardVariantFor({ ...base, kind: "branch" })).toBe("branch");
    expect(cardVariantFor({ ...base, kind: "join" })).toBe("join");
    expect(cardVariantFor({ ...base, kind: "loop" })).toBe("container");
    expect(cardVariantFor({ ...base, kind: "foreach" })).toBe("container");
    expect(cardVariantFor({ ...base, kind: "subflow" })).toBe("subflow");
    expect(cardVariantFor({ ...base, kind: "wait" })).toBe("wait");
    expect(cardVariantFor({ ...base, kind: "human", category: "human" })).toBe("human");
    expect(cardVariantFor({ ...base, kind: "note" })).toBe("note");
  });

  it("falls back to the manifest (decision kind, then category), then the node category", () => {
    const community = task("@community/slack.post_message", "tool");
    expect(nodeTypeTail(community.nodeType)).toBe("post_message");
    expect(cardVariantFor(community)).toBe("tool");
    expect(cardVariantFor(community, { metadata: { category: "retrieval" } })).toBe("retrieval");
    expect(
      cardVariantFor(task("@acme/vote.consensus", "data"), {
        metadata: { category: "decision" },
        decision: { kind: "router" },
      }),
    ).toBe("router");
    expect(
      cardVariantFor(task("@acme/vote.consensus", "data"), {
        metadata: { category: "decision" },
        decision: { kind: "consensus" },
      }),
    ).toBe("decision");
    expect(cardVariantFor(task("@acme/dev.echo", "developer"))).toBe("code");
    expect(cardVariantFor({ kind: "task", category: "data" })).toBe("default");
  });

  it("labels the header with the last segment of the type id, else the kind", () => {
    expect(nodeTypeLabel({ kind: "task", nodeType: "flowaid.decision.score" })).toBe("score");
    expect(nodeTypeLabel({ kind: "join" })).toBe("join");
  });

  it("has a card for every variant through the three xyflow node types", () => {
    for (const variant of NODE_CARD_VARIANTS)
      expect(nodeTypes[flowNodeTypeFor(variant)]).toBeTypeOf("object");
    expect(Object.keys(nodeTypes).sort()).toEqual(["container", "flowaid", "note"]);
  });
});

describe("handle ids", () => {
  it("builds and parses the four forms", () => {
    expect(handleId("out", "reply")).toBe("out:reply");
    expect(handleId("in", "ticket")).toBe("in:ticket");
    expect(handleId("ctl", "done")).toBe("ctl:done");
    expect(handleId("ctl-in")).toBe("ctl-in");
    expect(parseHandleId("out:reply")).toEqual({ kind: "out", port: "reply" });
    expect(parseHandleId("ctl-in")).toEqual({ kind: "ctl-in" });
    expect(parseHandleId("reply")).toBeUndefined();
    expect(parseHandleId("out:Reply")).toBeUndefined();
    expect(parseHandleId(null)).toBeUndefined();
  });

  it("gives every kind its default control-outs", () => {
    expect(controlOutsFor({}, "default").map((c) => c.id)).toEqual(["done"]);
    expect(controlOutsFor({}, "branch").map((c) => c.id)).toEqual(["true", "false"]);
    expect(controlOutsFor({}, "human").map((c) => c.id)).toEqual(["approved", "rejected"]);
    expect(controlOutsFor({}, "end")).toEqual([]);
    expect(controlOutsFor({}, "note")).toEqual([]);
    expect(
      controlOutsFor({ routes: [{ id: "a", label: "a" }] }, "decision").map((c) => c.id),
    ).toEqual(["a"]);
  });
});

describe("toFlowNode", () => {
  it("builds a typed xyflow node with the variant and prefixed handles", () => {
    const node = toFlowNode(triage.draft, { x: 10, y: 20 }, triageRuns.draft, {
      stream: { text: "Hi", outputTokens: 1 },
    });
    expect(node.id).toBe("draft");
    expect(node.type).toBe("flowaid");
    expect(node.data.variant).toBe("generation");
    expect(node.position).toEqual({ x: 10, y: 20 });
    expect(node.data.node).toBe(triage.draft);
    expect(node.data.run).toBe(triageRuns.draft);
    expect(node.data.extras?.stream?.outputTokens).toBe(1);
    expect(node.ariaLabel).toBe("Draft reply (flowaid.ai.generate)");
    expect(node.handles).toEqual([
      { id: "ctl-in", type: "target", position: "top", x: 10, y: -4, width: 8, height: 8 },
      {
        id: "in:in",
        type: "target",
        position: "left",
        x: -4,
        y: handleOffset(0) - 4,
        width: 8,
        height: 8,
      },
      {
        id: "ctl:done",
        type: "source",
        position: "right",
        x: 228,
        y: handleOffset(0) - 4,
        width: 8,
        height: 8,
      },
      {
        id: "out:out",
        type: "source",
        position: "right",
        x: 228,
        y: handleOffset(1) - 4,
        width: 8,
        height: 8,
      },
    ]);
  });

  it("stacks ports, uses routes as control-outs and gives loops and notes their own node types", () => {
    const multi = {
      ...triage.draft,
      inputs: [...triage.draft.inputs, { id: "ctx", label: "context", type: "any" }],
    };
    const handles = flowNodeHandles(multi);
    expect(handles.filter((h) => h.position === Position.Left).map((h) => h.y)).toEqual([
      handleOffset(0) - 4,
      handleOffset(1) - 4,
    ]);

    const router = flowNodeHandles(triage.router);
    expect(router.filter((h) => h.type === "source").map((h) => h.id)).toEqual([
      "ctl:billing",
      "ctl:technical",
      "ctl:account",
      "ctl:other",
    ]);
    expect(
      flowNodeHandles(triage.gate)
        .filter((h) => h.type === "source")
        .map((h) => h.id),
    ).toEqual(["ctl:pass", "ctl:review", "ctl:fail"]);
    expect(
      flowNodeHandles(triage.approve)
        .filter((h) => h.id?.startsWith("ctl:"))
        .map((h) => h.id),
    ).toEqual(["ctl:approved", "ctl:rejected"]);
    expect(
      flowNodeHandles(triage.join)
        .filter((h) => h.id?.startsWith("ctl:"))
        .map((h) => h.id),
    ).toEqual(["ctl:done", "ctl:timeout"]);
    expect(
      flowNodeHandles(triage.wait)
        .filter((h) => h.id?.startsWith("ctl:"))
        .map((h) => h.id),
    ).toEqual(["ctl:done", "ctl:timeout"]);
    expect(flowNodeHandles(triage.start).map((h) => h.id)).toEqual(["ctl:done", "out:out"]);
    expect(flowNodeHandles(triage.end).map((h) => h.id)).toEqual(["ctl-in", "in:in"]);
    expect(flowNodeHandles(triage.note)).toEqual([]);

    expect(toFlowNode(triage.loop, { x: 0, y: 0 }).type).toBe("container");
    const note = toFlowNode(triage.note, { x: 0, y: 0 });
    expect(note.type).toBe("note");
    expect(note.connectable).toBe(false);

    const all = Object.values(triage).flatMap((n) => flowNodeHandles(n));
    for (const h of all) expect(h.id).toMatch(HANDLE_ID_PATTERN);
  });

  it("refines the variant from a manifest", () => {
    const node: WorkflowNodeView = { ...triage.parse, nodeType: "@acme/crm.lookup" };
    expect(toFlowNode(node, { x: 0, y: 0 }).data.variant).toBe("default");
    const flow = toFlowNode(node, { x: 0, y: 0 }, undefined, undefined, {
      metadata: { category: "retrieval" },
    });
    expect(flow.data.variant).toBe("retrieval");
    expect(flow.data.manifest).toEqual({ metadata: { category: "retrieval" } });
  });

  it("omits run, extras and manifest keys when absent", () => {
    const node = toFlowNode(triage.intent, { x: 0, y: 0 });
    expect(Object.keys(node.data)).toEqual(["node", "variant"]);
  });

  function props(flow: ReturnType<typeof toFlowNode>, selected = false): FlowNodeProps {
    return {
      id: flow.id,
      data: flow.data,
      type: flow.type ?? "flowaid",
      selected,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    };
  }

  it("renders the decision card through the flowaid node type with selection", () => {
    const Renderer = nodeTypes.flowaid;
    const flow = toFlowNode(triage.intent, { x: 0, y: 0 }, triageRuns.intent);
    const { container } = render(
      <ReactFlowProvider>
        <Renderer {...props(flow, true)} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(container.querySelector(".fa-node")).toHaveAttribute("data-selected", "true");
    expect(container.querySelector("[data-decision-kind]")).not.toBeNull();
  });

  it("dispatches join, wait and note nodes to their cards", () => {
    const cases = [
      { node: triage.join, run: triageRuns.join, selector: "[data-join-mode='all']" },
      { node: triage.wait, run: triageRuns.waitWaiting, selector: "[data-wait='event']" },
      { node: triage.note, run: undefined, selector: ".fa-note" },
    ];
    for (const c of cases) {
      const flow = toFlowNode(c.node, { x: 0, y: 0 }, c.run);
      const Renderer = nodeTypes[flow.type ?? "flowaid"];
      const { container, unmount } = render(
        <ReactFlowProvider>
          <Renderer {...props(flow)} />
        </ReactFlowProvider>,
      );
      expect(container.querySelector(c.selector), c.node.id).not.toBeNull();
      unmount();
    }
  });
});
