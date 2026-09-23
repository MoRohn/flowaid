/**
 * Control-flow semantics on small purpose-built workflows (ARCHITECTURE.md §2.5, §4.3, §5.10):
 * branch merges, AND after a branch, nested containers with hoisting, race private subgraphs and
 * the emitted shape of every node kind.
 */
import type { CompileResult, ExecutionPlan } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import { fixtureCatalog } from "./test/support.js";

type Doc = Record<string, unknown>;
const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ref = (node: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});
const expr = (source: string) => ({ kind: "expr", source });
const t = (id: string, source: string, extra: Doc = {}): Doc => ({
  id,
  kind: "task",
  name: id,
  type: "flowaid.data.transform",
  typeVersion: "1.0.0",
  config: { expr: source },
  ...extra,
});
/** An output node returning `{ v: binding }` (workflow outputs are an object). */
const output = (id: string, binding: unknown, extra: Doc = {}): Doc => ({
  id,
  kind: "output",
  name: id,
  value: { kind: "object", fields: { v: binding } },
  ...extra,
});
const edge = (id: string, from: string, port: string, to: string) => ({
  id,
  from: { node: from, port },
  to: { node: to },
});

function workflow(nodes: Doc[], edges: Doc[] = [], extra: Doc = {}): Doc {
  return {
    $schema: "https://flowaid.dev/schemas/workflow/v1",
    id: ID,
    name: "Semantics",
    inputs: {
      type: "object",
      properties: { n: { type: "integer" }, flag: { type: "boolean" } },
      required: ["n", "flag"],
    },
    outputs: { type: "object" },
    nodes: [{ id: "start", kind: "input", name: "Start" }, ...nodes],
    edges,
    execution: { maxCostUsd: 1 },
    ...extra,
  };
}

function plan(result: CompileResult): ExecutionPlan {
  if (!result.ok)
    throw new Error(
      JSON.stringify(
        result.diagnostics.filter((d) => d.severity === "error"),
        null,
        2,
      ),
    );
  return result.plan;
}
const run = (doc: Doc) => compile(doc, { catalog: fixtureCatalog() });
const codes = (result: CompileResult) => result.diagnostics.map((d) => d.code);

const branch = {
  id: "b",
  kind: "branch",
  name: "B",
  cases: [{ port: "yes", when: "start.flag" }],
  defaultPort: "no",
};

describe("branch merge", () => {
  const doc = workflow(
    [
      branch,
      t("x", "start.n + 1"),
      t("y", "start.n - 1"),
      t("m", "1"),
      output("out", ref("m", "result")),
    ],
    [
      edge("e1", "b", "yes", "x"),
      edge("e2", "b", "no", "y"),
      edge("e3", "x", "done", "m"),
      edge("e4", "y", "done", "m"),
    ],
  );
  const p = plan(run(doc));

  it("puts both arrivals in one exclusive group (OR)", () => {
    expect(p.nodes.m?.controlIn.map((c) => c.group)).toEqual([0, 0]);
  });

  it("collapses a merge that covers every outcome of the branch to 'always'", () => {
    expect(p.nodes.x?.guard).toEqual([[{ node: "b", port: "yes" }]]);
    expect(p.nodes.y?.guard).toEqual([[{ node: "b", port: "no" }]]);
    expect(p.nodes.m?.guard).toEqual([[]]);
  });

  it("orders the scope topologically with id tie-breaks", () => {
    expect(p.scopes[""]?.order).toEqual(["start", "b", "x", "y", "m", "out"]);
  });
});

describe("AND after a branch", () => {
  const result = run(
    workflow(
      [
        branch,
        t("x", "start.n + 1"),
        t("z", "start.n * 2"),
        t("m", "1"),
        output("out", ref("m", "result")),
      ],
      [edge("e1", "b", "yes", "x"), edge("e2", "x", "done", "m"), edge("e3", "z", "done", "m")],
    ),
  );

  it("waits for both independent activations and says so", () => {
    const p = plan(result);
    expect(p.nodes.m?.controlIn.map((c) => c.group)).toEqual([0, 1]);
    expect(p.nodes.m?.guard).toEqual([[{ node: "b", port: "yes" }]]);
    expect(codes(result)).toContain("I_CONTROL_AND");
  });
});

describe("nested containers", () => {
  const doc = workflow([
    {
      id: "outer",
      kind: "loop",
      name: "Outer",
      carrySchema: { type: "object", properties: { i: { type: "integer" } } },
      carry: { initial: { i: 0 }, next: { i: expr("$scope.carry.i + 1") } },
      result: { last: ref("each", "results") },
      exitWhen: "$scope.carry.i >= 2",
      bounds: { maxIterations: 5, timeoutMs: 60000 },
    },
    {
      id: "each",
      kind: "foreach",
      name: "Each",
      parent: "outer",
      items: expr("[1, 2, 3]"),
      collect: ref("inner", "result"),
      bounds: { maxIterations: 10 },
    },
    t("inner", "$scope.item + start.n", { parent: "each" }),
    output("out", ref("outer", "result", "/last")),
  ]);
  const p = plan(run(doc));

  it("builds one scope per container with its parent", () => {
    expect(Object.keys(p.scopes).sort()).toEqual(["", "each", "outer"]);
    expect(p.scopes.each?.parent).toBe("outer");
    expect(p.scopes.outer?.parent).toBe("");
    expect(p.scopes.each?.entries).toEqual(["inner"]);
  });

  it("hoists an outward read from the innermost body onto the outermost container", () => {
    expect(p.nodes.outer?.dataIn).toContainEqual({
      from: { node: "start", port: "n" },
      to: { node: "outer", port: "body" },
      optional: false,
      via: "hoisted",
    });
    expect(p.nodes.inner?.dataIn[0]?.via).toBe("hoisted");
  });

  it("types $scope.item from the items binding and the collected results", () => {
    const each = p.nodes.each?.op;
    expect(each?.kind).toBe("foreach");
    if (each?.kind !== "foreach") return;
    expect(each.itemSchema).toEqual({ type: "integer" });
    // inner's result has no declared schema (Transform without `output`), so items are untyped.
    expect(p.nodes.each?.outputs.results).toEqual({ type: "array", items: {} });
  });

  it("emits the loop's body scope and bounds", () => {
    const outer = p.nodes.outer?.op;
    expect(outer?.kind === "loop" && outer.bodyScope).toBe("outer");
    expect(outer?.kind === "loop" && outer.exitWhen !== null).toBe(true);
    expect(p.nodes.outer?.controlOut).toEqual(["done", "exhausted"]);
  });
});

