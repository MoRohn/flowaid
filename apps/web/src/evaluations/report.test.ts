import { describe, expect, it } from "vitest";
import type { CaseResultRow, EvaluationCase } from "~/admin/types";
import { confusionByDecision } from "./report";

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
