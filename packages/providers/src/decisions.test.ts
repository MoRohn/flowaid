import { describe, expect, it } from "vitest";
import {
  booleanDecision,
  choiceDecision,
  matchOption,
  renormalise,
  scoreDecision,
  similarity,
} from "./decisionMath.js";
import {
  LLMDecisionProvider,
  batchSchema,
  decisionPrompt,
  parseJsonLoose,
} from "./llm-decision.js";
import { RuleDecisionProvider, compileRule } from "./rule-decision.js";
import { ctx, scriptedGenerator } from "./test/fakes.js";

const META = { provider: "llm", model: "m", latencyMs: 12, costUsd: 0.001 };
const CHOICE = {
  kind: "choice" as const,
  instructions: "Which team?",
  options: { billing: "Money", technical: "Bugs", general: "Else" },
};
const SCORE = {
  kind: "score" as const,
  instructions: "How urgent?",
  levels: ["Low", "Medium", "High"],
};
const BOOL = {
  kind: "boolean" as const,
  instructions: "Refund?",
  criteria: { true: "Asks for money back", false: "Anything else" },
};

describe("decision math", () => {
  it("boolean confidence is max(p, 1 − p) and value follows the threshold", () => {
    expect(booleanDecision(0.3, META)).toMatchObject({
      value: false,
      pYes: 0.3,
      confidence: 0.7,
      probabilities: { true: 0.3, false: 0.7 },
    });
    expect(booleanDecision(0.3, META, 0.25).value).toBe(true);
    expect(booleanDecision(1.4, META).pYes).toBe(1);
  });

  it("choice takes the argmax, or a given value with a confidence factor", () => {
    expect(choiceDecision({ a: 0.2, b: 0.7, c: 0.1 }, META)).toMatchObject({
      value: "b",
      confidence: 0.7,
    });
    expect(
      choiceDecision({ a: 0.2, b: 0.7, c: 0.1 }, META, { value: "b", confidenceFactor: 0.8 })
        .confidence,
    ).toBeCloseTo(0.56);
  });

  it("score value is Σ i·pᵢ with level, normalised value and label", () => {
    const d = scoreDecision([0.1, 0.3, 0.6], ["Low", "Medium", "High"], META);
    expect(d.value).toBeCloseTo(1.5);
    expect(d).toMatchObject({
      level: 2,
      levelLabel: "High",
      confidence: 0.6,
      probabilities: { "0": 0.1, "1": 0.3, "2": 0.6 },
    });
    expect(d.normalized).toBeCloseTo(0.75);
  });

  it("renormalises only sums in [0.9, 1.1]", () => {
    expect(renormalise([0.45, 0.5])).toEqual([0.45 / 0.95, 0.5 / 0.95]);
    expect(renormalise([0.4, 0.4])).toBeNull();
    expect(renormalise([0.6, 0.6])).toBeNull();
    expect(renormalise([-0.1, 1.1])).toBeNull();
  });

  it("matches paraphrased option keys at similarity ≥ 0.9", () => {
    expect(matchOption("billing", ["billing", "general"])).toEqual({
      key: "billing",
      fuzzy: false,
    });
    expect(matchOption("Account_Access", ["account_access", "billing"])).toEqual({
      key: "account_access",
      fuzzy: true,
    });
    expect(matchOption("technicall", ["technical"])).toEqual({ key: "technical", fuzzy: true });
    expect(matchOption("refunds", ["billing", "general"])).toBeNull();
    expect(similarity("", "")).toBe(1);
  });
});

