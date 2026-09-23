import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorkflowEdgeView, WorkflowNodeView } from "@/types";
import { SAMPLE_EDGES, SAMPLE_NODES, toCanvasEdges } from "./sampleWorkflow";
import {
  checkPortSchemas,
  portSchema,
  useConnectionValidation,
  validateConnection,
} from "./useConnectionValidation";

const END_PARAMS = {
  isValid: null,
  from: null,
  fromHandle: null,
  fromPosition: null,
  fromNode: null,
  to: null,
  toHandle: null,
  toPosition: null,
  toNode: null,
  pointer: null,
} as const;

describe("portSchema / checkPortSchemas (isSubschema)", () => {
  it("prefers the port schema, else a JSON primitive type, else unconstrained", () => {
    expect(portSchema({ type: "string", schema: { type: "string", minLength: 1 } })).toEqual({
      type: "string",
      minLength: 1,
    });
    expect(portSchema({ type: "integer" })).toEqual({ type: "integer" });
    expect(portSchema({ type: "decision" })).toEqual({});
    expect(portSchema({ type: "any" })).toEqual({});
  });

  it("accepts a verified subschema", () => {
    expect(
      checkPortSchemas({ label: "n", type: "integer" }, { label: "m", type: "number" }),
    ).toEqual({ ok: true, verified: true });
    expect(
      checkPortSchemas(
        { label: "tier", type: "string", schema: { enum: ["free", "pro"] } },
        { label: "plan", type: "string", schema: { type: "string" } },
      ),
    ).toEqual({ ok: true, verified: true });
  });

  it("accepts but does not verify an unconstrained source", () => {
    expect(
      checkPortSchemas(
        { label: "ticket", type: "ticket" },
        { label: "body", type: "object", schema: { type: "object" } },
      ),
    ).toEqual({
      ok: true,
      verified: false,
    });
  });

  it("rejects a mismatch with a reason naming the ports and the path", () => {
    const res = checkPortSchemas(
      {
        label: "customer",
        type: "object",
        schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      },
      {
        label: "account",
        type: "object",
        schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/^customer does not fit account at \/id: /);
  });
});

describe("validateConnection", () => {
  const byId = new Map(SAMPLE_NODES.map((n) => [n.id, n]));
  const check = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
    validateConnection({ source, sourceHandle, target, targetHandle }, byId, SAMPLE_EDGES);

  it("accepts a compatible data connection and lets it replace a ref binding", () => {
    // gate.decision is bound by a ref from safety; connecting intent replaces it.
    expect(check("intent", "out:decision", "gate", "in:decision")).toEqual({
      ok: true,
      verified: true,
    });
    expect(check("urgency", "out:decision", "intent", "in:state")).toEqual({
      ok: true,
      verified: true,
    });
  });

  it("rejects a schema mismatch with the isSubschema reason", () => {
    const res = check("urgency", "out:decision", "safety", "in:text");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/^decision does not fit reply/);
  });

  it("rejects rebinding a port bound by a template or an expression", () => {
    expect(check("start", "out:ticket", "draft", "in:context")).toEqual({
      ok: false,
      reason: "context is bound by a template binding; edit it in the inspector",
    });
    expect(check("review", "out:decision", "send", "in:body")).toEqual({
      ok: false,
      reason: "reply is bound by an expression; edit it in the inspector",
    });
  });

  it("checks control connections: port, target control-in, scope and duplicates", () => {
    expect(check("router", "ctl:security", "send", "ctl-in")).toEqual({ ok: true, verified: true });
    expect(check("router", "ctl:nope", "send", "ctl-in")).toEqual({
      ok: false,
      reason: "Router has no control-out nope",
    });
    expect(check("intent", "ctl:done", "start", "ctl-in")).toEqual({
      ok: false,
      reason: "Ticket received has no control input",
    });
    expect(check("start", "ctl:done", "intent", "ctl-in")).toEqual({
      ok: false,
      reason: "Already connected",
    });
    const scoped: WorkflowNodeView[] = [
      {
        id: "outer",
        kind: "task",
        nodeType: "flowaid.data.transform",
        category: "data",
        name: "Outer",
        inputs: [],
        outputs: [],
      },
      {
        id: "inner",
        kind: "task",
        nodeType: "flowaid.data.transform",
        category: "data",
        name: "Inner",
        parent: "loop",
        inputs: [],
        outputs: [],
      },
    ];
    expect(
      validateConnection(
        { source: "outer", sourceHandle: "ctl:done", target: "inner", targetHandle: "ctl-in" },
        new Map(scoped.map((n) => [n.id, n])),
        [],
      ),
    ).toEqual({ ok: false, reason: "Control edges cannot cross a container boundary" });
  });

  it("never mixes data and control, loops or unknown handles", () => {
    expect(check("router", "ctl:security", "send", "in:body")).toEqual({
      ok: false,
      reason: "Control-out security connects to a control input",
    });
    expect(check("intent", "out:decision", "router", "ctl-in")).toEqual({
      ok: false,
      reason: "Output decision connects to a data input",
    });
    expect(check("draft", "out:text", "draft", "in:context")).toEqual({
      ok: false,
      reason: "A node cannot connect to itself",
    });
    expect(check("draft", "text", "safety", "in:text")).toEqual({
      ok: false,
      reason: "Unknown handle",
    });
    expect(check("draft", "out:nope", "safety", "in:text")).toEqual({
      ok: false,
      reason: "Draft reply has no output nope",
    });
    expect(check("draft", "out:text", "safety", "in:text")).toEqual({
      ok: false,
      reason: "Already connected",
    });
  });
});

