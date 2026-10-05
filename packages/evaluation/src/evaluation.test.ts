import { describe, expect, it } from "vitest";
import { booleanDecision, choiceDecision, scoreDecision } from "@flowaid/providers";
import type { DecisionProvider, JsonValue } from "@flowaid/workflow-core";
import { compare, flips, mcnemarExactP, regressionWarnings } from "./compare.js";
import { answersByNodeRun, batchIdOf } from "./decisions.js";
import {
  ExpectationSchema,
  parseCase,
  type EvaluationCase,
  type ExpectationInput,
} from "./expectation.js";
import { reportToMarkdown } from "./report.js";
import { runEvaluation } from "./runner.js";
import { scoreCase } from "./score.js";
import { NO_JUDGE_MODEL } from "./scorers/judge.js";
import { jsonEquals, matchValue } from "./scorers/matchers.js";
import { calibration, percentile, summarize } from "./summarize.js";
import type { CaseResult, LaunchRequest, RunRecord } from "./types.js";

const meta = { provider: "typesafe", model: "jev", latencyMs: 5, costUsd: 0.001 };
const kase = (
  expected: ExpectationInput,
  input: JsonValue = { message: "hi" },
  id = "c1",
): EvaluationCase => ({ id, input, expected: ExpectationSchema.parse(expected) });
const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  runId: "r1",
  status: "completed",
  outcome: "routed",
  output: { reply: "Your refund is on its way.", n: 7, tags: ["billing", "urgent"] },
  latencyMs: 1200,
  costUsd: 0.004,
  nodes: [],
  tools: [],
  humanRequested: false,
  ...over,
});

describe("matchers", () => {
  it.each([
    [{ type: "equals", value: { a: 1, b: [1, 2] } }, { b: [1, 2], a: 1 }, true],
    [{ type: "equals", value: 1 }, "1", false],
    [{ type: "contains", value: "refund" }, "Your refund is here", true],
    [{ type: "contains", value: "urgent" }, ["billing", "urgent"], true],
    [{ type: "contains", value: "x" }, { a: "yxz" }, true],
    [{ type: "contains", value: "nope" }, "text", false],
    [{ type: "regex", pattern: "^Your .* way\\.$" }, "Your refund is on its way.", true],
    [{ type: "regex", pattern: "^\\d+$" }, "12a", false],
    [{ type: "schema", schema: { type: "object", required: ["a"] } }, { a: 1 }, true],
    [{ type: "schema", schema: { type: "object", required: ["a"] } }, {}, false],
    [{ type: "range", min: 0, max: 10 }, 7, true],
    [{ type: "range", min: 8 }, 7, false],
    [{ type: "range", max: 1 }, "7", false],
  ] as const)("%j vs %j → %s", (matcher, actual, expected) => {
    expect(matchValue(matcher as never, actual as JsonValue).passed).toBe(expected);
  });

  it("rejects unsafe regexes instead of running them", () => {
    expect(matchValue({ type: "regex", pattern: "(a+)+$" }, "aaaa").passed).toBe(false);
  });

  it("jsonEquals is key-order independent", () => {
    expect(jsonEquals({ x: { b: 1, a: 2 } }, { x: { a: 2, b: 1 } })).toBe(true);
  });
});