describe("race joins", () => {
  const doc = workflow(
    [
      t("fast", "start.n"),
      t("slow_a", "start.n * 2"),
      t("slow_b", "slow_a.result + 1"),
      {
        id: "race",
        kind: "join",
        name: "Race",
        mode: { type: "race" },
        inputs: { fast: ref("fast", "result"), slow: ref("slow_b", "result") },
      },
      output("out", ref("race", "values")),
    ],
    [edge("r1", "fast", "done", "race"), edge("r2", "slow_b", "done", "race")],
  );
  const result = run(doc);
  const p = plan(result);

  it("computes each input's private subgraph", () => {
    const op = p.nodes.race?.op;
    expect(op?.kind).toBe("join");
    if (op?.kind !== "join") return;
    expect(op.privateSubgraphs).toEqual({ r1: ["fast"], r2: ["slow_a", "slow_b"] });
  });

  it("types values as nullable per input and treats inputs as optional", () => {
    expect(p.nodes.race?.outputs.values).toMatchObject({
      required: ["fast", "slow"],
      additionalProperties: false,
    });
    expect(p.nodes.race?.dataIn.every((d) => d.optional)).toBe(true);
    expect(codes(result)).not.toContain("W_NULLABLE_INPUT");
  });
});

describe("node kinds emit their operations", () => {
  const doc = workflow(
    [
      {
        id: "pause",
        kind: "wait",
        name: "Pause",
        until: { type: "event", eventName: "order.paid", timeoutMs: 60000 },
      },
      {
        id: "pick",
        kind: "human",
        name: "Pick",
        mode: {
          type: "choice",
          options: [
            { id: "red", label: "Red" },
            { id: "blue", label: "Blue" },
          ],
        },
        title: { kind: "template", source: "Pick for {{ start.n }}" },
        onExpire: "route",
        expiresInMs: 1000,
      },
      {
        id: "child",
        kind: "subflow",
        name: "Child",
        workflowId: "11111111-1111-4111-8111-111111111111",
        inputs: { n: ref("start", "n") },
      },
      output("out_red", ref("child", "output"), { outcome: "red" }),
      output("out_blue", { kind: "literal", value: {} }, { outcome: "blue" }),
    ],
    [
      edge("w0", "start", "done", "pause"),
      edge("w1", "pause", "done", "pick"),
      edge("p1", "pick", "red", "child"),
      edge("p2", "child", "done", "out_red"),
      edge("p3", "pick", "blue", "out_blue"),
    ],
  );
  const result = run(doc);
  const p = plan(result);

  it("wait fires done or timeout", () => {
    expect(p.nodes.pause?.controlOut).toEqual(["done", "timeout"]);
    expect(p.nodes.pause?.op).toEqual({
      kind: "wait",
      until: { type: "event", eventName: "order.paid", timeoutMs: 60000, payloadSchema: null },
    });
  });

  it("human choice routes one port per option plus expired", () => {
    expect(p.nodes.pick?.controlOut).toEqual(["red", "blue", "expired"]);
    expect(p.nodes.pick?.op.kind).toBe("human");
  });

  it("subflow is keyed and routes done/failed", () => {
    expect(p.nodes.child?.idempotency).toBe("keyed");
    expect(p.nodes.child?.controlOut).toEqual(["done", "failed"]);
    expect(p.subflows).toEqual([
      { node: "child", workflowId: "11111111-1111-4111-8111-111111111111", versionId: null },
    ]);
  });

  it("outputs on different human outcomes are exclusive", () => {
    expect(codes(result)).not.toContain("W_OUTPUT_AMBIGUOUS");
    expect(p.scopes[""]?.outputs).toEqual(["out_red", "out_blue"]);
  });
});

describe("disabled nodes", () => {
  it("drop out of the plan, and their defaulted readers use the default", () => {
    const result = run(
      workflow([
        t("off", "1", { disabled: true }),
        t("reader", "coalesce(off.result, 0) + start.n"),
        output("out", ref("reader", "result")),
      ]),
    );
    const p = plan(result);
    expect(p.nodes.off).toBeUndefined();
    expect(p.nodes.reader?.dataIn.map((d) => d.from.node)).toEqual(["start"]);
  });

  it("are an error for a required reader", () => {
    const result = run(
      workflow([t("off", "1", { disabled: true }), output("out", ref("off", "result"))]),
    );
    expect(codes(result)).toContain("E_REF_UNKNOWN_NODE");
  });
});