describe("useConnectionValidation", () => {
  const setup = (edges: ReadonlyArray<WorkflowEdgeView> = SAMPLE_EDGES) =>
    renderHook(() => useConnectionValidation(SAMPLE_NODES, edges));

  it("backs React Flow's isValidConnection, also with canvas edges", () => {
    const { result } = setup();
    expect(
      result.current.isValidConnection({
        source: "intent",
        sourceHandle: "out:decision",
        target: "gate",
        targetHandle: "in:decision",
      }),
    ).toBe(true);
    expect(
      result.current.isValidConnection({
        source: "urgency",
        sourceHandle: "out:decision",
        target: "safety",
        targetHandle: "in:text",
      }),
    ).toBe(false);
    const canvas = renderHook(() => useConnectionValidation(SAMPLE_NODES, toCanvasEdges()));
    expect(
      canvas.result.current.checkConnection({
        source: "start",
        sourceHandle: "out:ticket",
        target: "draft",
        targetHandle: "in:context",
      }).ok,
    ).toBe(false);
  });

  it("computes compatible handles and reasons for a dragged data output", () => {
    const { result } = setup();
    expect(result.current.compatibleHandles.size).toBe(0);
    act(() => {
      result.current.onConnectStart(new MouseEvent("mousedown"), {
        nodeId: "urgency",
        handleId: "out:decision",
        handleType: "source",
      });
    });
    expect(result.current.pending).toEqual({
      nodeId: "urgency",
      handleId: "out:decision",
      handleType: "source",
    });
    const compatible = result.current.compatibleHandles;
    expect(compatible.get("gate")).toEqual(["in:decision"]);
    expect(compatible.get("router")).toEqual(["in:decision"]);
    expect(compatible.get("draft")).toEqual(["in:ticket"]);
    expect(compatible.get("safety")).toEqual([]);
    expect(compatible.has("urgency")).toBe(false);
    const reasons = result.current.handleReasons;
    expect(reasons.get("safety")?.["in:text"]).toMatch(/does not fit reply/);
    expect(reasons.get("draft")?.["in:context"]).toBe(
      "context is bound by a template binding; edit it in the inspector",
    );
    // The other family (control-in) is dimmed without a reason.
    expect(reasons.get("gate")?.["ctl-in"]).toBeUndefined();
    act(() => {
      result.current.onConnectEnd(new MouseEvent("mouseup"), END_PARAMS);
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.compatibleHandles.size).toBe(0);
  });

  it("computes compatible control-outs for a dragged control-in", () => {
    const { result } = setup();
    act(() => {
      result.current.onConnectStart(new MouseEvent("mousedown"), {
        nodeId: "account",
        handleId: "ctl-in",
        handleType: "target",
      });
    });
    const router = result.current.compatibleHandles.get("router") ?? [];
    expect(router).toContain("ctl:security");
    expect(router).not.toContain("ctl:billing"); // already connected
    expect(router).not.toContain("out:decision");
    expect(result.current.compatibleHandles.get("start")).toEqual(["ctl:done"]);
    expect(result.current.handleReasons.get("router")?.["ctl:billing"]).toBe("Already connected");
  });

  it("exposes the schema behind a data handle", () => {
    const { result } = setup();
    expect(result.current.portSchemaOf("draft", "out:text")).toEqual({ type: "string" });
    expect(result.current.portSchemaOf("draft", "ctl:done")).toBeUndefined();
  });
});
