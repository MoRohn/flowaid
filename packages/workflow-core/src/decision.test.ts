import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BooleanDecisionSchema,
  ChoiceDecisionSchema,
  DecisionResultJsonSchema,
  DecisionResultSchema,
  ScoreDecisionSchema,
  type BooleanDecision,
  type ChoiceDecision,
  type DecisionKind,
  type ScoreDecision,
} from "./decision.js";
import { JsonSchemaSchema, type JsonSchema } from "./json.js";

const base = {
  confidence: 0.9,
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 12,
  costUsd: 0.0001,
  attempts: [{ provider: "typesafe", model: "jev-1.13.0", outcome: "ok" as const, latencyMs: 12 }],
};
const boolean: BooleanDecision = {
  ...base,
  kind: "boolean",
  value: true,
  pYes: 0.9,
  probabilities: { true: 0.9, false: 0.1 },
};
const choice: ChoiceDecision = {
  ...base,
  kind: "choice",
  value: "billing",
  probabilities: { billing: 0.9, technical: 0.1 },
};
const score: ScoreDecision = {
  ...base,
  kind: "score",
  value: 2.4,
  normalized: 0.6,
  level: 2,
  levelLabel: "Moderate",
  levels: ["Low", "Mid", "Moderate", "High", "Critical"],
  probabilities: { "0": 0.1, "1": 0.1, "2": 0.4, "3": 0.3, "4": 0.1 },
};

/** Resolves a local `#/$defs/...` reference inside `root`. */
function deref(root: JsonSchema, schema: JsonSchema): JsonSchema {
  if (schema.$ref === undefined) return schema;
  const key = schema.$ref.replace("#/$defs/", "");
  const target = root.$defs?.[key];
  if (target === undefined) throw new Error(`unresolved ${schema.$ref}`);
  return target;
}

