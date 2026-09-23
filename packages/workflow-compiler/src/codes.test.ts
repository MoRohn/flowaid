/**
 * One case per compiler-owned DiagnosticCode: a minimal edit of the reference workflow (or of
 * the compile options) that makes the compiler report exactly that code. Every case's
 * diagnostics are snapshotted in fixtures/diagnostics/codes.json so wording and locations are
 * reviewed like code.
 */
import { stableStringify } from "@flowaid/shared";
import {
  DiagnosticCodeSchema,
  NodeManifestSchema,
  type Diagnostic,
  type DiagnosticCode,
  type ExecutionPlan,
  type NodeManifest,
  type ToolDefinition,
} from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { compile, verifyPlanHash, type CompileInput } from "./index.js";
import { FIXTURE_MANIFESTS, catalogOf, readJson } from "./test/support.js";

/** Codes owned by other packages: evaluation-gated publish and the importer. */
const NOT_COMPILER: DiagnosticCode[] = ["W_REGRESSION", "E_IMPORT_UNSUPPORTED"];

type Doc = Record<string, any>;

const BASE: Doc = readJson("example-support-reply.json") as Doc;
const clone = (): Doc => JSON.parse(JSON.stringify(BASE)) as Doc;
const node = (doc: Doc, id: string): Doc => {
  const found = (doc.nodes as Doc[]).find((n) => n.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
};
const out = (doc: Doc, id: string): Doc => node(doc, id).value.fields as Doc;
const ref = (nodeId: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node: nodeId, port, ...(path ? { path } : {}) },
});
const transform = (id: string, expr: string, extra: Doc = {}): Doc => ({
  id,
  kind: "task",
  name: id,
  type: "flowaid.data.transform",
  typeVersion: "1.0.0",
  config: { expr },
  ...extra,
});
const loop = (id: string, extra: Doc = {}): Doc => ({
  id,
  kind: "loop",
  name: id,
  carrySchema: {
    type: "object",
    properties: { n: { type: "integer" } },
    additionalProperties: false,
  },
  carry: { initial: { n: 0 }, next: { n: { kind: "expr", source: "$scope.carry.n + 1" } } },
  exitWhen: "$scope.carry.n >= 3",
  bounds: { maxIterations: 10, maxCostUsd: 1 },
  ...extra,
});
const mcpNode = (serverId: string): Doc => ({
  id: "kb",
  kind: "task",
  name: "Knowledge base",
  type: "flowaid.tools.mcp",
  typeVersion: "1.0.0",
  config: { serverId, tool: "search" },
  inputs: { query: ref("start", "message") },
});
const SERVER = "00000000-0000-4000-8000-000000000001";
const searchTool = (inputSchema: Doc): ToolDefinition => ({
  name: "search",
  description: "Search",
  inputSchema,
  idempotency: "safe",
  approvalRequired: false,
  source: { kind: "mcp", serverId: SERVER, tool: "search" },
});
const withManifest = (...extra: NodeManifest[]) => catalogOf([...FIXTURE_MANIFESTS, ...extra]);
const manifestLike = (id: string, patch: Doc): NodeManifest => {
  const base = FIXTURE_MANIFESTS.find((m) => m.id === "flowaid.data.transform");
  return NodeManifestSchema.parse({ ...JSON.parse(JSON.stringify(base)), id, ...patch });
};
const choice = FIXTURE_MANIFESTS.find((m) => m.id === "flowaid.decision.choice") as NodeManifest;

interface Case {
  code: DiagnosticCode;
  edit?: (doc: Doc) => void;
  options?: Partial<CompileInput>;
  /** For codes produced outside compile(). */
  run?: () => Diagnostic[];
}

