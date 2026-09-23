import { describe, expect, it } from "vitest";
import * as core from "./index.js";
import {
  RESERVED_IDS,
  NodeIdSchema,
  NodeTypeIdSchema,
  ScopePathSchema,
  EdgeIdSchema,
  SecretNameSchema,
  VarNameSchema,
  CredentialTypeIdSchema,
  ToolNameSchema,
  ScopeIdSchema,
  SemverSchema,
} from "./ids.js";
import {
  EXPRESSION_FUNCTION_NAMES,
  EXPRESSION_KEYWORDS,
  isExpressionFunction,
  LAMBDA_FUNCTIONS,
} from "./expr/functions.js";
import { TERMINAL_RUN_STATUSES, RunStatusSchema } from "./run.js";
import { TERMINAL_EVENT_TYPES, RunEventSchema } from "./events.js";
import { ExecutionPolicySchema, RetryPolicySchema, NodePolicySchema } from "./policy.js";
import { JsonPointerSchema, JsonPatchOpSchema, JsonSchemaSchema } from "./json.js";
import { HumanRequestSchema, HumanResponseSchema } from "./human.js";
import { DiagnosticCodeSchema } from "./diagnostics.js";
import { WORKFLOW_SCHEMA_URI } from "./definition.js";

describe("identifier schemas", () => {
  it("validate node ids, ports, edges and types per §2.1", () => {
    expect(NodeIdSchema.safeParse("fetch_account").success).toBe(true);
    expect(NodeIdSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(NodeIdSchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(NodeIdSchema.safeParse("Fetch").success).toBe(false);
    expect(NodeIdSchema.safeParse("1a").success).toBe(false);
    expect(EdgeIdSchema.safeParse("c1").success).toBe(true);
    expect(EdgeIdSchema.safeParse("edge-1_x").success).toBe(true);
    expect(EdgeIdSchema.safeParse("-x").success).toBe(false);
    expect(NodeTypeIdSchema.safeParse("flowaid.decision.confidence_gate").success).toBe(true);
    expect(NodeTypeIdSchema.safeParse("@community/slack.post_message").success).toBe(true);
    expect(NodeTypeIdSchema.safeParse("flowaid").success).toBe(false);
    expect(NodeTypeIdSchema.safeParse("Flowaid.x").success).toBe(false);
    expect(SemverSchema.safeParse("1.0.0").success).toBe(true);
    expect(SemverSchema.safeParse("1.0").success).toBe(false);
    expect(SecretNameSchema.safeParse("TYPESAFE_API_KEY").success).toBe(true);
    expect(SecretNameSchema.safeParse("typesafe").success).toBe(false);
    expect(VarNameSchema.safeParse("crmBaseUrl").success).toBe(true);
    expect(VarNameSchema.safeParse("CrmBaseUrl").success).toBe(false);
    expect(ScopePathSchema.safeParse("").success).toBe(true);
    expect(ScopePathSchema.safeParse("research#2/search_all#0").success).toBe(true);
    expect(ScopePathSchema.safeParse("research#").success).toBe(false);
    expect(ScopeIdSchema.safeParse("").success).toBe(true);
    expect(ScopeIdSchema.safeParse("research").success).toBe(true);
    expect(ScopeIdSchema.safeParse("research#1").success).toBe(false);
    expect(ToolNameSchema.safeParse("add_issue_comment").success).toBe(true);
    expect(ToolNameSchema.safeParse("a b").success).toBe(false);
    expect(CredentialTypeIdSchema.safeParse("typesafe.api_key").success).toBe(true);
    expect(CredentialTypeIdSchema.safeParse("typesafe").success).toBe(false);
  });

  it("RESERVED_IDS equals keywords ∪ function names", () => {
    const expected = new Set<string>([...EXPRESSION_KEYWORDS, ...EXPRESSION_FUNCTION_NAMES]);
    expect(new Set(RESERVED_IDS)).toEqual(expected);
    expect(EXPRESSION_FUNCTION_NAMES).toHaveLength(38);
    expect(EXPRESSION_KEYWORDS).toHaveLength(5);
    expect(RESERVED_IDS.size).toBe(43);
    for (const fn of EXPRESSION_FUNCTION_NAMES) expect(isExpressionFunction(fn)).toBe(true);
    expect(isExpressionFunction("eval")).toBe(false);
    for (const fn of LAMBDA_FUNCTIONS) expect(isExpressionFunction(fn)).toBe(true);
  });
});

describe("JSON schemas", () => {
  it("JsonPointerSchema follows RFC 6901", () => {
    for (const ok of ["", "/", "/a/0/b", "/a~0b/c~1d", "/x-y/a b"])
      expect(JsonPointerSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["a", "a/b", "/a~b", "/a~2"])
      expect(JsonPointerSchema.safeParse(bad).success, bad).toBe(false);
  });

  it("JsonPatchOpSchema accepts every op", () => {
    expect(JsonPatchOpSchema.safeParse({ op: "add", path: "/a", value: 1 }).success).toBe(true);
    expect(JsonPatchOpSchema.safeParse({ op: "remove", path: "/a" }).success).toBe(true);
    expect(JsonPatchOpSchema.safeParse({ op: "replace", path: "/a", value: null }).success).toBe(
      true,
    );
    expect(JsonPatchOpSchema.safeParse({ op: "move", from: "/a", path: "/b" }).success).toBe(true);
    expect(JsonPatchOpSchema.safeParse({ op: "copy", from: "/a", path: "/b" }).success).toBe(true);
    expect(JsonPatchOpSchema.safeParse({ op: "test", path: "/a", value: [1] }).success).toBe(true);
    expect(JsonPatchOpSchema.safeParse({ op: "add", path: "a", value: 1 }).success).toBe(false);
  });

  it("JsonSchemaSchema keeps unknown keywords and validates known ones", () => {
    const schema = {
      type: "object",
      properties: { a: { type: ["string", "null"], "x-dataClass": "pii" } },
      "x-ui": { widget: "json" },
      patternProperties: { "^x": {} },
    };
    const parsed = JsonSchemaSchema.parse(schema);
    expect(parsed).toEqual(schema);
    expect(parsed.patternProperties).toEqual({ "^x": {} });
    expect(JsonSchemaSchema.safeParse({ type: "stringy" }).success).toBe(false);
    expect(JsonSchemaSchema.safeParse({ "x-ui": { widget: "unknown" } }).success).toBe(false);
  });
});

describe("policies", () => {
  it("ExecutionPolicySchema fills every default from {}", () => {
    expect(ExecutionPolicySchema.parse({})).toEqual({
      timeoutMs: 900_000,
      maxNodeRuns: 2_000,
      maxSubflowDepth: 4,
      concurrency: 8,
      defaultRetry: {
        maxAttempts: 1,
        backoff: { type: "exponential", initialMs: 500, maxMs: 30_000, factor: 2, jitter: true },
        allowOnIrreversible: false,
      },
      defaultNodeTimeoutMs: 120_000,
      decisions: {
        primary: { provider: "typesafe", model: "jev-latest" },
        failover: [],
        batching: true,
      },
      privacy: { sensitive: false, containsPII: false, doNotPersist: false, redactFields: [] },
      retention: "standard",
    });
  });

  it("RetryPolicySchema and NodePolicySchema apply defaults and limits", () => {
    expect(RetryPolicySchema.parse({ maxAttempts: 3 }).backoff.type).toBe("exponential");
    expect(RetryPolicySchema.safeParse({ maxAttempts: 21 }).success).toBe(false);
    expect(NodePolicySchema.parse({}).onError).toBe("fail");
    expect(NodePolicySchema.safeParse({ timeoutMs: 0 }).success).toBe(false);
  });
});

describe("runs and events", () => {
  it("terminal sets are subsets of their enums", () => {
    for (const s of TERMINAL_RUN_STATUSES) expect(RunStatusSchema.options).toContain(s);
    expect(TERMINAL_RUN_STATUSES.size).toBe(4);
    const eventTypes = new Set(RunEventSchema.options.map((o) => o.shape.type.value));
    for (const t of TERMINAL_EVENT_TYPES) expect(eventTypes.has(t), t).toBe(true);
    expect(eventTypes.size).toBe(50);
  });

  it("validates a node event with the full address and rejects a wrong scope", () => {
    const event = {
      type: "NODE_SKIPPED",
      runId: "5b1c2b60-6e0f-4a1a-9b0e-1b1a2c3d4e5f",
      seq: 3,
      at: "2026-09-22T10:00:00.000Z",
      nodeRunId: "5b1c2b60-6e0f-4a1a-9b0e-1b1a2c3d4e60",
      nodeId: "fetch_account",
      scope: "research#0",
      attempt: 1,
      reason: "pruned",
    };
    expect(RunEventSchema.parse(event)).toEqual(event);
    expect(RunEventSchema.safeParse({ ...event, scope: "bad scope" }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...event, reason: "other" }).success).toBe(false);
    expect(
      RunEventSchema.safeParse({
        type: "HEARTBEAT",
        runId: event.runId,
        seq: 0,
        at: event.at,
        ephemeral: true,
      }).success,
    ).toBe(true);
    expect(
      RunEventSchema.safeParse({
        type: "HEARTBEAT",
        runId: event.runId,
        seq: 0,
        at: event.at,
        ephemeral: false,
      }).success,
    ).toBe(false);
  });
});

describe("human wire formats", () => {
  it("validate requests and responses", () => {
    const request = {
      title: "Review",
      context: { a: 1 },
      mode: { type: "review", value: "text", schema: { type: "string" } },
      assignees: ["role:x"],
      expiresAt: null,
      externalReview: true,
      origin: "human_node",
    };
    expect(HumanRequestSchema.parse(request)).toEqual(request);
    expect(
      HumanRequestSchema.safeParse({
        ...request,
        mode: { type: "choice", options: [{ id: "a", label: "A" }] },
      }).success,
    ).toBe(false);
    expect(HumanResponseSchema.safeParse({ action: "approve", value: "edited" }).success).toBe(
      true,
    );
    expect(HumanResponseSchema.safeParse({ action: "choose", option: "Yes" }).success).toBe(false);
    expect(HumanResponseSchema.safeParse({ action: "escalate", to: [] }).success).toBe(false);
    expect(HumanResponseSchema.safeParse({ action: "submit", value: { ok: true } }).success).toBe(
      true,
    );
  });
});

describe("package surface", () => {
  it("exports every declared contract value", () => {
    const expectedValues = [
      "JsonValueSchema",
      "JsonSchemaSchema",
      "RefSchema",
      "BindingSchema",
      "ExprAstSchema",
      "CompiledTemplateSchema",
      "parseRef",
      "formatRef",
      "parseExpression",
      "evaluateExpression",
      "parseTemplate",
      "renderTemplate",
      "isSubschema",
      "projectSchema",
      "NodeManifestSchema",
      "PortRuleSchema",
      "ExecutionPolicySchema",
      "WorkflowNodeSchema",
      "WorkflowDefinitionSchema",
      "definitionHash",
      "DecisionResultSchema",
      "DecisionResultJsonSchema",
      "FlowaidError",
      "toFlowaidError",
      "ErrorEnvelopeSchema",
      "HumanRequestSchema",
      "HumanResponseSchema",
      "HumanDecisionSchema",
      "RunSchema",
      "NodeRunSchema",
      "RunEventSchema",
      "DiagnosticSchema",
      "ExecutionPlanSchema",
      "PlanNodeSchema",
      "PlanOpSchema",
      "ToolResultSchema",
      "DecisionQuestionSchema",
      "RESERVED_IDS",
      "TERMINAL_RUN_STATUSES",
      "TERMINAL_EVENT_TYPES",
      "WORKFLOW_SCHEMA_URI",
    ] as const;
    for (const name of expectedValues) expect(core[name], name).toBeDefined();
    expect(WORKFLOW_SCHEMA_URI).toBe("https://flowaid.dev/schemas/workflow/v1");
    expect(DiagnosticCodeSchema.options.length).toBe(96);
  });

  it("exposes the FlowExpr, template and subschema entry points with their contract arities", () => {
    // Implementation status is covered by their own suites; the package surface only pins the signatures.
    const signatures: [keyof typeof core, number][] = [
      ["parseExpression", 1],
      ["evaluateExpression", 2],
      ["parseTemplate", 1],
      ["renderTemplate", 2],
      ["isSubschema", 2],
      ["projectSchema", 2],
    ];
    for (const [name, arity] of signatures) {
      const fn = core[name];
      expect(typeof fn, name).toBe("function");
      if (typeof fn === "function") expect(fn.length, `${name} arity`).toBe(arity);
    }
  });
});
