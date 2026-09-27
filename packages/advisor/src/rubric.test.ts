import { describe, expect, it } from "vitest";
import { applyJsonPatch, type JsonValue } from "@flowaid/shared";
import type { BooleanDecision, WorkflowDefinition } from "@flowaid/workflow-core";
import { CRITIC_CHECKS, critique, workflowSummary } from "./critic.js";
import { RUBRIC, piiInputs, type CritiqueInput } from "./rubric.js";
import { compileDef, define, manifests, ref, task, triage } from "./test/fixtures.js";

function inputFor(def: WorkflowDefinition, over: Partial<CritiqueInput> = {}): CritiqueInput {
  const compiled = compileDef(def);
  return {
    definition: def,
    plan: compiled.ok ? compiled.plan : null,
    diagnostics: compiled.diagnostics,
    manifests,
    workflow: { evaluationSetId: "01a0e324-0e66-773d-b6b5-d7de758891ad" },
    ...over,
  };
}

const rule = (id: string) => {
  const found = RUBRIC.find((r) => r.id === id);
  if (!found) throw new Error(`no rule ${id}`);
  return found;
};
const apply = (def: WorkflowDefinition, patch: readonly unknown[]) =>
  applyJsonPatch(def as unknown as JsonValue, patch as never) as unknown as WorkflowDefinition;
const errors = (def: unknown) => compileDef(def).diagnostics.filter((d) => d.severity === "error");

const state = { kind: "object" as const, fields: { message: ref("ticket", "message") } };

/** A refund decision that drives an irreversible HTTP POST. */
function refundPayout(gated: boolean): WorkflowDefinition {
  const nodes: unknown[] = [
    { id: "ticket", kind: "input", name: "Ticket" },
    task(
      "is_refund",
      "flowaid.decision.boolean",
      { instructions: "Refund?" },
      { state },
      { typesafe: "TYPESAFE_API_KEY" },
    ),
    task(
      "payout",
      "flowaid.tools.http",
      { method: "POST", url: "https://payments.example.com/refunds" },
      {},
      {},
    ),
    { id: "done", kind: "output", name: "Done", value: { kind: "literal", value: {} } },
  ];
  const edges = [
    { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "is_refund" } },
    ...(gated
      ? [
          { id: "e2", from: { node: "is_refund", port: "done" }, to: { node: "approve" } },
          { id: "e3", from: { node: "approve", port: "approved" }, to: { node: "payout" } },
          { id: "e5", from: { node: "approve", port: "rejected" }, to: { node: "done" } },
        ]
      : [{ id: "e2", from: { node: "is_refund", port: "done" }, to: { node: "payout" } }]),
    { id: "e4", from: { node: "payout", port: "done" }, to: { node: "done" } },
  ];
  if (gated)
    nodes.splice(2, 0, {
      id: "approve",
      kind: "human",
      name: "Approve",
      mode: { type: "approval" },
      title: { kind: "literal", value: "Pay out?" },
    });
  return define({
    secrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" }],
    execution: { maxCostUsd: 0.1, decisions: { failover: [{ provider: "human" }] } },
    nodes,
    edges,
  });
}