const CASES: Case[] = [
  // schema & structure
  { code: "E_SCHEMA", edit: (d) => void (d.nodes = "not a list") },
  { code: "E_DUPLICATE_NODE_ID", edit: (d) => d.nodes.push({ ...node(d, "route") }) },
  { code: "E_DUPLICATE_EDGE_ID", edit: (d) => d.edges.push({ ...d.edges[0] }) },
  {
    code: "E_RESERVED_ID",
    edit: (d) => d.nodes.push({ id: "len", kind: "note", name: "A note", text: "hi" }),
  },
  { code: "W_DUPLICATE_NAME", edit: (d) => void (node(d, "out_human").name = "Auto reply") },
  {
    code: "E_NO_INPUT_NODE",
    edit: (d) => void ((node(d, "start").kind = "note"), (node(d, "start").text = "gone")),
  },
  {
    code: "E_MULTIPLE_INPUT_NODES",
    edit: (d) => d.nodes.push({ id: "start2", kind: "input", name: "Second" }),
  },
  {
    code: "E_NO_OUTPUT_NODE",
    edit: (d) => {
      d.nodes = d.nodes.filter((n: Doc) => n.kind !== "output");
      d.edges = d.edges.filter((e: Doc) => !String(e.to.node).startsWith("out_"));
    },
  },
  { code: "E_PARENT_NOT_CONTAINER", edit: (d) => void (node(d, "draft").parent = "intent") },
  {
    code: "E_SCOPE_DEPTH",
    edit: (d) => {
      d.nodes.push(
        loop("l1"),
        loop("l2", { parent: "l1" }),
        loop("l3", { parent: "l2" }),
        loop("l4", { parent: "l3" }),
      );
      d.nodes.push(loop("l5", { parent: "l4" }), transform("deep", "1", { parent: "l5" }));
      out(d, "out_auto").extra = ref("l1", "iterations");
    },
  },
  // catalog & config
  {
    code: "E_UNKNOWN_NODE_TYPE",
    edit: (d) => void (node(d, "intent").type = "flowaid.decision.nope"),
  },
  {
    code: "E_NODE_VERSION_UNSUPPORTED",
    edit: (d) => void (node(d, "intent").typeVersion = "9.0.0"),
  },
  {
    code: "I_NODE_VERSION_OUTDATED",
    options: { catalog: withManifest({ ...choice, version: "1.1.0", migrations: ["1.0.0"] }) },
  },
  {
    code: "W_NODE_DEPRECATED",
    options: {
      catalog: catalogOf([
        ...FIXTURE_MANIFESTS.filter((m) => m.id !== choice.id),
        {
          ...choice,
          metadata: {
            ...choice.metadata,
            deprecated: { since: "1.0.0", message: "use the router" },
          },
        },
      ]),
    },
  },
  { code: "E_CONFIG_INVALID", edit: (d) => void (node(d, "intent").config.bogus = 1) },
  {
    code: "E_PORT_RULE_INVALID",
    edit: (d) => void (node(d, "intent").config.options = { "Not A Port": "x", ok: "y" }),
  },
  { code: "E_TOOL_UNRESOLVED", edit: (d) => d.nodes.push(mcpNode("$template.mcp.kb")) },
  {
    code: "E_TOOL_SCHEMA_INVALID",
    edit: (d) => d.nodes.push(mcpNode(SERVER)),
    options: { resolveTool: () => searchTool({ type: "string" }) },
  },
  { code: "E_POOL_NOT_ALLOWED", edit: (d) => void (node(d, "draft").policy = { pool: "code" }) },
  {
    code: "E_PLUGIN_ID_PREFIX",
    edit: (d) => d.nodes.push(transform("plugin", "1", { type: "acme.thing" })),
    options: { catalog: withManifest(manifestLike("acme.thing", {})) },
  },
  // edges & ports
  {
    code: "E_EDGE_ENDPOINT_MISSING",
    edit: (d) =>
      d.edges.push({ id: "c9", from: { node: "gate", port: "fail" }, to: { node: "ghost" } }),
  },
  {
    code: "E_EDGE_CROSSES_SCOPE",
    edit: (d) => {
      d.nodes.push(loop("lp"), transform("inner", "len(start.message)", { parent: "lp" }));
      d.edges.push({ id: "c9", from: { node: "inner", port: "done" }, to: { node: "out_auto" } });
    },
  },
  {
    code: "E_UNKNOWN_CONTROL_PORT",
    edit: (d) =>
      d.edges.push({ id: "c9", from: { node: "gate", port: "maybe" }, to: { node: "approve" } }),
  },
  {
    code: "E_SELF_EDGE",
    edit: (d) =>
      d.edges.push({ id: "c9", from: { node: "gate", port: "fail" }, to: { node: "gate" } }),
  },
  {
    code: "E_INPUT_UNKNOWN_PORT",
    edit: (d) => void (node(d, "intent").inputs.extra = { kind: "literal", value: 1 }),
  },
  { code: "E_INPUT_REQUIRED_MISSING", edit: (d) => void delete node(d, "intent").inputs.state },
  {
    code: "E_INPUT_LITERAL_INVALID",
    edit: (d) => void (node(d, "draft").inputs.prompt = { kind: "literal", value: 5 }),
  },
  {
    code: "W_CONTROL_PORT_UNCONNECTED",
    edit: (d) => void (d.edges = d.edges.filter((e: Doc) => e.id !== "c5")),
  },
  // refs, templates, expressions
  {
    code: "E_REF_UNKNOWN_NODE",
    edit: (d) => void (out(d, "out_auto").reply = ref("ghost", "text")),
  },
  {
    code: "E_REF_UNKNOWN_PORT",
    edit: (d) => void (out(d, "out_auto").reply = ref("draft", "nope")),
  },
  {
    code: "E_REF_PATH_INVALID",
    edit: (d) => void (out(d, "out_auto").team = ref("intent", "decision", "/nope")),
  },
  {
    code: "W_REF_PATH_UNTYPED",
    edit: (d) =>
      void (node(d, "draft").inputs.prompt = {
        kind: "template",
        source: "{{ coalesce(fetch_account.body.plan, 'none') }}",
      }),
  },
  {
    code: "E_REF_SELF",
    edit: (d) =>
      void (node(d, "draft").inputs.prompt = { kind: "template", source: "{{ draft.text }}" }),
  },
  {
    code: "E_REF_SCOPE_VIOLATION",
    edit: (d) => {
      d.nodes.push(loop("lp"), transform("inner", "'x'", { parent: "lp" }));
      out(d, "out_auto").reply = ref("inner", "result");
    },
  },
  {
    code: "E_SCOPE_REF_OUTSIDE_SCOPE",
    edit: (d) =>
      void (node(d, "draft").inputs.prompt = { kind: "template", source: "{{ $scope.item }}" }),
  },
  {
    code: "E_TEMPLATE_SYNTAX",
    edit: (d) =>
      void (node(d, "draft").inputs.prompt = { kind: "template", source: "Hi {{ start.message" }),
  },
  {
    code: "E_TEMPLATE_OBJECT_COERCION",
    edit: (d) =>
      void (node(d, "draft").inputs.prompt = {
        kind: "template",
        source: "Decision: {{ intent.decision }}",
      }),
  },
  {
    code: "E_EXPR_SYNTAX",
    edit: (d) => void (node(d, "route").cases[0].when = "intent.decision.value =="),
  },
  {
    code: "E_EXPR_TYPE",
    edit: (d) => void (node(d, "route").cases[0].when = "len(intent.decision.confidence) > 1"),
  },
  {
    code: "W_EXPR_UNTYPED",
    edit: (d) => {
      d.variables.push({ name: "anything", schema: {} });
      node(d, "route").cases[0].when = "$vars.anything > 1";
    },
  },
  {
    code: "E_EXPR_NOT_BOOLEAN",
    edit: (d) => void (node(d, "route").cases[0].when = "intent.decision.value"),
  },
  {
    code: "E_EXPR_REGEX_DYNAMIC",
    edit: (d) =>
      void (node(d, "route").cases[0].when = "regex_test(start.message, start.customer_id)"),
  },
  {
    code: "E_EXPR_REGEX_UNSAFE",
    edit: (d) => void (node(d, "route").cases[0].when = "regex_test(start.message, '^(a+)+$')"),
  },
  // dependency & control-flow analysis
  {
    code: "E_CYCLE",
    edit: (d) => void (node(d, "intent").inputs.state.fields.reply = ref("draft", "text")),
  },
  {
    code: "E_CONDITIONAL_DATA_DEP",
    edit: (d) =>
      void (node(d, "draft").inputs.prompt = {
        kind: "template",
        source: "{{ intent.decision.value }}: {{ fetch_account.body | json }}",
      }),
  },
  { code: "W_NULLABLE_INPUT" },
  { code: "W_UNREACHABLE", edit: (d) => d.nodes.push(transform("island", "1")) },
  {
    code: "E_DANGLING_DEPENDENCY",
    edit: (d) => {
      d.nodes.push(transform("island", "'x'"));
      out(d, "out_auto").extra = ref("island", "result");
    },
  },
  {
    code: "I_DANGLING_OUTPUT",
    edit: (d) => d.nodes.push(transform("unused", "len(start.message)")),
  },
  {
    code: "E_CONTROL_AMBIGUOUS",
    edit: (d) =>
      d.edges.push(
        { id: "c7", from: { node: "gate", port: "review" }, to: { node: "out_auto" } },
        { id: "c8", from: { node: "approve", port: "approved" }, to: { node: "out_auto" } },
      ),
  },
  {
    code: "I_CONTROL_AND",
    edit: (d) =>
      d.edges.push({ id: "c7", from: { node: "route", port: "billing" }, to: { node: "approve" } }),
  },
  {
    code: "W_IMPOSSIBLE_BRANCH",
    edit: (d) => void (node(d, "route").cases[0].when = "start.tier == 'platinum'"),
  },
  {
    code: "W_BRANCH_SHADOWED",
    edit: (d) =>
      node(d, "route").cases.push({ ...node(d, "route").cases[0], port: "billing_again" }),
  },
  {
    code: "W_UNREACHABLE_ROUTE",
    edit: (d) =>
      d.nodes.push(
        transform("router", "1", {
          type: "flowaid.decision.router",
          config: { routes: ["billing", "refunds"] },
          inputs: { decision: ref("intent", "decision") },
        }),
      ),
    options: {
      catalog: withManifest(
        manifestLike("flowaid.decision.router", {
          decision: { kind: "router" },
          configSchema: {
            type: "object",
            properties: { routes: { type: "array", items: { type: "string" } } },
          },
          inputs: [{ name: "decision", schema: {}, required: true }],
          portRules: [{ kind: "controlPortsFromConfig", path: "/routes" }],
        }),
      ),
    },
  },
  {
    code: "E_JOIN_CONFIG",
    edit: (d) => {
      d.nodes.push({
        id: "gather",
        kind: "join",
        name: "Gather",
        inputs: { a: ref("draft", "text") },
      });
      out(d, "out_auto").extra = ref("gather", "first");
    },
  },
  {
    code: "W_OUTPUT_AMBIGUOUS",
    edit: (d) =>
      d.nodes.push({
        id: "out_always",
        kind: "output",
        name: "Always",
        value: node(d, "out_rejected").value,
      }),
  },
  { code: "E_OUTPUT_UNBOUND", edit: (d) => void delete out(d, "out_auto").reply },
  {
    code: "E_OUTPUT_SCHEMA_MISMATCH",
    edit: (d) => void (out(d, "out_auto").reply = { kind: "literal", value: 5 }),
  },
  {
    code: "I_BATCH_GROUP",
    edit: (d) => d.nodes.push({ ...node(d, "intent"), id: "intent_again", name: "Intent again" }),
  },
  // types
  {
    code: "E_TYPE_MISMATCH",
    edit: (d) => void (node(d, "gate").inputs.decision = ref("draft", "text")),
  },
  { code: "W_TYPE_UNVERIFIED", edit: (d) => void (d.variables[1].schema = { type: "number" }) },
  // containers
  {
    code: "W_LOOP_NO_EXIT",
    edit: (d) => {
      const l = loop("lp");
      delete l.exitWhen;
      d.nodes.push(l, transform("inner", "len(start.message)", { parent: "lp" }));
      out(d, "out_auto").extra = ref("lp", "iterations");
    },
  },
  {
    code: "W_LOOSE_BOUNDS",
    edit: (d) => {
      d.nodes.push(
        loop("lp", { bounds: { maxIterations: 5000 } }),
        transform("inner", "len(start.message)", { parent: "lp" }),
      );
      out(d, "out_auto").extra = ref("lp", "iterations");
    },
  },
  {
    code: "E_FOREACH_NOT_ARRAY",
    edit: (d) => {
      d.nodes.push({
        id: "each",
        kind: "foreach",
        name: "Each",
        items: ref("start", "message"),
        bounds: { maxIterations: 10 },
      });
      d.nodes.push(transform("inner", "$scope.index", { parent: "each" }));
      out(d, "out_auto").extra = ref("each", "errors");
    },
  },
  {
    code: "E_FOREACH_COLLECT_MISSING",
    edit: (d) => {
      d.nodes.push({
        id: "each",
        kind: "foreach",
        name: "Each",
        items: { kind: "literal", value: [1, 2] },
        bounds: { maxIterations: 10 },
      });
      d.nodes.push(transform("inner", "$scope.index + len(start.message)", { parent: "each" }));
      out(d, "out_auto").extra = ref("each", "results");
    },
  },
  {
    code: "E_CARRY_TYPE_MISMATCH",
    edit: (d) => {
      const l = loop("lp");
      l.carry.next.extra = { kind: "literal", value: 1 };
      d.nodes.push(l, transform("inner", "len(start.message)", { parent: "lp" }));
      out(d, "out_auto").extra = ref("lp", "iterations");
    },
  },
  // subflows
  ...(
    ["E_SUBFLOW_UNRESOLVED", "E_SUBFLOW_CYCLE", "E_SUBFLOW_DEPTH", "E_SUBFLOW_SIGNATURE"] as const
  ).map((code): Case => ({
    code,
    edit: (d) => {
      d.nodes.push({
        id: "child",
        kind: "subflow",
        name: "Child",
        workflowId: code === "E_SUBFLOW_CYCLE" ? d.id : "11111111-1111-4111-8111-111111111111",
        inputs: {},
      });
      out(d, "out_auto").extra = ref("child", "output");
      if (code === "E_SUBFLOW_DEPTH") d.execution.maxSubflowDepth = 1;
    },
    options: {
      resolveSubflow: (id) =>
        code === "E_SUBFLOW_UNRESOLVED"
          ? undefined
          : {
              versionId: "22222222-2222-4222-8222-222222222222",
              inputs: {
                type: "object",
                properties: { x: { type: "string" } },
                required: code === "E_SUBFLOW_SIGNATURE" ? ["x"] : [],
              },
              outputs: { type: "object" },
              references:
                code === "E_SUBFLOW_DEPTH" && id.startsWith("1")
                  ? ["33333333-3333-4333-8333-333333333333"]
                  : [],
            },
    },
  })),
  // secrets, variables, credentials, providers
  {
    code: "E_SECRET_UNDECLARED",
    edit: (d) => void (node(d, "draft").credentials.llm = "NOPE_KEY"),
  },
  {
    code: "W_SECRET_UNUSED",
    edit: (d) => d.secrets.push({ name: "EXTRA_KEY", credentialType: "http.bearer" }),
  },
  { code: "E_SECRET_UNBOUND", options: { level: "publish", boundSecrets: new Set() } },
  { code: "W_SECRET_UNBOUND", options: { level: "draft", boundSecrets: new Set() } },
  {
    code: "E_CREDENTIAL_SLOT_UNBOUND",
    edit: (d) => void delete node(d, "intent").credentials.typesafe,
  },
  {
    code: "E_CREDENTIAL_TYPE_MISMATCH",
    edit: (d) => void (node(d, "draft").credentials.llm = "TYPESAFE_API_KEY"),
  },
  {
    code: "E_CAPABILITY_MISSING",
    edit: (d) => void (node(d, "gate").credentials = { typesafe: "TYPESAFE_API_KEY" }),
  },
  {
    code: "E_VARIABLE_UNDECLARED",
    edit: (d) =>
      void (node(d, "draft").inputs.prompt = { kind: "template", source: "{{ $vars.nope }}" }),
  },
  { code: "E_VARIABLE_DEFAULT_INVALID", edit: (d) => void (d.variables[1].default = "high") },
  {
    code: "W_VARIABLE_UNUSED",
    edit: (d) => d.variables.push({ name: "spare", schema: { type: "string" } }),
  },
  {
    code: "E_PROVIDER_UNAVAILABLE",
    options: { level: "publish", providers: { providers: new Set(["openai"]), models: [] } },
  },
  {
    code: "W_PROVIDER_UNAVAILABLE",
    options: { providers: { providers: new Set(["openai"]), models: [] } },
  },
  {
    code: "W_MODEL_DEPRECATED",
    options: {
      providers: {
        providers: new Set(["openai", "typesafe"]),
        models: [
          { provider: "openai", model: "gpt-4.1-mini", deprecated: "retired on 2027-01-01" },
        ],
      },
    },
  },
  {
    code: "W_FAILOVER_UNCONFIGURED",
    edit: (d) =>
      void (d.execution.decisions.failover = [
        { provider: "llm", model: { provider: "anthropic", model: "claude" } },
      ]),
    options: { providers: { providers: new Set(["openai", "typesafe"]), models: [] } },
  },
  // decisions, human, agent, policy
  {
    code: "E_DECISION_CONFIG",
    edit: (d) => void (node(d, "intent").config.options = { billing: "Only one" }),
  },
  { code: "E_HUMAN_CONFIG", edit: (d) => void (node(d, "approve").onExpire = "escalate") },
  {
    code: "E_AGENT_UNBOUNDED",
    edit: (d) => {
      delete d.execution.maxCostUsd;
      d.nodes.push(transform("agent", "1", { type: "flowaid.ai.agent", config: {} }));
      out(d, "out_auto").extra = ref("agent", "result");
    },
    options: {
      catalog: withManifest(
        manifestLike("flowaid.ai.agent", {
          metadata: {
            name: "Agent",
            description: "Tool loop",
            category: "agent",
            icon: "bot",
            tags: [],
          },
          configSchema: { type: "object", properties: { maxSteps: { type: "integer" } } },
        }),
      ),
    },
  },
  {
    code: "E_RETRY_ON_IRREVERSIBLE",
    edit: (d) => void (node(d, "fetch_account").config.method = "POST"),
  },
  {
    code: "W_RETRY_SIDE_EFFECT",
    edit: (d) => {
      node(d, "fetch_account").config.method = "POST";
      node(d, "fetch_account").policy.retry.allowOnIrreversible = true;
    },
  },
  {
    code: "E_DONOTPERSIST_SIDE_EFFECT",
    edit: (d) => {
      node(d, "fetch_account").config.method = "POST";
      node(d, "fetch_account").policy = { onError: "ignore", privacy: { doNotPersist: true } };
    },
  },
  // publish-time & runtime
  {
    code: "E_TRIGGER_CONFLICT",
    edit: (d) =>
      void (d.triggers = [
        { type: "webhook", path: "support" },
        { type: "webhook", path: "support" },
      ]),
  },
  { code: "W_COST_ESTIMATE", edit: (d) => void delete d.execution.maxCostUsd },
  {
    code: "E_PLAN_HASH_MISMATCH",
    run: () => {
      const result = compile(clone(), { catalog: catalogOf(FIXTURE_MANIFESTS) });
      if (!result.ok) throw new Error("reference workflow must compile");
      const tampered: ExecutionPlan = {
        ...result.plan,
        estimate: { ...result.plan.estimate, nodeCount: 99 },
      };
      return verifyPlanHash(tampered);
    },
  },
  {
    code: "E_INTERNAL",
    options: {
      catalog: {
        get: () => {
          throw new Error("catalog unavailable");
        },
        list: () => [],
      },
    },
  },
];

