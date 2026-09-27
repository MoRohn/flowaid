/** RFC-0006: a wait node's event correlation is compiled, type-checked and emitted into the plan. */
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import { fixtureCatalog } from "./test/support.js";

const ID = "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09";

function definition(correlation?: unknown) {
  return {
    $schema: "https://flowaid.dev/schemas/workflow/v1",
    id: ID,
    name: "correlated",
    inputs: {
      type: "object",
      properties: { order: { type: "string" }, meta: { type: "object" } },
      required: ["order", "meta"],
    },
    outputs: { type: "object" },
    nodes: [
      { id: "start", kind: "input", name: "Start" },
      {
        id: "w",
        kind: "wait",
        name: "Paid",
        until: {
          type: "event",
          eventName: "order.paid",
          timeoutMs: 60_000,
          ...(correlation !== undefined ? { correlation } : {}),
        },
      },
      { id: "end", kind: "output", name: "End", value: { kind: "literal", value: {} } },
    ],
    edges: [
      { id: "e1", from: { node: "start", port: "done" }, to: { node: "w" } },
      { id: "e2", from: { node: "w", port: "done" }, to: { node: "end" } },
    ],
  };
}

const ref = (port: string) => ({ kind: "ref", ref: { kind: "port", node: "start", port } });

describe("wait event correlation", () => {
  it("emits the compiled correlation into the plan", () => {
    const r = compile(definition(ref("order")), { catalog: fixtureCatalog() });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    if (!r.ok) throw new Error("expected a plan");
    const op = r.plan.nodes.w?.op;
    expect(op?.kind === "wait" && op.until.type === "event" && op.until.correlation).toBeTruthy();
    expect(r.plan.nodes.w?.dataIn.map((d) => `${d.from.node}.${d.from.port}`)).toContain(
      "start.order",
    );
  });

  it("leaves the plan unchanged without a correlation", () => {
    const r = compile(definition(), { catalog: fixtureCatalog() });
    if (!r.ok) throw new Error("expected a plan");
    const op = r.plan.nodes.w?.op;
    expect(op?.kind === "wait" && op.until.type === "event" && "correlation" in op.until).toBe(
      false,
    );
  });

  it("rejects a correlation that is not a scalar", () => {
    const r = compile(definition(ref("meta")), { catalog: fixtureCatalog() });
    expect(r.diagnostics.map((d) => d.code)).toContain("E_TYPE_MISMATCH");
  });
});
