import { describe, expect, it } from "vitest";
import { applyJsonPatch, type JsonValue } from "@flowaid/shared";
import { DiagnosticSchema, type WorkflowDefinition } from "@flowaid/workflow-core";
import { optimize } from "./optimize.js";
import { suggestionDiagnostics } from "./suggestions.js";
import {
  compileDef,
  define,
  manifests,
  modelCatalog,
  planOf,
  ref,
  triage,
} from "./test/fixtures.js";
import type { NodeStats } from "./types.js";

const stat = (nodeId: string, over: Partial<NodeStats> = {}): NodeStats => ({
  nodeId,
  runs: 60,
  avgCostUsd: 0.001,
  avgLatencyMs: 300,
  avgInputTokens: 400,
  avgOutputTokens: 5,
  distinctInputs: 60,
  ...over,
});

function run(
  def: WorkflowDefinition,
  stats: NodeStats[],
  evaluation?: { passRate: number; cases: number },
) {
  return optimize({
    definition: def,
    plan: planOf(def),
    stats,
    catalog: modelCatalog,
    manifests,
    ...(evaluation ? { evaluation } : {}),
  });
}

function apply(def: WorkflowDefinition, fix: readonly unknown[]): WorkflowDefinition {
  return applyJsonPatch(def as unknown as JsonValue, fix as never) as unknown as WorkflowDefinition;
}

const errors = (def: unknown) => compileDef(def).diagnostics.filter((d) => d.severity === "error");

describe("optimize: cheaper_model", () => {
  const def = triage();
  const reply = stat("reply", { avgInputTokens: 2000, avgOutputTokens: 600, avgCostUsd: 0.04 });

  it("proposes a cheaper model of the same provider for the node's token mix, with a fix that compiles", () => {
    const s = run(def, [reply]).find((x) => x.kind === "cheaper_model");
    expect(s).toBeDefined();
    expect(s?.nodeIds).toEqual(["reply"]);
    expect(s?.estimatedSavingsUsdPerRun).toBeGreaterThan(0.04 * 0.3);
    expect(s?.estimatedSavingsUsdPerRun).toBeLessThan(0.04);
    const next = apply(def, s?.fix ?? []);
    const node = next.nodes.find((n) => n.id === "reply");
    const model =
      node?.kind === "task" ? (node.config.model as { provider: string; model: string }) : null;
    expect(model?.provider).toBe("anthropic");
    expect(model?.model).not.toBe("claude-opus-5-5");
    expect(errors(next)).toEqual([]);
  });

  it("weighs risk with the linked evaluation set", () => {
    const plain = run(def, [reply]).find((x) => x.kind === "cheaper_model");
    const strong = run(def, [reply], { passRate: 0.99, cases: 40 }).find(
      (x) => x.kind === "cheaper_model",
    );
    const weak = run(def, [reply], { passRate: 0.8, cases: 40 }).find(
      (x) => x.kind === "cheaper_model",
    );
    const order = { low: 0, medium: 1, high: 2 };
    expect(order[strong?.risk ?? "high"]).toBeLessThan(order[plain?.risk ?? "low"]);
    expect(weak?.risk).toBe("high");
  });

  it("stays quiet without enough runs or on the cheapest model", () => {
    expect(run(def, [{ ...reply, runs: 5 }]).some((x) => x.kind === "cheaper_model")).toBe(false);
    const cheapest = modelCatalog
      .list({ provider: "anthropic", kind: "chat" })
      .filter((m) => m.pricing)
      .sort((a, b) => (a.pricing?.inputPerMTok ?? 0) - (b.pricing?.inputPerMTok ?? 0))[0];
    const onCheapest = triage({ provider: "anthropic", model: cheapest?.model ?? "" });
    expect(run(onCheapest, [reply]).some((x) => x.kind === "cheaper_model")).toBe(false);
  });
});