describe("rubric", () => {
  it("lists one checklist line per rule", () => {
    expect(CRITIC_CHECKS).toHaveLength(RUBRIC.length);
    expect(new Set(RUBRIC.map((r) => r.id)).size).toBe(RUBRIC.length);
  });

  it("irreversible_after_decision: flags an ungated side effect on a decision, not a gated one", () => {
    const ungated = rule("irreversible_after_decision").run(inputFor(refundPayout(false)));
    expect(ungated).toHaveLength(1);
    expect(ungated[0]).toMatchObject({
      severity: "error",
      category: "safety",
      nodeIds: ["is_refund", "payout"],
    });
    expect(rule("irreversible_after_decision").run(inputFor(refundPayout(true)))).toEqual([]);
  });

  it("unbounded_generation_loop: bounds a for-each that generates, and the fix compiles", () => {
    const def = define({
      inputs: {
        type: "object",
        required: ["items"],
        properties: { items: { type: "array", items: { type: "string" } } },
      },
      outputs: { type: "object" },
      secrets: [{ name: "OPENAI_API_KEY", credentialType: "openai.api_key" }],
      execution: { maxCostUsd: 2 },
      nodes: [
        { id: "ticket", kind: "input", name: "Ticket" },
        {
          id: "each",
          kind: "foreach",
          name: "Each item",
          items: ref("ticket", "items"),
          bounds: { maxIterations: 50 },
        },
        task(
          "summarise",
          "flowaid.ai.generate",
          { model: { provider: "openai", model: "gpt-5.5" } },
          { prompt: { kind: "template", source: "{{ $scope.item }}" } },
          { llm: "OPENAI_API_KEY" },
          { parent: "each" },
        ),
        { id: "done", kind: "output", name: "Done", value: { kind: "literal", value: {} } },
      ],
      edges: [
        { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "each" } },
        { id: "e2", from: { node: "each", port: "done" }, to: { node: "done" } },
      ],
    });
    const found = rule("unbounded_generation_loop").run(inputFor(def));
    expect(found).toHaveLength(1);
    expect(found[0]?.nodeIds).toEqual(["each", "summarise"]);
    const next = apply(def, found[0]?.fix?.patch ?? []);
    const each = next.nodes.find((n) => n.id === "each");
    expect(each?.kind === "foreach" && each.bounds.maxCostUsd).toBe(1);
    expect(errors(next)).toEqual([]);
    expect(rule("unbounded_generation_loop").run(inputFor(next))).toEqual([]);
  });

  it("pii_into_prompt: marks personal input reaching a prompt, and the fix redacts it", () => {
    expect([
      ...piiInputs({
        type: "object",
        properties: {
          customer_email: { type: "string" },
          note: { type: "string" },
          x: { type: "string", format: "email" },
        },
      }),
    ]).toEqual(["customer_email", "x"]);
    const def = define({
      ...triage(),
      inputs: {
        type: "object",
        required: ["message"],
        properties: { message: { type: "string" }, email: { type: "string" } },
      },
      nodes: triage().nodes.map((n) =>
        n.id === "reply" && n.kind === "task"
          ? {
              ...n,
              inputs: {
                prompt: {
                  kind: "template",
                  source: "Reply to {{ ticket.email }}: {{ ticket.message }}",
                },
              },
            }
          : n,
      ),
    });
    const found = rule("pii_into_prompt").run(inputFor(def));
    expect(found).toHaveLength(1);
    expect(found[0]?.nodeIds).toEqual(["reply"]);
    const next = apply(def, found[0]?.fix?.patch ?? []);
    const reply = next.nodes.find((n) => n.id === "reply");
    expect(reply?.policy?.privacy).toMatchObject({ containsPII: true, redactFields: ["/prompt"] });
    expect(errors(next)).toEqual([]);
    expect(rule("pii_into_prompt").run(inputFor(next))).toEqual([]);
  });

  it("no_evaluation_set and no_failover: nudge a model-backed workflow, and the failover fix compiles", () => {
    const def = triage();
    expect(
      rule("no_evaluation_set").run(inputFor(def, { workflow: { evaluationSetId: null } })),
    ).toHaveLength(1);
    expect(rule("no_evaluation_set").run(inputFor(def))).toEqual([]);
    const failover = rule("no_failover").run(inputFor(def));
    expect(failover).toHaveLength(1);
    const next = apply(def, failover[0]?.fix?.patch ?? []);
    expect(next.execution.decisions.failover).toEqual([{ provider: "human" }]);
    expect(errors(next)).toEqual([]);
    expect(
      rule("no_failover").run(inputFor(def, { defaultFailover: [{ provider: "human" }] })),
    ).toEqual([]);
  });

  it("cost_over_budget: flags a missing bound (with the suggested one as the fix) and a worst case above budget", () => {
    const unbounded = define({ ...triage(), execution: {} });
    const found = rule("cost_over_budget").run(inputFor(unbounded, { suggestedMaxCostUsd: 0.25 }));
    expect(found.map((a) => a.id)).toEqual(["cost_unbounded"]);
    expect(apply(unbounded, found[0]?.fix?.patch ?? []).execution.maxCostUsd).toBe(0.25);
    const over = rule("cost_over_budget").run(
      inputFor(triage(), { budget: { monthlyCostUsd: 100, runsPerMonth: 10_000 } }),
    );
    expect(over.map((a) => a.id)).toEqual(["cost_over_budget"]);
    expect(
      rule("cost_over_budget").run(
        inputFor(triage(), { budget: { monthlyCostUsd: 100, runsPerMonth: 10 } }),
      ),
    ).toEqual([]);
  });
});

describe("critique", () => {
  const judge = (value: boolean, confidence: number) => () =>
    Promise.resolve({
      kind: "boolean",
      value,
      confidence,
      pYes: value ? confidence : 1 - confidence,
      provider: "typesafe",
      model: "jev",
      latencyMs: 1,
      costUsd: 0,
      attempts: [],
    } as unknown as BooleanDecision);

  it("orders errors first and adds the judge's finding only when it says no", async () => {
    const input = inputFor(refundPayout(false), { workflow: { evaluationSetId: null } });
    const plain = await critique(input);
    expect(plain[0]?.severity).toBe("error");
    expect(plain.some((a) => a.source === "judge")).toBe(false);
    const judged = await critique(input, judge(false, 0.9));
    expect(judged.find((a) => a.source === "judge")).toMatchObject({
      severity: "warning",
      category: "safety",
    });
    expect((await critique(input, judge(true, 0.95))).some((a) => a.source === "judge")).toBe(
      false,
    );
  });

  it("gives the judge a compact summary, not the whole document", () => {
    const summary = workflowSummary(triage(), manifests) as {
      nodes: { id: string; question?: string }[];
    };
    expect(summary.nodes.find((n) => n.id === "is_refund")?.question).toBe(
      "Is this a refund request?",
    );
    expect(JSON.stringify(summary)).not.toContain("typeVersion");
  });
});