function diagnosticsFor(c: Case): Diagnostic[] {
  if (c.run) return c.run();
  const doc = clone();
  c.edit?.(doc);
  return compile(doc, { catalog: catalogOf(FIXTURE_MANIFESTS), ...c.options }).diagnostics;
}

describe("diagnostic codes", () => {
  it("covers every compiler-owned code exactly once", () => {
    const owned = DiagnosticCodeSchema.options.filter((c) => !NOT_COMPILER.includes(c));
    expect(CASES.map((c) => c.code).sort()).toEqual([...owned].sort());
    expect(owned).toHaveLength(94);
  });

  const snapshot: Record<string, Diagnostic[]> = {};
  it.each(CASES)("$code", (c) => {
    const diagnostics = diagnosticsFor(c);
    const hits = diagnostics.filter((d) => d.code === c.code);
    expect(hits.length, JSON.stringify(diagnostics, null, 2)).toBeGreaterThan(0);
    for (const d of hits)
      expect(d.severity).toBe(
        c.code.startsWith("E_") ? "error" : c.code.startsWith("W_") ? "warning" : "info",
      );
    snapshot[c.code] = hits;
  });

  it("matches the reviewed messages and locations", async () => {
    const ordered = Object.fromEntries(
      CASES.map((c) => [
        c.code,
        snapshot[c.code] ?? diagnosticsFor(c).filter((d) => d.code === c.code),
      ]),
    );
    await expect(
      `${JSON.stringify(JSON.parse(stableStringify(ordered)), null, 2)}\n`,
    ).toMatchFileSnapshot("../fixtures/diagnostics/codes.json");
  });
});