describe("scoreCase", () => {
  it("checks output, decisions, branches, nodes, tools, status, outcome, latency, cost and human", async () => {
    const c = kase({
      output: [
        { path: "/reply", matcher: { type: "contains", value: "refund" } },
        { path: "/n", matcher: { type: "range", min: 1, max: 5 } },
      ],
      decisions: {
        intent: { value: "billing", minConfidence: 0.7 },
        urgency: { valueIn: ["high", 2] },
        refund: { value: "yes", range: [0.5, 1] },
      },
      branches: { gate: "pass" },
      requiredNodes: ["reply"],
      forbiddenNodes: ["escalate"],
      requiredTools: ["search"],
      forbiddenTools: ["refund_tool"],
      outcome: "routed",
      maxLatencyMs: 1000,
      maxCostUsd: 0.01,
      humanExpected: false,
    });
    const r = await scoreCase(
      c,
      run({
        nodes: [
          {
            nodeId: "intent",
            status: "completed",
            decision: choiceDecision({ billing: 0.8, bug: 0.2 }, meta),
          },
          {
            nodeId: "urgency",
            status: "completed",
            decision: scoreDecision([0, 0.1, 0.9], ["low", "medium", "high"], meta),
          },
          { nodeId: "refund", status: "completed", decision: booleanDecision(0.9, meta) },
          { nodeId: "gate", status: "completed", firedPort: "review" },
          { nodeId: "reply", status: "completed" },
          { nodeId: "escalate", status: "skipped" },
        ],
        tools: [{ name: "search", ok: true }],
      }),
    );
    const byId = Object.fromEntries(r.checks.map((k) => [k.id, k.passed]));
    expect(byId).toEqual({
      "output:/reply:contains": true,
      "output:/n:range": false,
      "decision:intent": true,
      "decision:urgency": true,
      "decision:refund": true,
      "branch:gate": false,
      "node:reply:required": true,
      "node:escalate:forbidden": true,
      "tool:search:required": true,
      "tool:refund_tool:forbidden": true,
      outcome: true,
      latency: false,
      cost: true,
      human: true,
    });
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual([
      "output:/n:range: 7 > 5",
      "branch:gate: gate fired review, expected pass",
      "latency",
    ]);
    expect(r.metrics.decisions.intent).toEqual({ value: "billing", confidence: 0.8 });
  });

  it("expects a completed run unless status or outcome says otherwise, and explains failures", async () => {
    const failed = await scoreCase(
      kase({}),
      run({ status: "failed", error: { code: "TIMEOUT", message: "slow" } }),
    );
    expect(failed.failures).toEqual(["status: run failed (TIMEOUT: slow)"]);
    expect(
      (await scoreCase(kase({ status: "waiting_for_human" }), run({ status: "waiting_for_human" })))
        .passed,
    ).toBe(true);
    const missing = await scoreCase(kase({ decisions: { intent: { value: "x" } } }), run());
    expect(missing.failures).toEqual(["decision:intent: intent made no decision"]);
  });

  it("judges with a decision provider over { input, expected?, actual }", async () => {
    const seen: unknown[] = [];
    const provider = {
      decideBoolean: (state: unknown) => (
        seen.push(state),
        Promise.resolve(booleanDecision(0.2, meta))
      ),
    } as unknown as DecisionProvider;
    const c = kase({
      output: [
        { path: "/reply", matcher: { type: "judge", instructions: "Is the reply polite?" } },
      ],
    });
    const r = await scoreCase(c, run(), { judge: provider });
    expect(r.checks[0]).toMatchObject({
      passed: false,
      actual: { pYes: 0.2 },
      message: expect.stringContaining("judge answered no"),
    });
    expect(seen[0]).toEqual({ input: { message: "hi" }, actual: "Your refund is on its way." });
    expect(r.metrics.judgeCostUsd).toBe(meta.costUsd);
    expect((await scoreCase(c, run())).failures[0]).toContain(NO_JUDGE_MODEL);
    expect(
      (await scoreCase(c, run(), { judgeUnavailable: "no judge model available: bad key" }))
        .checks[0]?.message,
    ).toBe("no judge model available: bad key");
    // no judge call, no judge cost
    expect((await scoreCase(c, run())).metrics.judgeCostUsd).toBeUndefined();
  });

  it("does not call the judge once the evaluation is cancelled", async () => {
    let calls = 0;
    const provider = {
      decideBoolean: () => (calls++, Promise.resolve(booleanDecision(0.9, meta))),
    } as unknown as DecisionProvider;
    const c = kase({
      output: [{ path: "/reply", matcher: { type: "judge", instructions: "Polite?" } }],
    });
    const ac = new AbortController();
    ac.abort();
    const r = await scoreCase(c, run(), { judge: provider, judgeContext: { signal: ac.signal } });
    expect(calls).toBe(0);
    expect(r.checks[0]).toMatchObject({ passed: false, message: expect.stringMatching(/cancel/) });
  });

  it("counts judge costs in the summary total but not in cost per case", () => {
    const base = {
      latencyMs: 1,
      tokens: 0,
      branches: {},
      decisions: {},
      humanRequested: false,
      toolCalls: { total: 0, ok: 0 },
      schemaErrors: 0,
    };
    const s = summarize([
      {
        caseId: "a",
        runId: "r1",
        passed: true,
        checks: [],
        failures: [],
        status: "completed",
        metrics: { ...base, costUsd: 0.02, judgeCostUsd: 0.001 },
      },
      {
        caseId: "b",
        runId: "r2",
        passed: true,
        checks: [],
        failures: [],
        status: "completed",
        metrics: { ...base, costUsd: 0.04 },
      },
    ]);
    expect(s.costUsd.perCase).toBeCloseTo(0.03);
    expect(s.costUsd.judge).toBeCloseTo(0.001);
    expect(s.costUsd.total).toBeCloseTo(0.061);
  });
});