describe("optimize: batch_decisions", () => {
  const def = triage();
  const stats = [
    stat("is_refund", { avgLatencyMs: 250 }),
    stat("is_urgent", { avgLatencyMs: 350 }),
  ];

  it("batches independent decisions over one state and rewrites their readers", () => {
    const s = run(def, stats).find((x) => x.kind === "batch_decisions");
    expect(s?.nodeIds).toEqual(["is_refund", "is_urgent"]);
    expect(s?.estimatedSavingsUsdPerRun).toBeGreaterThan(0);
    expect(s?.latencyDeltaMs).toBe(-250); // they ran one after the other
    expect(s?.risk).toBe("low");
    const next = apply(def, s?.fix ?? []);
    expect(errors(next)).toEqual([]);
    const batch = next.nodes.find((n) => n.kind === "task" && n.type === "flowaid.decision.batch");
    expect(batch?.kind === "task" && Object.keys(batch.config.questions as object)).toEqual([
      "is_refund",
      "is_urgent",
    ]);
    expect(next.nodes.some((n) => n.id === "is_refund" || n.id === "is_urgent")).toBe(false);
    const out = next.nodes.find((n) => n.id === "done");
    expect(out?.kind === "output" && out.value).toMatchObject({
      fields: { refund: { ref: { node: batch?.id, port: "answers", path: "/is_refund/value" } } },
    });
    expect(next.edges.map((e) => `${e.from.node}.${e.from.port}>${e.to.node}`).sort()).toEqual(
      [`${batch?.id}.done>reply`, "reply.done>done", `ticket.done>${batch?.id}`].sort(),
    );
  });

  it("offers no automatic fix when a template reads a decision", () => {
    const withTemplate = define({
      ...triage(),
      nodes: triage().nodes.map((n) =>
        n.id === "reply" && n.kind === "task"
          ? {
              ...n,
              inputs: {
                prompt: { kind: "template", source: "Refund: {{ is_refund.decision.value }}" },
              },
            }
          : n,
      ),
    });
    const s = run(withTemplate, stats).find((x) => x.kind === "batch_decisions");
    expect(s?.fix).toEqual([]);
    expect(s?.rationale).toMatch(/by hand/);
  });

  it("skips decisions the runtime already batches", () => {
    const parallel = define({
      ...triage(),
      edges: [
        { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "is_refund" } },
        { id: "e2", from: { node: "ticket", port: "done" }, to: { node: "is_urgent" } },
        { id: "e3", from: { node: "is_urgent", port: "done" }, to: { node: "reply" } },
        { id: "e5", from: { node: "is_refund", port: "done" }, to: { node: "reply" } },
        { id: "e4", from: { node: "reply", port: "done" }, to: { node: "done" } },
      ],
    });
    const plan = planOf(parallel);
    expect(Object.keys(plan.batchGroups).length).toBe(1);
    expect(run(parallel, stats).some((x) => x.kind === "batch_decisions")).toBe(false);
  });
});

describe("optimize: cache_safe_node and tighten_bounds", () => {
  it("suggests memoising a deterministic node whose inputs repeat, without an automatic fix", () => {
    const s = run(triage(), [stat("reply", { avgCostUsd: 0.02, distinctInputs: 15 })]).find(
      (x) => x.kind === "cache_safe_node",
    );
    expect(s?.estimatedSavingsUsdPerRun).toBeCloseTo(0.02 * 0.75, 6);
    expect(s?.risk).toBe("low");
    expect(s?.fix).toEqual([]);
  });

  it("caps a for-each far above the iterations runs use", () => {
    const def = define({
      inputs: {
        type: "object",
        required: ["items"],
        properties: { items: { type: "array", items: { type: "string" } } },
      },
      outputs: { type: "object" },
      nodes: [
        { id: "ticket", kind: "input", name: "Ticket" },
        {
          id: "each",
          kind: "foreach",
          name: "Each",
          items: ref("ticket", "items"),
          bounds: { maxIterations: 200 },
        },
        { id: "done", kind: "output", name: "Done", value: { kind: "literal", value: {} } },
      ],
      edges: [
        { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "each" } },
        { id: "e2", from: { node: "each", port: "done" }, to: { node: "done" } },
      ],
    });
    const s = run(def, [stat("each", { avgCostUsd: 0, iterations: { p95: 4, max: 6 } })]).find(
      (x) => x.kind === "tighten_bounds",
    );
    expect(s?.title).toMatch(/12 iterations/);
    const next = apply(def, s?.fix ?? []);
    const each = next.nodes.find((n) => n.id === "each");
    expect(each?.kind === "foreach" && each.bounds.maxIterations).toBe(12);
  });
});

describe("suggestion diagnostics (RFC-0020)", () => {
  it("are I_COST_SUGGESTION infos that parse against DiagnosticSchema, with fixes where automatic", () => {
    const suggestions = run(triage(), [
      stat("is_refund"),
      stat("is_urgent"),
      stat("reply", {
        avgInputTokens: 2000,
        avgOutputTokens: 600,
        avgCostUsd: 0.04,
        distinctInputs: 10,
      }),
    ]);
    expect(suggestions.map((s) => s.kind).sort()).toEqual([
      "batch_decisions",
      "cache_safe_node",
      "cheaper_model",
    ]);
    const diags = suggestionDiagnostics(suggestions);
    for (const d of diags)
      expect(DiagnosticSchema.parse(d)).toMatchObject({
        code: "I_COST_SUGGESTION",
        severity: "info",
      });
    expect(diags.filter((d) => d.fix).length).toBe(2);
    // largest saving first
    expect(suggestions[0]?.estimatedSavingsUsdPerRun).toBeGreaterThanOrEqual(
      suggestions[1]?.estimatedSavingsUsdPerRun ?? 0,
    );
  });
});
