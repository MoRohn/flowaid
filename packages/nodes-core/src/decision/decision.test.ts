import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import type { DecisionResult, JsonValue } from "@flowaid/workflow-core";
import { batchNode } from "./batch.js";
import { booleanNode } from "./boolean.js";
import { choiceNode } from "./choice.js";
import { combine, consensusNode } from "./consensus.js";
import { confidenceGateNode, gateOutcome } from "./confidence_gate.js";
import { routerNode } from "./router.js";
import { scoreNode } from "./score.js";
import { validatorNode } from "./validator.js";
import { fakeDecider } from "../test/fakes.js";

const okOf = (r: Awaited<ReturnType<typeof runNode>>) => {
  if (r.result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(r.result)}`);
  return r.result;
};

describe("flowaid.decision.boolean", () => {
  it("returns the decision with its cost and usage", async () => {
    const r = await runNode(booleanNode, {
      config: { instructions: "Is this a refund request?" },
      input: { state: "I want my money back" },
      providers: { decision: fakeDecider({ pYes: 0.92 }) },
    });
    const res = okOf(r);
    const d = (res.output as { decision: DecisionResult }).decision;
    expect(d).toMatchObject({ kind: "boolean", value: true, pYes: 0.92, confidence: 0.92 });
    expect(res.costUsd).toBeCloseTo(0.001);
    expect(res.decision).toBe(d);
  });

  it("suspends for a person when the chain ends in human, and resumes with their answer", async () => {
    const config = { instructions: "Approve?" };
    const suspended = await runNode(booleanNode, {
      config,
      input: { state: "x" },
      providers: { decision: fakeDecider({ human: true }) },
    });
    expect(suspended.result.kind).toBe("suspend");
    if (suspended.result.kind !== "suspend") return;
    expect(suspended.result.wait).toMatchObject({
      kind: "human",
      request: { mode: { type: "approval" } },
    });

    const resumed = await runNode(booleanNode, {
      config,
      input: { state: "x" },
      providers: { decision: fakeDecider({ human: true }) },
      resume: {
        kind: "human",
        state: suspended.result.state,
        response: { action: "approve" },
        by: "u1",
        humanTaskId: "h1",
      },
    });
    expect((okOf(resumed).output as { decision: DecisionResult }).decision).toMatchObject({
      value: true,
      provider: "human",
      confidence: 1,
    });
  });

  it("maps provider errors to an error result", async () => {
    const r = await runNode(booleanNode, {
      config: { instructions: "?" },
      input: { state: "x" },
      providers: { decision: fakeDecider({ error: new Error("boom") }) },
    });
    expect(r.result.kind).toBe("error");
  });
});

describe("flowaid.decision.choice and router", () => {
  const options = { billing: "Billing questions", bug: "Bug reports", other: "Anything else" };

  it("choice fires the chosen option's port", async () => {
    const r = await runNode(choiceNode, {
      config: { instructions: "Route the ticket", options },
      input: { state: { subject: "Charged twice" } },
      providers: { decision: fakeDecider({ choice: { billing: 0.7, bug: 0.2, other: 0.1 } }) },
    });
    expect(okOf(r).route).toBe("billing");
  });

  it("router fires review below minConfidence", async () => {
    const decider = fakeDecider({ choice: { billing: 0.4, bug: 0.35, other: 0.25 } });
    const low = await runNode(routerNode, {
      config: { instructions: "Route", routes: options, minConfidence: 0.6 },
      input: { state: "?" },
      providers: { decision: decider },
    });
    expect(okOf(low).route).toBe("review");
    expect(okOf(low).output).toMatchObject({ route: "review" });
    const high = await runNode(routerNode, {
      config: { instructions: "Route", routes: options, minConfidence: 0.3 },
      input: { state: "?" },
      providers: { decision: decider },
    });
    expect(okOf(high).route).toBe("billing");
  });

  it("choice failover asks the person to choose among the options", async () => {
    const r = await runNode(choiceNode, {
      config: { instructions: "Route", options },
      input: { state: "?" },
      providers: { decision: fakeDecider({ human: true }) },
    });
    expect(r.result).toMatchObject({
      kind: "suspend",
      wait: {
        request: {
          mode: { type: "choice", options: [{ id: "billing" }, { id: "bug" }, { id: "other" }] },
        },
      },
    });
    const resumed = await runNode(choiceNode, {
      config: { instructions: "Route", options },
      input: { state: "?" },
      providers: { decision: fakeDecider({ human: true }) },
      resume: {
        kind: "human",
        state: null,
        response: { action: "choose", option: "bug" },
        by: "u",
        humanTaskId: "h",
      },
    });
    expect(okOf(resumed).route).toBe("bug");
  });
});

describe("flowaid.decision.score", () => {
  it("returns the weighted value and the nearest level", async () => {
    const r = await runNode(scoreNode, {
      config: { instructions: "How urgent?", levels: ["low", "medium", "high"] },
      input: { state: "server down" },
      providers: { decision: fakeDecider({ score: [0.1, 0.2, 0.7] }) },
    });
    const d = (okOf(r).output as { decision: DecisionResult & { kind: "score" } }).decision;
    expect(d.value).toBeCloseTo(1.6);
    expect(d.level).toBe(2);
    expect(d.levelLabel).toBe("high");
  });
});

describe("flowaid.decision.batch", () => {
  const questions = {
    refund: { kind: "boolean", instructions: "Refund?" },
    topic: { kind: "choice", instructions: "Topic?", options: { a: "A", b: "B" } },
    urgency: { kind: "score", instructions: "Urgency?", levels: ["low", "high"] },
  };

  it("answers every question in one batch", async () => {
    const r = await runNode(batchNode, {
      config: { questions },
      input: { state: "text" },
      providers: { decision: fakeDecider({ pYes: 0.8 }) },
    });
    const res = okOf(r);
    const answers = (res.output as { answers: Record<string, DecisionResult> }).answers;
    expect(Object.keys(answers)).toEqual(["refund", "topic", "urgency"]);
    expect(answers.refund).toMatchObject({ kind: "boolean", value: true });
    expect(res.costUsd).toBeCloseTo(0.003);
  });

  it("suspends with a form on failover and maps the person's answers", async () => {
    const s = await runNode(batchNode, {
      config: { questions },
      input: { state: "t" },
      providers: { decision: fakeDecider({ human: true }) },
    });
    expect(s.result).toMatchObject({
      kind: "suspend",
      wait: { request: { mode: { type: "form" } } },
    });
    const r = await runNode(batchNode, {
      config: { questions },
      input: { state: "t" },
      providers: { decision: fakeDecider({ human: true }) },
      resume: {
        kind: "human",
        state: null,
        response: { action: "submit", value: { refund: true, topic: "b", urgency: "high" } },
        by: "u",
        humanTaskId: "h",
      },
    });
    const answers = (okOf(r).output as { answers: Record<string, DecisionResult> }).answers;
    expect(answers.refund).toMatchObject({ value: true, provider: "human" });
    expect(answers.topic).toMatchObject({ value: "b" });
    expect(answers.urgency).toMatchObject({ level: 1, levelLabel: "high" });
  });
});

describe("flowaid.decision.confidence_gate (§6.3)", () => {
  const d = (confidence: number, value: boolean = true) => ({ kind: "boolean", value, confidence });
  it.each([
    // two-way (no reviewBand)
    [0.9, true, 0.8, false, undefined, "pass"],
    [0.7, true, 0.8, false, undefined, "review"],
    [0.1, true, 0.8, false, undefined, "review"],
    // three-way
    [0.75, true, 0.8, false, 0.1, "review"],
    [0.69, true, 0.8, false, 0.1, "fail"],
    [0.8, true, 0.8, false, 0.1, "pass"],
    // requireValue
    [0.95, false, 0.8, true, undefined, "review"],
    [0.95, false, 0.8, true, 0.1, "fail"],
    [0.95, true, 0.8, true, 0.1, "pass"],
  ] as const)(
    "confidence %s value %s threshold %s requireValue %s band %s → %s",
    async (confidence, value, threshold, requireValue, reviewBand, expected) => {
      expect(gateOutcome(d(confidence, value), threshold, requireValue, reviewBand)).toBe(expected);
      const r = await runNode(confidenceGateNode, {
        config: { threshold, requireValue, ...(reviewBand !== undefined ? { reviewBand } : {}) },
        input: { decision: d(confidence, value) },
      });
      expect(okOf(r).route).toBe(expected);
      expect(okOf(r).output).toMatchObject({ outcome: expected, passed: expected === "pass" });
    },
  );
});

describe("flowaid.decision.consensus", () => {
  const voters: JsonValue[] = [
    { provider: "typesafe", model: "jev-latest" },
    { provider: "llm", model: { provider: "openai", model: "gpt-4.1-mini" } },
    { provider: "rule" },
  ];
  const question = { kind: "choice", instructions: "Topic?", options: { a: "A", b: "B" } };

  it("agrees when the voters pick the same option", async () => {
    const r = await runNode(consensusNode, {
      config: { question, voters },
      input: { state: "x" },
      providers: { decision: fakeDecider({ choice: { a: 0.9, b: 0.1 } }) },
    });
    const res = okOf(r);
    expect(res.route).toBe("agreed");
    expect(res.output).toMatchObject({
      agreement: 1,
      decision: { value: "a", provider: "consensus" },
    });
    expect(res.costUsd).toBeCloseTo(0.003);
  });

  it("disagrees below minAgreement and under unanimity", async () => {
    const decider = fakeDecider((chain) =>
      chain[0]?.provider === "rule"
        ? { choice: { a: 0.2, b: 0.8 } }
        : { choice: { a: 0.9, b: 0.1 } },
    );
    const majority = await runNode(consensusNode, {
      config: { question, voters, minAgreement: 0.7 },
      input: { state: "x" },
      providers: { decision: decider },
    });
    expect(okOf(majority).route).toBe("disagreed");
    expect((okOf(majority).output as { agreement: number }).agreement).toBeCloseTo(2 / 3);
    const lenient = await runNode(consensusNode, {
      config: { question, voters, minAgreement: 0.6 },
      input: { state: "x" },
      providers: { decision: decider },
    });
    expect(okOf(lenient).route).toBe("agreed");
    const unanimous = await runNode(consensusNode, {
      config: { question, voters, method: "unanimous" },
      input: { state: "x" },
      providers: { decision: decider },
    });
    expect(okOf(unanimous).route).toBe("disagreed");
  });

  it("rejects fewer than two, repeated or human voters with E_DECISION_CONFIG", async () => {
    for (const bad of [
      voters.slice(0, 1),
      [voters[2], voters[2]],
      [voters[0], { provider: "human" }],
    ] as JsonValue[][]) {
      const r = await runNode(consensusNode, {
        config: { question, voters: bad },
        input: { state: "x" },
        providers: { decision: fakeDecider({}) },
      });
      expect(r.result.kind).toBe("error");
      if (r.result.kind === "error")
        expect(r.result.error.message).toMatch(/E_DECISION_CONFIG|configSchema/);
    }
  });

  it("combine: confidence-weighted probabilities and agreement × mean confidence", () => {
    const meta = { provider: "p", model: "m", latencyMs: 1, costUsd: 0, attempts: [] };
    const votes: DecisionResult[] = [
      {
        ...meta,
        kind: "boolean",
        value: true,
        pYes: 0.9,
        probabilities: { true: 0.9, false: 0.1 },
        confidence: 0.9,
      },
      {
        ...meta,
        kind: "boolean",
        value: false,
        pYes: 0.4,
        probabilities: { true: 0.4, false: 0.6 },
        confidence: 0.6,
      },
    ];
    const { decision, agreement } = combine(
      { kind: "boolean", instructions: "?" },
      votes,
      "confidence_weighted",
    );
    expect(agreement).toBe(0.5);
    expect(decision.kind === "boolean" && decision.pYes).toBeCloseTo((0.9 * 0.9 + 0.4 * 0.6) / 1.5);
    expect(decision.confidence).toBeCloseTo(0.5 * 0.75);
  });
});

describe("flowaid.decision.validator", () => {
  it("routes valid / invalid on the threshold and passes the value through", async () => {
    const decider = fakeDecider({ pYes: 0.7 });
    const strict = await runNode(validatorNode, {
      config: { rubric: "Polite and on-topic", threshold: 0.8 },
      input: { value: "Hi!" },
      providers: { decision: decider },
    });
    expect(okOf(strict).route).toBe("invalid");
    const lax = await runNode(validatorNode, {
      config: { rubric: "Polite and on-topic", threshold: 0.5 },
      input: { value: "Hi!", reference: "Hello" },
      providers: { decision: decider },
    });
    expect(okOf(lax).route).toBe("valid");
    expect(okOf(lax).output).toMatchObject({ value: "Hi!" });
    expect(decider.questions.at(-1)?.instructions).toContain("Polite and on-topic");
  });
});