describe("calibration and summary", () => {
  it("computes ECE over equal-width bins", () => {
    // Perfectly calibrated: 80 % confident, 80 % correct.
    const perfect = Array.from({ length: 10 }, (_, i) => ({ confidence: 0.85, correct: i < 8 }));
    expect(calibration(perfect).ece).toBeCloseTo(0.05);
    // Overconfident: 95 % confident, 50 % correct.
    const over = Array.from({ length: 10 }, (_, i) => ({ confidence: 0.95, correct: i % 2 === 0 }));
    const cal = calibration(over);
    expect(cal.ece).toBeCloseTo(0.45);
    expect(cal.bins[9]).toMatchObject({ lo: 0.9, hi: 1, count: 10, accuracy: 0.5 });
    // Two bins: ECE is the count-weighted gap.
    const mixed = [
      ...Array.from({ length: 4 }, () => ({ confidence: 0.35, correct: false })),
      ...Array.from({ length: 6 }, () => ({ confidence: 1, correct: true })),
    ];
    expect(calibration(mixed).ece).toBeCloseTo(0.4 * 0.35 + 0.6 * 0);
  });

  it("percentiles use nearest rank", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect([
      percentile(xs, 50),
      percentile(xs, 95),
      percentile(xs, 99),
      percentile([], 50),
    ]).toEqual([50, 95, 99, 0]);
  });

  it("summarises pass rate, accuracy, branches, tools, humans, latency and cost", async () => {
    const results: CaseResult[] = [];
    for (const [i, ok] of [true, true, false, true].entries()) {
      results.push(
        await scoreCase(
          kase(
            {
              decisions: { intent: { value: "billing" } },
              branches: { gate: "pass" },
              output: [{ path: "", matcher: { type: "schema", schema: { type: "object" } } }],
            },
            {},
            `c${i}`,
          ),
          run({
            runId: `r${i}`,
            latencyMs: 100 * (i + 1),
            costUsd: 0.01,
            humanRequested: i === 3,
            tools: [{ name: "t", ok }],
            nodes: [
              {
                nodeId: "intent",
                status: "completed",
                decision: choiceDecision(
                  ok ? { billing: 0.9, bug: 0.1 } : { billing: 0.3, bug: 0.7 },
                  meta,
                ),
              },
              { nodeId: "gate", status: "completed", firedPort: ok ? "pass" : "review" },
            ],
          }),
        ),
      );
    }
    const s = summarize(results);
    expect(s).toMatchObject({
      cases: 4,
      passed: 3,
      passRate: 0.75,
      completionRate: 1,
      branchCorrectness: 0.75,
      schemaSuccess: 1,
      toolSuccess: 0.75,
      humanReviewRate: 0.25,
    });
    expect(s.accuracy.intent).toBe(0.75);
    expect(s.latency).toEqual({ p50: 200, p95: 400, p99: 400 });
    expect(s.costUsd.total).toBeCloseTo(0.04);
    // The wrong answer chose "bug" at 0.7 confidence; the right ones "billing" at 0.9.
    expect(s.calibration.intent?.ece).toBeCloseTo(0.25 * 0.7 + 0.75 * 0.1);
  });
});

