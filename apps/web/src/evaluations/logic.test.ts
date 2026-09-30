import { describe, expect, it } from "vitest";
import type { CaseResultRow, EvaluationCase, EvaluationSummary } from "~/admin/types";
import {
  ANY_WORKFLOW,
  NO_JUDGE,
  caseCoverage,
  checksOnlyCompletion,
  emptySetDraft,
  reportReading,
  setBody,
  setReviewNotes,
  usesJudge,
} from "./logic";

const ids = (notes: { id: string; state: string }[]) => notes.map((n) => `${n.id}:${n.state}`);

describe("new set", () => {
  it("blocks an empty or taken name and explains an untied set", () => {
    const ctx = { existingNames: ["Refunds"], workflowName: null };
    expect(ids(setReviewNotes(emptySetDraft(), ctx))).toEqual([
      "name:blocker",
      "any-workflow:info",
      "no-description:optional",
    ]);
    expect(
      ids(setReviewNotes({ ...emptySetDraft(), name: " Refunds " }, ctx)).includes(
        "name-taken:blocker",
      ),
    ).toBe(true);
  });

  it("confirms the workflow and sends it only when one is chosen", () => {
    const d = { name: " Routing ", description: "x", workflowId: "wf-1" };
    expect(
      setReviewNotes(d, { existingNames: [], workflowName: "Support" }).map((n) => n.message),
    ).toEqual([expect.stringMatching(/^Tests Support/)]);
    expect(setBody(d)).toEqual({ name: "Routing", description: "x", workflowId: "wf-1" });
    expect(setBody({ ...d, workflowId: ANY_WORKFLOW })).toEqual({
      name: "Routing",
      description: "x",
    });
  });
});

const kase = (over: Partial<EvaluationCase>): EvaluationCase => ({
  id: "c",
  setId: "s",
  ordinal: 0,
  input: {},
  expected: { status: "completed", output: [], decisions: {}, branches: {} },
  metadata: {},
  tags: [],
  sourceRunId: null,
  createdAt: "",
  ...over,
});

describe("case checks", () => {
  it("tells a case that only checks completion from one that checks the answer", () => {
    expect(checksOnlyCompletion({ status: "completed", output: [], decisions: {} })).toBe(true);
    expect(checksOnlyCompletion({ branches: { route: "refunds" } })).toBe(false);
    expect(checksOnlyCompletion({ humanExpected: true })).toBe(false);
    expect(
      usesJudge({ output: [{ path: "", matcher: { type: "judge", instructions: "" } }] }),
    ).toBe(true);
  });

  it("reports coverage from the cases themselves", () => {
    expect(caseCoverage([])).toEqual([]);
    const weak = caseCoverage([kase({ id: "a" }), kase({ id: "b", tags: ["edge"] })]);
    expect(ids(weak)).toEqual([
      "weak:warning",
      "from-runs:optional",
      "tags:ok",
      "escalation:optional",
    ]);
    expect(weak[0]?.message).toMatch(/^2 of 2 cases only check/);
    const good = caseCoverage([
      kase({
        expected: {
          humanExpected: true,
          output: [{ path: "/a", matcher: { type: "judge", instructions: "polite?" } }],
        },
        sourceRunId: "run-1",
        tags: ["escalate"],
      }),
    ]);
    expect(ids(good)).toEqual(["weak:ok", "from-runs:ok", "tags:ok", "judge:warning"]);
  });
});

const summary = (over: Partial<EvaluationSummary> = {}): EvaluationSummary => ({
  cases: 4,
  passed: 3,
  passRate: 0.75,
  completionRate: 1,
  accuracy: {},
  calibration: {},
  branchCorrectness: 1,
  schemaSuccess: 1,
  toolSuccess: 1,
  humanReviewRate: 0,
  latency: { p50: 1, p95: 1, p99: 1 },
  costUsd: { total: 0, perCase: 0 },
  ...over,
});
const result = (over: Partial<CaseResultRow>): CaseResultRow => ({
  caseId: "c",
  runId: "r",
  passed: true,
  checks: [],
  failures: [],
  metrics: null,
  status: "completed",
  ...over,
});

describe("reportReading", () => {
  it("separates runs that finished from cases that passed", () => {
    const notes = reportReading(summary({ completionRate: 0.5 }), [], new Set());
    expect(ids(notes)).toEqual(["finished:warning", "passed:info"]);
    expect(notes[0]?.message).toMatch(/^2 of 4 runs finished/);
    expect(notes[1]?.message).toMatch(/A finished run with a wrong answer counts as a failure/);
  });

  it("flags passes that check nothing, judge checks that cannot run, and auto-answered people", () => {
    const notes = reportReading(
      summary(),
      [
        result({ caseId: "weak" }),
        result({
          caseId: "j",
          passed: false,
          checks: [{ id: "output:/:judge", kind: "output", passed: false, message: NO_JUDGE }],
        }),
        result({
          caseId: "h",
          metrics: {
            latencyMs: 1,
            costUsd: 0,
            tokens: 0,
            branches: {},
            decisions: {},
            humanRequested: true,
          },
        }),
      ],
      new Set(["weak"]),
    );
    expect(ids(notes)).toEqual([
      "finished:ok",
      "passed:info",
      "weak:warning",
      "judge:warning",
      "human:info",
    ]);
  });
});