describe("DecisionResultJsonSchema", () => {
  const kinds: DecisionKind[] = ["boolean", "choice", "score"];

  it("has one entry per kind, each a valid draft 2020-12 JsonSchema document", () => {
    expect(Object.keys(DecisionResultJsonSchema).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const schema = DecisionResultJsonSchema[kind];
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.type).toBe("object");
      expect(JsonSchemaSchema.safeParse(schema).success).toBe(true);
    }
  });

  it("pins the kind discriminator and the common decision fields", () => {
    for (const kind of kinds) {
      const schema = DecisionResultJsonSchema[kind];
      expect(schema.properties?.kind).toEqual({ type: "string", const: kind });
      for (const field of [
        "confidence",
        "provider",
        "model",
        "latencyMs",
        "costUsd",
        "attempts",
        "value",
        "probabilities",
      ]) {
        expect(schema.properties?.[field], `${kind}.${field}`).toBeDefined();
        expect(schema.required, `${kind} requires ${field}`).toContain(field);
      }
      expect(schema.required).not.toContain("usage");
      expect(schema.required).not.toContain("raw");
      expect(schema.properties?.confidence).toMatchObject({
        type: "number",
        minimum: 0,
        maximum: 1,
      });
      expect(schema.properties?.latencyMs).toMatchObject({ type: "integer", minimum: 0 });
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it("types value per kind", () => {
    expect(DecisionResultJsonSchema.boolean.properties?.value).toEqual({ type: "boolean" });
    expect(DecisionResultJsonSchema.boolean.properties?.pYes).toMatchObject({
      type: "number",
      minimum: 0,
      maximum: 1,
    });
    expect(DecisionResultJsonSchema.boolean.properties?.probabilities).toMatchObject({
      type: "object",
      required: ["true", "false"],
    });
    expect(DecisionResultJsonSchema.choice.properties?.value).toEqual({ type: "string" });
    expect(DecisionResultJsonSchema.choice.properties?.probabilities).toMatchObject({
      type: "object",
    });
    expect(DecisionResultJsonSchema.score.properties?.value).toMatchObject({
      type: "number",
      minimum: 0,
    });
    expect(DecisionResultJsonSchema.score.properties?.normalized).toMatchObject({
      type: "number",
      minimum: 0,
      maximum: 1,
    });
    expect(DecisionResultJsonSchema.score.properties?.level).toMatchObject({
      type: "integer",
      minimum: 0,
    });
    expect(DecisionResultJsonSchema.score.properties?.levels).toMatchObject({
      type: "array",
      minItems: 2,
      maxItems: 10,
      items: { type: "string" },
    });
    expect(DecisionResultJsonSchema.score.required).toEqual(
      expect.arrayContaining(["normalized", "level", "levelLabel", "levels"]),
    );
  });

  it("describes the failover attempts array", () => {
    for (const kind of kinds) {
      const root = DecisionResultJsonSchema[kind];
      const attempts = root.properties?.attempts;
      expect(attempts?.type).toBe("array");
      const item = attempts?.items;
      if (item === undefined || typeof item === "boolean") throw new Error("expected items schema");
      const resolved = deref(root, item);
      expect(resolved.properties?.outcome).toMatchObject({
        type: "string",
        enum: ["ok", "error", "skipped_unhealthy"],
      });
      expect(resolved.required).toEqual(
        expect.arrayContaining(["provider", "model", "outcome", "latencyMs"]),
      );
    }
  });

  it("is equivalent to a fresh z.toJSONSchema of each Zod schema", () => {
    expect(DecisionResultJsonSchema.boolean).toEqual(
      z.toJSONSchema(BooleanDecisionSchema, { target: "draft-2020-12" }),
    );
    expect(DecisionResultJsonSchema.choice).toEqual(
      z.toJSONSchema(ChoiceDecisionSchema, { target: "draft-2020-12" }),
    );
    expect(DecisionResultJsonSchema.score).toEqual(
      z.toJSONSchema(ScoreDecisionSchema, { target: "draft-2020-12" }),
    );
  });
});

describe("DecisionResultSchema", () => {
  it("accepts a valid result of each kind and preserves it", () => {
    expect(DecisionResultSchema.parse(boolean)).toEqual(boolean);
    expect(DecisionResultSchema.parse(choice)).toEqual(choice);
    expect(DecisionResultSchema.parse(score)).toEqual(score);
  });

  it("rejects out-of-range probabilities, confidence and levels", () => {
    expect(DecisionResultSchema.safeParse({ ...boolean, pYes: 1.5 }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...boolean, confidence: -0.1 }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...choice, probabilities: { a: 2 } }).success).toBe(
      false,
    );
    expect(DecisionResultSchema.safeParse({ ...score, levels: ["only"] }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...score, level: 1.5 }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...boolean, kind: "other" }).success).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Spec-exact shapes (ARCHITECTURE.md §2.8): the TypeSafe-derived results per kind.
 * ──────────────────────────────────────────────────────────────────────────── */

const attempts = [
  { provider: "typesafe", model: "jev-1.13.0", outcome: "ok" as const, latencyMs: 305 },
];
const common = {
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 305,
  costUsd: 0.0002,
  attempts,
};

/** Boolean per §2.8: `value`, `pYes`, `probabilities: {true, false}`, `confidence = max(pYes, 1 − pYes)`. */
function booleanResult(pYes: number): BooleanDecision {
  return {
    ...common,
    kind: "boolean",
    value: pYes >= 0.5,
    pYes,
    probabilities: { true: pYes, false: 1 - pYes },
    confidence: Math.max(pYes, 1 - pYes),
  };
}
/** Choice per §2.8: `value`, `probabilities` per option; confidence = the winning probability. */
function choiceResult(probabilities: Record<string, number>): ChoiceDecision {
  const [value, p] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return { ...common, kind: "choice", value, probabilities, confidence: p };
}
/** Score per §2.8: fractional `value` in [0, n−1], `normalized = value/(n−1)`, `level = round(value)`, `levelLabel = levels[level]`. */
function scoreResult(levels: string[], probabilities: number[]): ScoreDecision {
  const value = probabilities.reduce((acc, p, i) => acc + p * i, 0);
  const level = Math.round(value);
  return {
    ...common,
    kind: "score",
    value,
    normalized: value / (levels.length - 1),
    level,
    levelLabel: levels[level] ?? "",
    levels,
    probabilities: Object.fromEntries(probabilities.map((p, i) => [String(i), p])),
    confidence: Math.max(...probabilities),
  };
}

describe("DecisionResultSchema — spec-exact shapes per kind (§2.8)", () => {
  it("boolean: pYes, probabilities {true,false} and confidence = max(pYes, 1 − pYes)", () => {
    for (const pYes of [0.91, 0.5, 0.22, 0, 1]) {
      const r = booleanResult(pYes);
      const parsed = DecisionResultSchema.parse(r);
      expect(parsed).toEqual(r);
      if (parsed.kind !== "boolean") throw new Error("kind");
      expect(parsed.confidence).toBeCloseTo(Math.max(parsed.pYes, 1 - parsed.pYes), 12);
      expect(parsed.probabilities.true + parsed.probabilities.false).toBeCloseTo(1, 12);
      expect(parsed.value).toBe(pYes >= 0.5);
    }
    expect(DecisionResultJsonSchema.boolean.required).toEqual(
      expect.arrayContaining(["value", "pYes", "probabilities", "confidence"]),
    );
  });

  it("choice: one probability per option, value is the winning option key (TypeSafe keys may contain spaces or dashes)", () => {
    const r = choiceResult({ billing: 0.91, technical: 0.05, security: 0.01, general: 0.03 });
    expect(DecisionResultSchema.parse(r)).toEqual(r);
    expect(r.value).toBe("billing");
    expect(r.confidence).toBe(0.91);
    const odd = choiceResult({ "Needs follow-up": 0.6, "ok as-is": 0.4 });
    expect(DecisionResultSchema.parse(odd)).toEqual(odd);
    expect(odd.value).toBe("Needs follow-up");
    const two = choiceResult({ yes: 0.7, no: 0.3 });
    // A two-option choice is comparable with a boolean at the same confidence (one gate threshold across kinds).
    expect(two.confidence).toBe(booleanResult(0.7).confidence);
  });

  it('score: value in [0, n−1], normalized = value/(n−1), level = round(value), levelLabel = levels[level], probabilities keyed "0".."n−1"', () => {
    const levels = ["Low", "Medium", "Elevated", "High", "Critical"];
    const r = scoreResult(levels, [0.02, 0.08, 0.3, 0.48, 0.12]);
    expect(DecisionResultSchema.parse(r)).toEqual(r);
    expect(r.value).toBeCloseTo(2.6, 12);
    expect(r.normalized).toBeCloseTo(0.65, 12);
    expect(r.level).toBe(3);
    expect(r.levelLabel).toBe("High");
    expect(Object.keys(r.probabilities)).toEqual(["0", "1", "2", "3", "4"]);
    expect(r.value).toBeLessThanOrEqual(levels.length - 1);
    const two = scoreResult(["bad", "good"], [0.25, 0.75]);
    expect(DecisionResultSchema.parse(two)).toEqual(two);
    expect(two.normalized).toBe(two.value);
    const ten = scoreResult(
      Array.from({ length: 10 }, (_, i) => `L${i}`),
      [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    );
    expect(DecisionResultSchema.parse(ten)).toEqual(ten);
  });

  it("accepts the optional common fields and a walked failover chain", () => {
    const r: ChoiceDecision = {
      ...choiceResult({ a: 0.6, b: 0.4 }),
      provider: "llm",
      model: "gpt-4.1-mini",
      usage: { inputTokens: 512, outputTokens: 4, cacheReadTokens: 100 },
      requestId: "req_1",
      raw: { choices: [{ a: 0.6 }] },
      attempts: [
        { provider: "typesafe", model: "jev-1.13.0", outcome: "skipped_unhealthy", latencyMs: 0 },
        {
          provider: "typesafe",
          model: "jev-1.13.0",
          outcome: "error",
          errorCode: "PROVIDER_RATE_LIMITED",
          latencyMs: 80,
        },
        { provider: "llm", model: "gpt-4.1-mini", outcome: "ok", latencyMs: 820 },
      ],
    };
    expect(DecisionResultSchema.parse(r)).toEqual(r);
  });

  it("strips unknown top-level keys (results are stored exactly as the contract describes)", () => {
    const r = { ...booleanResult(0.8), extra: "nope" };
    expect(DecisionResultSchema.parse(r)).not.toHaveProperty("extra");
    expect(DecisionResultJsonSchema.boolean.additionalProperties).toBe(false);
  });

  describe("rejects malformed results", () => {
    const cases: [string, unknown][] = [
      [
        "boolean without pYes",
        (() => {
          const { pYes: _p, ...rest } = booleanResult(0.8);
          return rest;
        })(),
      ],
      [
        "boolean with probabilities missing false",
        { ...booleanResult(0.8), probabilities: { true: 0.8 } },
      ],
      ["boolean with string value", { ...booleanResult(0.8), value: "true" }],
      ["boolean with pYes above 1", { ...booleanResult(0.8), pYes: 1.2 }],
      ["boolean with confidence below 0", { ...booleanResult(0.8), confidence: -0.2 }],
      ["choice with numeric value", { ...choiceResult({ a: 0.6, b: 0.4 }), value: 1 }],
      [
        "choice with probability above 1",
        { ...choiceResult({ a: 0.6, b: 0.4 }), probabilities: { a: 1.6, b: 0.4 } },
      ],
      [
        "choice without probabilities",
        (() => {
          const { probabilities: _p, ...rest } = choiceResult({ a: 0.6, b: 0.4 });
          return rest;
        })(),
      ],
      [
        "choice with pYes (boolean field)",
        { ...choiceResult({ a: 0.6, b: 0.4 }), kind: "boolean" },
      ],
      ["score with one level", { ...scoreResult(["a", "b"], [0.5, 0.5]), levels: ["only"] }],
      [
        "score with eleven levels",
        {
          ...scoreResult(["a", "b"], [0.5, 0.5]),
          levels: Array.from({ length: 11 }, (_, i) => `L${i}`),
        },
      ],
      [
        "score with fractional level",
        { ...scoreResult(["a", "b", "c"], [0.2, 0.3, 0.5]), level: 1.3 },
      ],
      [
        "score with negative value",
        { ...scoreResult(["a", "b", "c"], [0.2, 0.3, 0.5]), value: -0.1 },
      ],
      [
        "score with normalized above 1",
        { ...scoreResult(["a", "b", "c"], [0.2, 0.3, 0.5]), normalized: 1.01 },
      ],
      [
        "score without levelLabel",
        (() => {
          const { levelLabel: _l, ...rest } = scoreResult(["a", "b"], [0.5, 0.5]);
          return rest;
        })(),
      ],
      [
        "score with numeric probability keys",
        { ...scoreResult(["a", "b"], [0.5, 0.5]), probabilities: [0.5, 0.5] },
      ],
      ["unknown kind", { ...booleanResult(0.8), kind: "ranking" }],
      [
        "missing attempts",
        (() => {
          const { attempts: _a, ...rest } = booleanResult(0.8);
          return rest;
        })(),
      ],
      [
        "attempt with unknown outcome",
        {
          ...booleanResult(0.8),
          attempts: [{ provider: "x", model: "y", outcome: "meh", latencyMs: 1 }],
        },
      ],
      [
        "attempt with unknown errorCode",
        {
          ...booleanResult(0.8),
          attempts: [
            { provider: "x", model: "y", outcome: "error", errorCode: "BOOM", latencyMs: 1 },
          ],
        },
      ],
      ["negative cost", { ...booleanResult(0.8), costUsd: -1 }],
      ["fractional latency", { ...booleanResult(0.8), latencyMs: 1.5 }],
      [
        "usage with negative tokens",
        { ...booleanResult(0.8), usage: { inputTokens: -1, outputTokens: 0 } },
      ],
      ["not an object", "yes"],
    ];
    for (const [label, value] of cases) {
      it(label, () => {
        expect(DecisionResultSchema.safeParse(value).success).toBe(false);
      });
    }
  });
});
