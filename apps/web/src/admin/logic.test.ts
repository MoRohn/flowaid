import { describe, expect, it } from "vitest";
import {
  SCOPE_GROUPS,
  calibrationNote,
  caseResultViews,
  confusionPairs,
  credentialsForSecret,
  describeUserAgent,
  gateOf,
  missingRequiredSecrets,
  parseJsonObject,
  parseJsonText,
  parseTags,
  rowsToVariables,
  summaryMetrics,
  templateResourceSlots,
  templateToView,
  toCalibrationBins,
  variablesToRows,
  versionView,
} from "./logic";
import type {
  CaseResultRow,
  Credential,
  EvaluationCase,
  EvaluationSummary,
  TemplateRow,
} from "./types";

const summary = (over: Partial<EvaluationSummary> = {}): EvaluationSummary => ({
  cases: 4,
  passed: 3,
  passRate: 0.75,
  completionRate: 1,
  accuracy: { intent: 0.8 },
  calibration: {
    intent: { ece: 0.05, bins: [{ lo: 0.8, hi: 0.9, count: 2, accuracy: 0.5, confidence: 0.85 }] },
  },
  branchCorrectness: 1,
  schemaSuccess: 1,
  toolSuccess: 1,
  humanReviewRate: 0.25,
  latency: { p50: 100, p95: 300, p99: 400 },
  costUsd: { total: 0.04, perCase: 0.01 },
  ...over,
});