describe("LLMDecisionProvider", () => {
  it("asks once with a strict JSON schema and builds every answer", async () => {
    const gen = scriptedGenerator([
      JSON.stringify({
        intent: {
          choice: "billing",
          probabilities: { billing: 0.8, technical: 0.15, general: 0.05 },
        },
        urgency: { probabilities: [0.2, 0.5, 0.3] },
        refund: { p_yes: 0.9 },
      }),
    ]);
    const provider = new LLMDecisionProvider(gen);
    const { answers, usage } = await provider.batch(
      "I was charged twice",
      { intent: CHOICE, urgency: SCORE, refund: BOOL },
      ctx(),
    );
    expect(gen.requests).toHaveLength(1);
    expect(gen.requests[0]?.responseFormat).toMatchObject({ type: "json_schema", strict: true });
    expect(gen.requests[0]?.temperature).toBe(0);
    expect(answers.intent).toMatchObject({
      kind: "choice",
      value: "billing",
      confidence: 0.8,
      provider: "llm",
      model: "gpt-4.1-mini",
    });
    expect(answers.urgency).toMatchObject({ kind: "score", level: 1 });
    expect(answers.refund).toMatchObject({ kind: "boolean", value: true, confidence: 0.9 });
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    const totalCost = Object.values(answers).reduce((sum, a) => sum + a.costUsd, 0);
    expect(totalCost).toBeCloseTo(0.0001);
  });

  it("renormalises a near-miss distribution and penalises a fuzzy choice", async () => {
    const gen = scriptedGenerator([
      JSON.stringify({
        q: { choice: "Billing!", probabilities: { billing: 0.76, technical: 0.1, general: 0.09 } },
      }),
    ]);
    const result = await new LLMDecisionProvider(gen).decideChoice("s", CHOICE, ctx());
    expect(result.value).toBe("billing");
    expect(result.probabilities.billing).toBeCloseTo(0.8);
    expect(result.confidence).toBeCloseTo(0.8 * 0.8);
  });

  it("re-asks once, naming the problem, and accepts the corrected answer", async () => {
    const gen = scriptedGenerator([
      JSON.stringify({ q: { probabilities: [0.2, 0.2, 0.2] } }),
      JSON.stringify({ q: { probabilities: [0.05, 0.05, 0.9] } }),
    ]);
    const result = await new LLMDecisionProvider(gen).decideScore("s", SCORE, ctx());
    expect(result.level).toBe(2);
    expect(gen.requests).toHaveLength(2);
    const retry = gen.requests[1]?.messages[1]?.content;
    expect(typeof retry === "string" && retry).toContain("probabilities must sum to 1");
    expect(result.raw).toMatchObject({ rounds: 2 });
  });

  it("fails without retrying the provider when the answer stays invalid", async () => {
    const gen = scriptedGenerator([
      JSON.stringify({ q: { choice: "refunds", probabilities: { billing: 1 } } }),
    ]);
    await expect(
      new LLMDecisionProvider(gen).decideChoice("s", CHOICE, ctx()),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    expect(gen.requests).toHaveLength(2);
  });

  it("parses JSON from prose or a code fence when the model has no structured output", async () => {
    const gen = scriptedGenerator(['Sure!\n```json\n{"q": {"p_yes": 0.2}}\n```'], {
      jsonSchema: false,
    });
    const result = await new LLMDecisionProvider(gen).decideBoolean("s", BOOL, ctx());
    expect(result.value).toBe(false);
    expect(gen.requests[0]?.responseFormat).toBeUndefined();
    expect(parseJsonLoose("nothing here")).toBeUndefined();
  });

  it("builds prompts and schemas that name every option and level", () => {
    const prompt = decisionPrompt(
      { message: "hi" },
      { intent: CHOICE, urgency: SCORE, refund: BOOL },
    );
    expect(prompt).toContain('option "technical": Bugs');
    expect(prompt).toContain("level 2: High");
    expect(prompt).toContain("true means: Asks for money back");
    expect(batchSchema({ intent: CHOICE })).toMatchObject({
      required: ["intent"],
      additionalProperties: false,
    });
  });

  it("rejects an empty batch", async () => {
    await expect(
      new LLMDecisionProvider(scriptedGenerator(["{}"])).batch("s", {}, ctx()),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("RuleDecisionProvider", () => {
  const rules = new RuleDecisionProvider({
    kind: "choice",
    rules: [
      { when: "contains(lower($state.message), 'refund')", value: "billing", confidence: 0.9 },
      { when: "$state.tier == 'gold'", value: "technical" },
    ],
    default: { value: "general", confidence: 0.6 },
  });

  it.each([
    [{ message: "I want a refund", tier: "free" }, "billing", 0.9, 0.05, 0],
    [{ message: "It crashed", tier: "gold" }, "technical", 1, 0, 1],
    [{ message: "Hello", tier: "free" }, "general", 0.6, 0.2, null],
  ])("%j → %s", async (state, value, confidence, rest, matched) => {
    const d = await rules.decideChoice(state, CHOICE, ctx());
    expect(d).toMatchObject({
      value,
      confidence,
      provider: "rule",
      model: "rule:v1",
      costUsd: 0,
      raw: { matchedRule: matched },
    });
    for (const [key, p] of Object.entries(d.probabilities))
      if (key !== value) expect(p).toBeCloseTo(rest);
  });

  it("answers boolean and score rules with the same spreading", async () => {
    const yes = new RuleDecisionProvider({
      kind: "boolean",
      rules: [{ when: "len($state) > 3", value: true, confidence: 0.8 }],
      default: { value: false, confidence: 0.7 },
    });
    expect(await yes.decideBoolean("long text", BOOL, ctx())).toMatchObject({
      value: true,
      pYes: 0.8,
    });
    expect(await yes.decideBoolean("no", BOOL, ctx())).toMatchObject({
      value: false,
      pYes: expect.closeTo(0.3) as unknown,
    });
    const score = new RuleDecisionProvider({
      kind: "score",
      rules: [],
      default: { value: 2, confidence: 1 },
    });
    expect(await score.decideScore("x", SCORE, ctx())).toMatchObject({ level: 2, value: 2 });
    expect((await score.batch("x", { a: SCORE }, ctx())).answers.a).toMatchObject({
      kind: "score",
    });
  });

  it("refuses the wrong kind, an unknown option or level, and an invalid rule", async () => {
    await expect(rules.decideBoolean("x", BOOL, ctx())).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    const bad = new RuleDecisionProvider({
      kind: "choice",
      rules: [],
      default: { value: "nope", confidence: 1 },
    });
    await expect(bad.decideChoice("x", CHOICE, ctx())).rejects.toThrow(/not an option/);
    const badScore = new RuleDecisionProvider({
      kind: "score",
      rules: [],
      default: { value: 7, confidence: 1 },
    });
    await expect(badScore.decideScore("x", SCORE, ctx())).rejects.toThrow(/level index/);
    expect(() => compileRule("$state ==")).toThrow(/Invalid decision rule/);
    const failing = new RuleDecisionProvider({
      kind: "boolean",
      rules: [{ when: "len($state.x) > 1", value: true }],
      default: { value: false, confidence: 1 },
    });
    await expect(failing.decideBoolean("plain text", BOOL, ctx())).rejects.toThrow(
      /Decision rule 0 failed/,
    );
  });
});