describe("batch decision steps", () => {
  // Message triage's `triage` step: three questions about one message, answered in one request
  const topic = choiceDecision({ billing: 0.1, feedback: 0.85, other: 0.05 }, meta);
  const urgency = scoreDecision([0.7, 0.2, 0.1], ["low", "normal", "high"], meta);
  const needsPerson = booleanDecision(0.2, meta);
  const triage = (over: Partial<RunRecord["nodes"][number]> = {}) =>
    run({
      nodes: [
        {
          nodeId: "triage",
          status: "completed",
          // what node_runs.decision holds for a batch step: one of the answers
          decision: needsPerson,
          answers: { topic, urgency, needs_person: needsPerson },
          ...over,
        },
      ],
    });

  it("scores each question, and a case naming only the step against the question it fits", async () => {
    const r = await scoreCase(
      kase({
        decisions: {
          // written before answers were recorded per question: "feedback" is a topic option
          triage: { value: "feedback" },
          "triage.urgency": { value: "low", minConfidence: 0.6 },
          "triage.needs_person": { value: false },
        },
      }),
      triage(),
    );
    expect(r.failures).toEqual([]);
    expect(r.checks.filter((c) => c.kind === "decision").map((c) => c.id)).toEqual([
      "decision:triage.topic",
      "decision:triage.urgency",
      "decision:triage.needs_person",
    ]);
    expect(r.checks[0]).toMatchObject({
      expected: { value: "feedback" },
      actual: { value: "feedback", confidence: 0.85 },
    });
    expect(r.metrics.decisions).toEqual({
      "triage.topic": { value: "feedback", confidence: 0.85 },
      "triage.urgency": { value: urgency.value, confidence: 0.7 },
      "triage.needs_person": { value: false, confidence: 0.8 },
    });
  });

  it("explains a question it can't find or can't tell apart", async () => {
    const r = await scoreCase(
      kase({
        decisions: {
          "triage.nope": { value: "x" },
          triage: { minConfidence: 0.5 },
          "route.label": { value: "x" },
        },
      }),
      triage(),
    );
    expect(r.failures).toEqual([
      "decision:triage.nope: triage has no question nope (it asks topic, urgency, needs_person)",
      'decision:triage: triage answers 3 questions (topic, urgency, needs_person): name one, as "triage.topic"',
      "decision:route.label: route made no decision",
    ]);
  });

  it("keeps a single-question step's meaning, and refuses a question on it", async () => {
    const single = run({
      nodes: [{ nodeId: "intent", status: "completed", decision: topic }],
    });
    expect(
      (await scoreCase(kase({ decisions: { intent: { value: "feedback" } } }), single)).passed,
    ).toBe(true);
    expect(
      (await scoreCase(kase({ decisions: { "intent.topic": { value: "feedback" } } }), single))
        .failures,
    ).toEqual([
      'decision:intent.topic: intent is not a batch step: expect "intent" without a question',
    ]);
  });

  it("summarises accuracy and calibration per question", async () => {
    const r = await scoreCase(
      kase({ decisions: { "triage.topic": { value: "feedback" }, triage: { value: "high" } } }),
      triage(),
    );
    const s = summarize([r]);
    expect(Object.keys(s.accuracy).sort()).toEqual(["triage.topic", "triage.urgency"]);
    expect(s.accuracy["triage.urgency"]).toBe(0);
    expect(s.calibration["triage.topic"]?.bins.some((b) => b.count === 1)).toBe(true);
  });

  it("reads a batch step's answers from its per-question events", () => {
    const events = [
      { nodeRunId: "n1", batchId: "n1:batch", question: "topic", decision: topic },
      { nodeRunId: "n1", batchId: "n1:batch", question: "urgency", decision: urgency },
      // a single decision step's event: not a batch answer
      { nodeRunId: "n2", batchId: "n2:3f2a1b0c", question: "Is it urgent?", decision: needsPerson },
    ];
    expect(answersByNodeRun(events)).toEqual(new Map([["n1", { topic, urgency }]]));
    expect(batchIdOf("n1")).toBe("n1:batch");
  });

  it("accepts <step>.<question> keys and nothing deeper", () => {
    expect(
      ExpectationSchema.safeParse({ decisions: { "triage.topic": { value: "x" } } }).success,
    ).toBe(true);
    expect(ExpectationSchema.safeParse({ decisions: { "a.b.c": { value: "x" } } }).success).toBe(
      false,
    );
  });
});

