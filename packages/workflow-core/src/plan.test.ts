/**
 * `ExecutionPlanSchema` against the hand-written plan of the example workflow
 * (`fixtures/plans/example-support-reply.plan.json`), and its consistency with the
 * definition it was compiled from (`fixtures/example-support-reply.json`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256Json } from "@flowaid/shared";
import {
  CompiledBindingSchema,
  ExecutionPlanSchema,
  PlanNodeSchema,
  PlanOpSchema,
  type ExecutionPlan,
  type PlanNode,
} from "./plan.js";
import { WorkflowDefinitionSchema, definitionHash, type WorkflowDefinition } from "./definition.js";
import { NodeManifestSchema } from "./manifest.js";
import { DecisionResultJsonSchema } from "./decision.js";
import { ExprAstSchema, CompiledTemplateSchema } from "./bindings.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const rawPlan = readJson(join(FIXTURES, "plans", "example-support-reply.plan.json"));
const plan: ExecutionPlan = ExecutionPlanSchema.parse(rawPlan);
const definition: WorkflowDefinition = WorkflowDefinitionSchema.parse(
  readJson(join(FIXTURES, "example-support-reply.json")),
);

function node(id: string): PlanNode {
  const n = plan.nodes[id];
  if (n === undefined) throw new Error(`plan has no node ${id}`);
  return n;
}

describe("fixtures/plans/example-support-reply.plan.json", () => {
  it("parses with ExecutionPlanSchema and survives unchanged", () => {
    const result = ExecutionPlanSchema.safeParse(rawPlan);
    expect(
      result.success,
      JSON.stringify(result.success ? null : result.error.issues.slice(0, 5), null, 2),
    ).toBe(true);
    expect(plan).toEqual(rawPlan);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(rawPlan);
  });

  it("is pinned to the example definition by workflowId and definitionHash", () => {
    expect(plan.planVersion).toBe(1);
    expect(plan.workflowId).toBe(definition.id);
    expect(plan.definitionHash).toBe(definitionHash(definition));
    expect(plan.inputs).toEqual(definition.inputs);
    expect(plan.outputs).toEqual(definition.outputs);
    expect(plan.execution).toEqual(definition.execution);
    expect(plan.variables).toEqual(definition.variables);
    expect(plan.secrets).toEqual(definition.secrets);
    expect(plan.triggers).toEqual(definition.triggers);
  });

  it("carries a planHash equal to the sha256 of the canonical plan without planHash", () => {
    const { planHash, ...rest } = plan;
    expect(planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Json(rest)).toBe(planHash);
    expect(sha256Json({ ...rest, compilerVersion: "0.1.1" })).not.toBe(planHash);
  });

  it("has one plan node per definition node (note nodes excluded) with matching kind and name", () => {
    const defIds = definition.nodes
      .filter((n) => n.kind !== "note")
      .map((n) => n.id)
      .sort();
    expect(Object.keys(plan.nodes).sort()).toEqual(defIds);
    for (const n of definition.nodes) {
      if (n.kind === "note") continue;
      expect(node(n.id).kind).toBe(n.kind);
      expect(node(n.id).name).toBe(n.name);
      expect(node(n.id).scope).toBe("");
    }
    expect(plan.estimate.nodeCount).toBe(defIds.length);
  });

  it("has a single root scope whose order is a topological order over data and control dependencies", () => {
    expect(Object.keys(plan.scopes)).toEqual([""]);
    const root = plan.scopes[""];
    if (root === undefined) throw new Error("root scope");
    expect(root).toMatchObject({
      id: "",
      parent: null,
      kind: "root",
      container: null,
      entries: ["start"],
    });
    expect([...root.nodes].sort()).toEqual(Object.keys(plan.nodes).sort());
    expect([...root.order].sort()).toEqual(Object.keys(plan.nodes).sort());
    expect(root.outputs.sort()).toEqual(
      Object.values(plan.nodes)
        .filter((n) => n.kind === "output")
        .map((n) => n.id)
        .sort(),
    );
    const position = new Map(root.order.map((id, i) => [id, i]));
    for (const n of Object.values(plan.nodes)) {
      const me = position.get(n.id) ?? -1;
      for (const d of n.dataIn)
        expect(position.get(d.from.node) ?? Infinity, `${d.from.node} before ${n.id}`).toBeLessThan(
          me,
        );
      for (const c of n.controlIn)
        expect(position.get(c.from.node) ?? Infinity, `${c.from.node} before ${n.id}`).toBeLessThan(
          me,
        );
      for (const s of n.successors)
        expect(position.get(s) ?? -1, `${n.id} before ${s}`).toBeGreaterThan(me);
    }
    expect(root.order[0]).toBe("start");
    expect(root.order).toEqual([
      "start",
      "intent",
      "route",
      "fetch_account",
      "draft",
      "safe",
      "gate",
      "approve",
      "out_auto",
      "out_human",
      "out_rejected",
    ]);
  });

  it("mirrors every control edge of the definition in controlIn with an exclusive group", () => {
    const planEdges = Object.values(plan.nodes).flatMap((n) =>
      n.controlIn.map((c) => ({ id: c.edgeId, from: c.from, to: { node: n.id } })),
    );
    const defEdges = definition.edges.map((e) => ({ id: e.id, from: e.from, to: e.to }));
    expect(planEdges.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      defEdges.sort((a, b) => a.id.localeCompare(b.id)),
    );
    // c5 (approve.rejected) and c6 (approve.expired) are mutually exclusive: one OR-group on out_rejected (§2.9).
    expect(node("out_rejected").controlIn.map((c) => c.group)).toEqual([0, 0]);
    for (const n of Object.values(plan.nodes)) {
      for (const c of n.controlIn)
        expect(node(c.from.node).controlOut, `${c.from.node}.${c.from.port}`).toContain(
          c.from.port,
        );
    }
  });

  it("references only existing producers and ports in dataIn, and dataEdges flattens them", () => {
    for (const n of Object.values(plan.nodes)) {
      for (const d of n.dataIn) {
        expect(d.to.node).toBe(n.id);
        const producer = node(d.from.node);
        expect(Object.keys(producer.outputs), `${d.from.node}.${d.from.port}`).toContain(
          d.from.port,
        );
      }
    }
    const flattened = Object.values(plan.nodes).flatMap((n) => n.dataIn);
    expect(plan.dataEdges).toHaveLength(flattened.length);
    for (const edge of plan.dataEdges) expect(flattened).toContainEqual(edge);
    for (const n of Object.values(plan.nodes)) {
      const fed = new Set([
        ...plan.dataEdges.filter((d) => d.from.node === n.id).map((d) => d.to.node),
        ...Object.values(plan.nodes)
          .filter((m) => m.controlIn.some((c) => c.from.node === n.id))
          .map((m) => m.id),
      ]);
      expect(n.successors).toEqual([...fed].sort());
    }
  });

  it("computes the guards of §2.9 (pairwise exclusive outputs, conditional fetch_account)", () => {
    expect(node("start").guard).toEqual([[]]);
    expect(node("intent").guard).toEqual([[]]);
    expect(node("draft").guard).toEqual([[]]);
    expect(node("fetch_account").guard).toEqual([[{ node: "route", port: "billing" }]]);
    expect(node("out_auto").guard).toEqual([[{ node: "gate", port: "pass" }]]);
    expect(node("out_human").guard).toEqual([
      [
        { node: "gate", port: "review" },
        { node: "approve", port: "approved" },
      ],
    ]);
    expect(node("out_rejected").guard).toEqual([
      [
        { node: "gate", port: "review" },
        { node: "approve", port: "rejected" },
      ],
      [
        { node: "gate", port: "review" },
        { node: "approve", port: "expired" },
      ],
    ]);
    // draft reads fetch_account.body through coalesce(): an optional dependency, hence not part of draft's guard.
    const bodyDep = node("draft").dataIn.find((d) => d.from.node === "fetch_account");
    expect(bodyDep).toMatchObject({ optional: true, via: "template" });
    // intent.state.tier carries a default → optional; message is required.
    expect(node("intent").dataIn).toEqual([
      {
        from: { node: "start", port: "message" },
        to: { node: "intent", port: "state" },
        optional: false,
        via: "ref",
      },
      {
        from: { node: "start", port: "tier" },
        to: { node: "intent", port: "state" },
        optional: true,
        via: "ref",
      },
    ]);
  });

  it("resolves policies workflow default ← manifest default ← node override", () => {
    const defaults = {
      timeoutMs: definition.execution.defaultNodeTimeoutMs,
      retry: definition.execution.defaultRetry,
      onError: "fail",
      maxCostUsd: null,
      maxTokens: null,
      privacy: definition.execution.privacy,
    };
    expect(node("start").policy).toEqual(defaults);
    expect(node("draft").policy).toEqual(defaults);
    expect(node("intent").policy).toEqual({ ...defaults, timeoutMs: 30000 });
    expect(node("fetch_account").policy).toEqual({
      ...defaults,
      timeoutMs: 30000,
      retry: { ...defaults.retry, maxAttempts: 3 },
      onError: "ignore",
    });
    // onError: 'ignore' means no `failed` control-out; onError: 'route' would add one.
    expect(node("fetch_account").controlOut).toEqual(["done"]);
  });

  it("moves templates and bindable config fields out of config (configTemplates / configBindings)", () => {
    const fetch = node("fetch_account").op;
    if (fetch.kind !== "task") throw new Error("fetch_account is a task");
    expect(fetch.config).toEqual({ method: "GET", responseType: "json", timeoutMs: 5000 });
    expect(Object.keys(fetch.configTemplates)).toEqual(["/url"]);
    const url = fetch.configTemplates["/url"];
    expect(url?.parts.map((p) => p.kind)).toEqual(["hole", "text", "hole"]);
    expect(url?.parts[0]).toMatchObject({
      kind: "hole",
      expr: { kind: "ref", ref: { kind: "var", name: "crmBaseUrl" } },
      filter: "string",
      range: { start: 0, end: 22 },
    });
    expect(url?.parts[1]).toEqual({ kind: "text", text: "/customers/" });
    expect(fetch.credentials).toEqual({ auth: "CRM_TOKEN" });
    expect(fetch.tool).toBeNull();
    expect(node("fetch_account").idempotency).toBe("safe");

    const gate = node("gate").op;
    if (gate.kind !== "task") throw new Error("gate is a task");
    expect(gate.config).toEqual({ requireValue: true });
    expect(gate.configBindings["/threshold"]).toEqual({
      kind: "ref",
      ref: { kind: "var", name: "autoSendThreshold" },
      optional: false,
      schema: { type: "number", minimum: 0, maximum: 1 },
    });
  });

  it("embeds the manifest of every task node and types decision ports with DecisionResultJsonSchema", () => {
    for (const n of Object.values(plan.nodes)) {
      if (n.op.kind !== "task") continue;
      expect(NodeManifestSchema.safeParse(n.op.manifest).success, n.id).toBe(true);
      expect(n.op.manifest.id).toBe(n.op.type);
      expect(plan.catalogSnapshot[n.op.type]).toBe(n.op.typeVersion);
      for (const port of n.op.manifest.outputs)
        expect(n.outputs[port.name], `${n.id}.${port.name}`).toEqual(port.schema);
      for (const port of Object.keys(n.op.inputs))
        expect(
          n.op.manifest.inputs.map((p) => p.name),
          `${n.id}.${port}`,
        ).toContain(port);
    }
    expect(node("intent").outputs.decision).toEqual(DecisionResultJsonSchema.choice);
    expect(node("safe").outputs.decision).toEqual(DecisionResultJsonSchema.boolean);
    expect(node("intent").controlOut).toEqual([
      "done",
      "billing",
      "technical",
      "security",
      "general",
    ]);
    expect(Object.keys(plan.catalogSnapshot).sort()).toEqual([
      "flowaid.ai.generate",
      "flowaid.decision.boolean",
      "flowaid.decision.choice",
      "flowaid.decision.confidence_gate",
      "flowaid.tools.http",
    ]);
  });

  it("compiles the branch predicate and the draft prompt template into ASTs with source ranges", () => {
    const route = node("route").op;
    if (route.kind !== "branch") throw new Error("route is a branch");
    expect(route.defaultPort).toBe("other");
    expect(route.cases[0]?.source).toBe("intent.decision.value == 'billing'");
    expect(ExprAstSchema.parse(route.cases[0]?.when)).toEqual({
      kind: "binary",
      op: "==",
      left: {
        kind: "ref",
        ref: { kind: "port", node: "intent", port: "decision", path: "/value" },
      },
      right: { kind: "literal", value: "billing" },
    });
    const draft = node("draft").op;
    if (draft.kind !== "task") throw new Error("draft is a task");
    const prompt = draft.inputs.prompt;
    if (prompt?.kind !== "template") throw new Error("prompt is a template binding");
    expect(CompiledTemplateSchema.safeParse(prompt.template).success).toBe(true);
    const holes = prompt.template.parts.filter((p) => p.kind === "hole");
    expect(holes).toHaveLength(4);
    expect(holes.map((h) => h.filter)).toEqual(["string", "string", "json", "string"]);
    const source = definition.nodes.find((n) => n.id === "draft");
    if (source?.kind !== "task" || source.inputs.prompt?.kind !== "template")
      throw new Error("example draft prompt");
    for (const h of holes) {
      const text = source.inputs.prompt.source.slice(h.range.start, h.range.end);
      expect(text.startsWith("{{") && text.endsWith("}}"), text).toBe(true);
    }
    expect(holes[2]?.expr).toEqual({
      kind: "call",
      fn: "coalesce",
      args: [
        { kind: "ref", ref: { kind: "port", node: "fetch_account", port: "body" } },
        { kind: "object", entries: [] },
      ],
    });
  });

  it("compiles the human node with its review value, title template and routing ports", () => {
    const approve = node("approve");
    expect(approve.controlOut).toEqual(["approved", "rejected", "expired"]);
    if (approve.op.kind !== "human") throw new Error("approve is human");
    expect(approve.op.mode.type).toBe("review");
    expect(approve.op.onExpire).toBe("route");
    expect(approve.op.expiresInMs).toBe(86400000);
    expect(approve.op.externalReview).toBe(true);
    expect(approve.op.escalation).toBeNull();
    expect(Object.keys(approve.op.context)).toEqual(["message", "safety"]);
    expect(approve.outputs.decision?.properties?.action).toMatchObject({
      enum: ["approve", "reject", "choose", "submit", "expire"],
    });
  });

  it("assembles output values as object bindings assignable to `outputs`", () => {
    for (const id of ["out_auto", "out_human", "out_rejected"]) {
      const op = node(id).op;
      if (op.kind !== "output") throw new Error(`${id} is an output`);
      expect(op.value.kind).toBe("object");
      if (op.value.kind !== "object") continue;
      expect(Object.keys(op.value.fields).sort()).toEqual(
        [...(definition.outputs.required ?? [])].concat("approved_by").sort(),
      );
      expect(CompiledBindingSchema.safeParse(op.value).success).toBe(true);
    }
    expect(node("out_auto").op).toMatchObject({ outcome: "auto", earlyExit: false });
    expect(node("out_human").op).toMatchObject({ outcome: "human_approved" });
    expect(node("out_rejected").op).toMatchObject({ outcome: "rejected" });
  });

  it("derives redaction rules from x-dataClass: pii on the message wherever it flows", () => {
    expect(node("start").redact).toEqual([
      { pointer: "/out/message", dataClass: "pii", mode: "mask" },
    ]);
    expect(node("intent").redact).toEqual([
      { pointer: "/in/state/message", dataClass: "pii", mode: "mask" },
    ]);
    expect(node("draft").redact).toEqual([
      { pointer: "/in/prompt", dataClass: "pii", mode: "mask" },
    ]);
    expect(node("route").redact).toEqual([]);
  });

  it("summarises capabilities, pools and batch groups", () => {
    expect(plan.requiredCapabilities).toEqual([
      "artifacts",
      "credentials",
      "decision",
      "generation",
      "network",
      "streaming",
    ]);
    expect(plan.pools).toEqual(["general"]);
    expect(plan.batchGroups).toEqual({});
    expect(plan.subflows).toEqual([]);
    expect(plan.estimate.maxCostUsd).toBe(definition.execution.maxCostUsd ?? null);
    for (const n of Object.values(plan.nodes)) expect(n.batchGroup).toBeNull();
  });
});

describe("ExecutionPlanSchema rejects", () => {
  it("a wrong planVersion, a malformed hash-free plan or an unknown op kind", () => {
    expect(ExecutionPlanSchema.safeParse({ ...plan, planVersion: 2 }).success).toBe(false);
    const { planHash: _h, ...noHash } = plan;
    expect(ExecutionPlanSchema.safeParse(noHash).success).toBe(false);
    expect(PlanOpSchema.safeParse({ kind: "note", text: "x" }).success).toBe(false);
    expect(PlanNodeSchema.safeParse({ ...node("start"), kind: "note" }).success).toBe(false);
    expect(
      PlanNodeSchema.safeParse({ ...node("start"), guard: [[{ node: "route" }]] }).success,
    ).toBe(false);
    expect(PlanNodeSchema.safeParse({ ...node("intent"), batchGroup: undefined }).success).toBe(
      false,
    );
    expect(
      ExecutionPlanSchema.safeParse({ ...plan, scopes: { "Root Scope": plan.scopes[""] } }).success,
    ).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({ ...plan, nodes: { ...plan.nodes, "Bad-Id": node("start") } })
        .success,
    ).toBe(false);
  });
});
