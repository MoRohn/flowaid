import { describe, expect, it } from "vitest";
import type { CaseResultRow, EvaluationCase } from "~/admin/types";
import { confusionByDecision, failedChecks, reportGate, sameCases } from "./report";

const metrics = {
  latencyMs: 10,
  costUsd: 0,
  tokens: 0,
  branches: {},
  decisions: {},
  humanRequested: false,
};
const caseOf = (id: string, expected: Record<string, unknown>): EvaluationCase => ({
  id,
  setId: "s",
  ordinal: 0,
  input: {},
  expected,
  metadata: {},
  tags: [],
  sourceRunId: null,
  createdAt: "",
});
const result = (caseId: string, checks: CaseResultRow["checks"]): CaseResultRow => ({
  caseId,
  runId: "r",
  passed: false,
  checks,
  failures: [],
  metrics,
  status: "completed",
});

describe("confusion", () => {
  it("keeps a batch step's questions apart", () => {
    const out = confusionByDecision(
      [
        result("c1", [
          {
            id: "decision:triage.topic",
            kind: "decision",
            passed: true,
            expected: { value: "feedback" },
            actual: { value: "feedback", confidence: 0.9 },
          },
          {
            id: "decision:triage.needs_person",
            kind: "decision",
            passed: false,
            expected: { value: true },
            actual: { value: false, confidence: 0.8 },
          },
        ]),
      ],
      [caseOf("c1", { decisions: { triage: { value: "feedback" } } })],
    );
    expect(out).toEqual({
      "triage.topic": [{ expected: "feedback", actual: "feedback" }],
      "triage.needs_person": [{ expected: "true", actual: "false" }],
    });
  });

  it("reads the case for results scored before checks carried their expectation", () => {
    const out = confusionByDecision(
      [
        result("c1", [
          {
            id: "decision:intent",
            kind: "decision",
            passed: false,
            actual: { value: "bug", confidence: 0.7 },
          },
        ]),
      ],
      [caseOf("c1", { decisions: { intent: { value: "billing" } } })],
    );
    expect(out).toEqual({ intent: [{ expected: "billing", actual: "bug" }] });
  });
});

describe("the report", () => {
  it("has no gate unless the run was held to a pass rate", () => {
    // a report exists for a baseline alone; before, no gate read "Gate passed with warnings"
    expect(reportGate(null)).toBe("none");
    expect(reportGate({ verdict: "pass", warnings: [{}], gate: null })).toBe("none");
    const gate = { minPassRate: 0.9 };
    expect(reportGate({ verdict: "pass", warnings: [], gate })).toBe("pass");
    expect(reportGate({ verdict: "pass", warnings: [{}], gate })).toBe("warn");
    expect(reportGate({ verdict: "fail", warnings: [], gate })).toBe("fail");
  });

  it("puts each failed check in words", () => {
    const checks = failedChecks(
      result("c1", [
        { id: "output:/reply:contains", kind: "output", passed: true },
        {
          id: "decision:triage",
          kind: "decision",
          passed: false,
          message: 'value false ≠ "feedback"',
        },
        { id: "output:/:equals", kind: "output", passed: false, message: "not equal" },
        { id: "node:escalate:forbidden", kind: "node", passed: false, message: "escalate ran" },
        { id: "latency", kind: "latency", passed: false, expected: 1000, actual: 1200 },
        { id: "outcome", kind: "outcome", passed: false, expected: "routed", actual: null },
        { id: "human", kind: "human", passed: false, expected: true, actual: false },
      ]),
    );
    expect(checks).toEqual([
      { label: "Decision triage", message: 'value false ≠ "feedback"' },
      { label: "Output (all of it) equals", message: "not equal" },
      { label: "Step escalate must not run", message: "escalate ran" },
      { label: "Latency", message: "took 1200 ms, the limit is 1000 ms" },
      { label: "Outcome", message: "expected routed, got none" },
      { label: "Asking a person", message: "expected the run to ask a person; it did not" },
    ]);
  });

  it("compares rates only over the same cases", () => {
    const a = [{ caseId: "1" }, { caseId: "2" }];
    expect(sameCases(a, [{ caseId: "2" }, { caseId: "1" }])).toBe(true);
    expect(sameCases(a, [{ caseId: "1" }, { caseId: "2" }, { caseId: "3" }])).toBe(false);
    expect(sameCases(a, [{ caseId: "1" }, { caseId: "3" }])).toBe(false);
  });
});