describe("runEvaluation", () => {
  it("runs cases with bounded concurrency, labels, human auto-responses, and survives launch failures", async () => {
    let active = 0;
    let peak = 0;
    const launched: LaunchRequest[] = [];
    const launcher = {
      launch: async (req: LaunchRequest): Promise<RunRecord> => {
        launched.push(req);
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (req.caseId === "boom") throw new Error("queue unavailable");
        return run({ runId: `run-${req.caseId}`, output: { reply: req.caseId } });
      },
    };
    const cases = [
      ...Array.from({ length: 6 }, (_, i) =>
        kase(
          { output: [{ path: "/reply", matcher: { type: "equals", value: `c${i}` } }] },
          {},
          `c${i}`,
        ),
      ),
      kase({ human: { approve_refund: { action: "reject", comment: "no" } } }, {}, "boom"),
    ];
    const seen: string[] = [];
    const out = await runEvaluation({
      evaluationRunId: "e1",
      cases,
      launcher,
      concurrency: 2,
      onResult: (r) => void seen.push(r.caseId),
    });
    expect(peak).toBe(2);
    expect(out.results.map((r) => r.caseId)).toEqual(cases.map((c) => c.id));
    expect(seen.sort()).toEqual(cases.map((c) => c.id).sort());
    expect(out.summary).toMatchObject({ cases: 7, passed: 6 });
    expect(out.results.at(-1)).toMatchObject({
      status: "launch_failed",
      runId: null,
      failures: ["run: queue unavailable"],
    });
    expect(launched.find((l) => l.caseId === "boom")).toMatchObject({
      labels: { evaluationRunId: "e1", caseId: "boom" },
      human: { approve_refund: { action: "reject" } },
    });
  });

  it("stops launching when cancelled", async () => {
    const controller = new AbortController();
    let count = 0;
    const launcher = {
      launch: () => (++count === 2 && controller.abort(), Promise.resolve(run())),
    };
    const out = await runEvaluation({
      evaluationRunId: "e",
      cases: Array.from({ length: 10 }, (_, i) => kase({}, {}, `c${i}`)),
      launcher,
      concurrency: 1,
      signal: controller.signal,
    });
    expect(out.cancelled).toBe(true);
    expect(count).toBe(2);
  });

  it("parses stored cases with defaults", () => {
    expect(parseCase({ id: "x", input: null, expected: {} }).expected).toMatchObject({
      output: [],
      decisions: {},
      human: {},
    });
  });
});

