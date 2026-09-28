import { describe, expect, it } from "vitest";
import { ApiError } from "~/api/client";
import { errorText, historyFor, provenance, sourceHref, type AssistantAnswer } from "./logic";

const ANSWER: AssistantAnswer = {
  statements: [
    { text: "Run r1 failed with E_UPSTREAM.", kind: "fact", sources: ["r1"] },
    { text: "Retry it.", kind: "recommendation", sources: [] },
  ],
  sources: [{ id: "r1", kind: "run", label: "Support run r1", workflowId: "wf-1" }],
  toolCalls: [
    { name: "list_runs", ok: true },
    { name: "get_run", ok: true },
  ],
  rounds: 2,
  stopped: null,
  usage: { inputTokens: 1000, outputTokens: 240 },
  costUsd: 0.0031,
  promptHash: "abc",
  model: { provider: "anthropic", model: "claude-sonnet-5" },
};

describe("assistant helpers", () => {
  it("links each cited record to its page", () => {
    expect(sourceHref("default", { id: "r1", kind: "run", label: "" })).toBe("/default/runs/r1");
    expect(sourceHref("default", { id: "w1", kind: "workflow", label: "" })).toBe(
      "/default/workflows/w1",
    );
    expect(sourceHref("default", { id: "t1", kind: "task", label: "" })).toBe(
      "/default/human-tasks/t1",
    );
    expect(sourceHref("default", { id: "failure_rate:w1", kind: "insight", label: "" })).toBe(
      "/default",
    );
  });

  it("sends the last answered turns as history, statements tagged by kind", () => {
    const turns = [
      { id: "a", question: "q1", answer: ANSWER },
      { id: "b", question: "q2", error: "boom" },
      { id: "c", question: "q3" },
    ];
    expect(historyFor(turns)).toEqual([
      { role: "user", content: "q1" },
      {
        role: "assistant",
        content: "[fact] Run r1 failed with E_UPSTREAM.\n[recommendation] Retry it.",
      },
    ]);
  });

  it("says which model answered, with how many lookups, tokens and what it cost", () => {
    expect(provenance(ANSWER)).toBe(
      "anthropic/claude-sonnet-5 · 2 lookups · 1,240 tokens · $0.0031",
    );
  });

  it("explains errors in words a person can act on", () => {
    expect(errorText(new ApiError(409, "CONFLICT", "no model"))).toMatch(
      /needs a generation model/,
    );
    expect(errorText(new ApiError(429, "RATE_LIMITED", "slow down"))).toMatch(/Wait a moment/);
    expect(errorText(new ApiError(500, "INTERNAL", "database unavailable"))).toBe(
      "database unavailable",
    );
    expect(errorText(new TypeError("fetch failed"))).toMatch(/could not be sent/);
  });
});