const credential = (over: Partial<Credential>): Credential => ({
  id: "c1",
  name: "key",
  type: "openai.api_key",
  storage: "db",
  externalRef: null,
  publicFields: {},
  hints: {},
  scopes: [],
  environmentId: null,
  allowedWorkflowIds: null,
  lastTestedAt: null,
  lastTestOk: null,
  lastUsedAt: null,
  rotatedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("JSON inputs", () => {
  it("parses, falls back on empty text and reports errors", () => {
    expect(parseJsonText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonText("", {})).toEqual({ ok: true, value: {} });
    expect(parseJsonText("").ok).toBe(false);
    expect(parseJsonText("{").ok).toBe(false);
  });
  it("accepts only objects where an object is required", () => {
    expect(parseJsonObject("[1]")).toEqual({ ok: false, error: "Expected a JSON object" });
    expect(parseJsonObject("")).toEqual({ ok: true, value: {} });
  });
  it("splits tags", () => {
    expect(parseTags(" a, b  c,a\n")).toEqual(["a", "b", "c"]);
  });
  it("round-trips variables, typing JSON values and rejecting bad names", () => {
    const r = rowsToVariables([
      { key: "REGION", value: "eu" },
      { key: "LIMIT", value: "5" },
      { key: "FLAGS", value: '{"x":true}' },
      { key: "bad-name", value: "1" },
      { key: "REGION", value: "us" },
      { key: "", value: "ignored" },
    ]);
    expect(r.value).toEqual({ REGION: "eu", LIMIT: 5, FLAGS: { x: true } });
    expect(r.errors).toHaveLength(2);
    expect(variablesToRows({ A: "x", B: 2 })).toEqual([
      { key: "A", value: "x" },
      { key: "B", value: "2" },
    ]);
  });
});

describe("scopes", () => {
  it("lists every scope once", () => {
    const all = SCOPE_GROUPS.flatMap((g) => g.scopes);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("runs:create");
    expect(all).not.toContain("mcp:serve");
  });
});

describe("templates", () => {
  const t: TemplateRow = {
    id: "t1",
    slug: "triage",
    name: "Triage",
    description: "d",
    category: "support",
    builtIn: true,
    requiredResources: {
      mcpServers: [{ key: "github", description: "GitHub", requiredTools: ["search"] }],
      knowledgeSources: [],
    },
    requiredSecrets: [],
    graph: {
      nodes: [
        { id: "in", kind: "input", type: null, name: "Input" },
        { id: "intent", kind: "task", type: "flowaid.decision.choice", name: "Intent" },
        { id: "ok", kind: "human", type: null, name: "Approve" },
        { id: "n", kind: "note", type: null, name: "Note" },
      ],
      edges: [
        { source: "in", target: "intent" },
        { source: "intent", target: "ok" },
        { source: "ok", target: "n" },
      ],
    },
  };
  it("projects nodes onto categories from the catalog and drops notes", () => {
    const v = templateToView(t, (type) => (type.includes("decision") ? "decision" : undefined));
    expect(v.nodes.map((n) => n.category)).toEqual(["flow", "decision", "human"]);
    expect(v.edges).toHaveLength(2);
    expect(v.decisionCount).toBe(1);
    expect(v.categories).toEqual(["flow", "decision", "human"]);
  });
  it("lists resource slots", () => {
    expect(templateResourceSlots(t)).toEqual([
      { key: "github", kind: "mcpServers", description: "GitHub", requiredTools: ["search"] },
    ]);
  });
});

describe("secrets", () => {
  it("matches credentials by type, environment and workflow allow-list", () => {
    const creds = [
      credential({ id: "a" }),
      credential({ id: "b", environmentId: "prod" }),
      credential({ id: "c", type: "anthropic.api_key" }),
      credential({ id: "d", allowedWorkflowIds: ["other"] }),
    ];
    expect(
      credentialsForSecret({ credentialType: "openai.api_key" }, creds, "dev", "w1").map(
        (c) => c.id,
      ),
    ).toEqual(["a"]);
    expect(
      credentialsForSecret({ credentialType: "openai.api_key" }, creds, "prod", "w1").map(
        (c) => c.id,
      ),
    ).toEqual(["a", "b"]);
  });
  it("reports unbound required secrets only", () => {
    expect(
      missingRequiredSecrets(
        [{ name: "A" }, { name: "B", required: false }, { name: "C", required: true }],
        { C: "id" },
      ),
    ).toEqual(["A"]);
  });
  it("does not count a required secret the server has a key for", () => {
    expect(
      missingRequiredSecrets(
        [
          { name: "TS", credentialType: "typesafe.api_key" },
          { name: "OPENAI", credentialType: "openai.api_key", required: true },
        ],
        {},
        new Set(["typesafe.api_key"]),
      ),
    ).toEqual(["OPENAI"]);
  });
});

describe("versions", () => {
  it("marks a version deployed to a protected environment as production", () => {
    const v = {
      id: "v",
      workflowId: "w",
      kind: "published" as const,
      version: 3,
      label: null,
      definitionHash: "h",
      planHash: "p",
      compilerVersion: "1",
      notes: "Raise threshold",
      publishedBy: null,
      createdAt: "2026-09-01T00:00:00Z",
    };
    expect(versionView(v, [{ protected: true }]).status).toBe("production");
    expect(versionView(v).status).toBe("published");
    expect(versionView(v).message).toBe("Raise threshold");
  });
});

describe("evaluation projections", () => {
  const cases: EvaluationCase[] = [
    {
      id: "k1",
      setId: "s",
      ordinal: 0,
      input: { message: "refund please" },
      expected: { decisions: { intent: { value: "billing" } } },
      metadata: {},
      tags: [],
      sourceRunId: null,
      createdAt: "",
    },
    {
      id: "k2",
      setId: "s",
      ordinal: 1,
      input: 42,
      expected: { decisions: { intent: { value: "tech" } } },
      metadata: {},
      tags: [],
      sourceRunId: null,
      createdAt: "",
    },
  ];
  const metrics = (value: string) => ({
    latencyMs: 10,
    costUsd: 0.001,
    tokens: 5,
    branches: {},
    decisions: { intent: { value, confidence: 0.9 } },
    humanRequested: false,
  });
  const results: CaseResultRow[] = [
    {
      caseId: "k1",
      runId: "r1",
      passed: true,
      checks: [],
      failures: [],
      metrics: metrics("billing"),
      status: "completed",
    },
    {
      caseId: "k2",
      runId: "r2",
      passed: false,
      checks: [
        {
          id: "decision:intent",
          kind: "decision",
          passed: false,
          expected: "tech",
          actual: "billing",
        },
      ],
      failures: ["intent"],
      metrics: metrics("billing"),
      status: "completed",
    },
  ];
  it("builds confusion pairs per decision node", () => {
    expect(confusionPairs(results, cases)).toEqual({
      intent: [
        { expected: "billing", actual: "billing" },
        { expected: "tech", actual: "billing" },
      ],
    });
  });
  it("names cases, carries the first failed check and flags regressions", () => {
    const second = results[1] as CaseResultRow;
    const rows = caseResultViews(results, cases, [{ ...second, passed: true }]);
    expect(rows[0]?.name).toBe("refund please");
    expect(rows[1]?.name).toBe("Case 2");
    expect(rows[1]).toMatchObject({ expected: "tech", actual: "billing", regression: true });
    expect(rows[0]?.regression).toBe(false);
  });
  it("maps metrics with baseline values and calibration bins", () => {
    const m = summaryMetrics(summary(), summary({ passRate: 0.5 }));
    expect(m.find((x) => x.key === "passRate")).toMatchObject({ candidate: 0.75, base: 0.5 });
    expect(m.find((x) => x.key === "accuracy:intent")?.candidate).toBe(0.8);
    expect(
      toCalibrationBins([
        { lo: 0, hi: 0.1, count: 0, accuracy: 0, confidence: 0 },
        { lo: 0.8, hi: 0.9, count: 2, accuracy: 0.5, confidence: 0.85 },
      ]),
    ).toEqual([{ lower: 0.8, upper: 0.9, predicted: 0.85, observed: 0.5, count: 2 }]);
    expect(calibrationNote(summary(), summary())).toContain("(was 0.050)");
  });
  it("derives the gate", () => {
    expect(gateOf({ verdict: "fail", warnings: [] })).toBe("fail");
    expect(gateOf({ verdict: "pass", warnings: [{}] })).toBe("warn");
    expect(gateOf({ verdict: "pass", warnings: [] })).toBe("pass");
    expect(gateOf(null)).toBe("warn");
  });
});

describe("user agents", () => {
  it("summarises browsers and platforms", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148 Safari/537.36",
      ),
    ).toBe("Chrome on macOS");
    expect(describeUserAgent("curl/8.7.1")).toBe("curl");
    expect(describeUserAgent(null)).toBe("Unknown client");
  });
});