describe("compare and report", () => {
  const result = (id: string, passed: boolean, value: string, latency: number): CaseResult => ({
    caseId: id,
    runId: `r-${id}`,
    passed,
    checks: [
      { kind: "decision", id: "decision:intent", passed, actual: { value, confidence: 0.9 } },
    ],
    failures: passed ? [] : ["decision:intent"],
    metrics: {
      latencyMs: latency,
      costUsd: 0.01,
      tokens: 0,
      branches: {},
      decisions: { intent: { value, confidence: 0.9 } },
      humanRequested: false,
      toolCalls: { total: 0, ok: 0 },
      schemaErrors: 0,
    },
    status: "completed",
  });
  const baseline = [
    result("a", true, "billing", 100),
    result("b", true, "bug", 100),
    result("c", false, "other", 100),
  ];
  const current = [
    result("a", true, "billing", 150),
    result("b", false, "other", 200),
    result("c", true, "bug", 100),
  ];

  it("reports deltas, flips, verdict against the gate, and regression warnings", () => {
    const r = compare({
      versionId: "v2",
      results: current,
      summary: summarize(current),
      baseline: { versionId: "v1", results: baseline, summary: summarize(baseline) },
      gate: { minPassRate: 0.7 },
    });
    expect(r.verdict).toBe("fail");
    expect(r.deltas.passRate).toBeCloseTo(0);
    expect(r.flips.filter((f) => f.field === "passed")).toEqual([
      { caseId: "b", field: "passed", before: true, after: false },
      { caseId: "c", field: "passed", before: false, after: true },
    ]);
    expect(r.flips.some((f) => f.field === "decisions.intent" && f.caseId === "b")).toBe(true);
    expect(r.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("p95 latency rose 100%"),
    ]);
    const md = reportToMarkdown(r);
    expect(md).toContain("## Evaluation: FAIL");
    expect(md).toContain("Gate: pass rate ≥ 70.0%");
    expect(md).toContain("| b | passed | true | false |");
  });

  it("passes without a baseline or gate, and flags pass-rate and cost regressions", () => {
    expect(
      compare({ versionId: "v", results: current, summary: summarize(current) }),
    ).toMatchObject({ verdict: "pass", baselineVersionId: null, flips: [], warnings: [] });
    const good = summarize(baseline.map((b) => ({ ...b, passed: true })));
    const worse = {
      ...summarize(current),
      costUsd: { total: 1, perCase: good.costUsd.perCase * 1.5, judge: 0 },
    };
    expect(regressionWarnings(worse, good).map((w) => w.message)).toEqual([
      expect.stringContaining("pass rate dropped 33.3 pt"),
      expect.stringContaining("p95"),
      expect.stringContaining("cost per case rose 50%"),
    ]);
    expect(flips(current, [])).toEqual([]);
  });

  it("computes the exact McNemar p-value from discordant pairs", () => {
    expect(mcnemarExactP(0, 0)).toBe(1);
    expect(mcnemarExactP(1, 0)).toBe(1);
    // 2 · (1/2)^6
    expect(mcnemarExactP(6, 0)).toBeCloseTo(0.03125, 12);
    // 2 · (C(12,0) + C(12,1) + C(12,2)) / 2^12 = 2 · 79 / 4096
    expect(mcnemarExactP(10, 2)).toBeCloseTo(158 / 4096, 12);
    expect(mcnemarExactP(2, 10)).toBeCloseTo(158 / 4096, 12);
  });

  describe("pass-rate regressions over paired cases", () => {
    const run = (n: number, regressed: number, improved = 0) => {
      const base = Array.from({ length: n }, (_, i) =>
        result(`k${i}`, i >= regressed + improved || i < regressed, "billing", 100),
      );
      const cur = base.map((r, i) => (i < regressed + improved ? { ...r, passed: !r.passed } : r));
      return compare({
        versionId: "v2",
        results: cur,
        summary: summarize(cur),
        baseline: { versionId: "v1", results: base, summary: summarize(base) },
      }).warnings.filter((w) => w.message.startsWith("pass rate"));
    };

    it("does not warn on one flip in 20 cases (5 pt drop, p = 1)", () => {
      expect(run(20, 1)).toEqual([]);
    });

    it("warns when the drop is significant, with n and p", () => {
      const w = run(20, 6);
      expect(w).toHaveLength(1);
      expect(w[0]?.message).toContain("pass rate dropped 30.0 pt");
      expect(w[0]?.message).toContain("n = 20 paired cases");
      expect(w[0]?.message).toContain("6 regressed, 0 improved");
      expect(w[0]?.message).toContain("McNemar exact p = 0.031");
    });

    it("warns on a drop past the threshold once there are enough cases", () => {
      // 150 cases, 4 regressions: 2.7 pt > 2 pt, p = 0.125 but n ≥ 100
      const w = run(150, 4);
      expect(w).toHaveLength(1);
      expect(w[0]?.message).toContain("p = 0.125");
      // the same drop on 40 cases is not significant and n is small
      expect(run(40, 2)).toEqual([]);
    });
  });
});
