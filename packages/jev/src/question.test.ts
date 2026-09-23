import { describe, expect, it } from "vitest";
import { parseContract } from "./contract.js";
import {
  SystemOneResponseSchema,
  toDecisionQuestion,
  toSystemOneQuestion,
  toSystemOneRequest,
  validateSystemOneQuestion,
  validateSystemOneRequest,
} from "./question.js";
import { estimateTokens } from "./limits.js";
import { rawTemplateContracts } from "./test-fixtures.js";

describe("contract → TypeSafe System One question", () => {
  it.each(
    rawTemplateContracts().map((c) => [String((c.body as { key: string }).key), c.body] as const),
  )("%s compiles to a question the live API accepts", (_key, raw) => {
    const body = parseContract(raw);
    if (body.question.kind === "choice" && body.question.menu.source === "dynamic") return; // needs a live menu
    const q = toSystemOneQuestion(toDecisionQuestion(body));
    expect(validateSystemOneQuestion("q", q)).toEqual([]);
    expect(q.type).toBe(body.question.kind === "boolean" ? "noul" : body.question.kind);
  });

  it("enforces the verified API limits", () => {
    expect(
      validateSystemOneQuestion("q", {
        type: "choice",
        instructions: "Pick",
        criteria: { only: "one" },
      }).length,
    ).toBeGreaterThan(0);
    const eleven = Array.from({ length: 11 }, (_, i) => `level ${i}`);
    expect(
      validateSystemOneQuestion("q", { type: "score", instructions: "Rate", criteria: eleven })
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateSystemOneQuestion("q", {
        type: "score",
        instructions: "Rate",
        criteria: ["low", "high"],
      }),
    ).toEqual([]);
    expect(validateSystemOneQuestion("q", { type: "noul", instructions: "Urgent?" })).toEqual([]);
    expect(
      validateSystemOneQuestion("q", { type: "noul", instructions: "" }).length,
    ).toBeGreaterThan(0);
    const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, "x"]));
    expect(
      validateSystemOneQuestion("q", { type: "choice", instructions: "Pick", criteria: many })
        .length,
    ).toBeGreaterThan(0);
  });

  it("builds a request that validates, and rejects an empty question map", () => {
    const req = {
      model: "jev-latest",
      state: { message: "my card was stolen" },
      questions: { urgent: { type: "noul", instructions: "Is this urgent?" } },
    };
    expect(validateSystemOneRequest(req)).toEqual([]);
    expect(validateSystemOneRequest({ ...req, questions: {} }).length).toBeGreaterThan(0);
    expect(typeof toSystemOneRequest).toBe("function");
  });

  it("parses the verified live response shape", () => {
    const live = {
      model: "jev-1.13.0",
      answers: {
        urgent: { type: "noul", noul: 0.96 },
        team: {
          type: "choice",
          choice: "security",
          confidence: 1.0,
          probabilities: { sales: 0, security: 1, billing: 0, technical_support: 0 },
        },
        risk: {
          type: "score",
          score: 3.72,
          confidence: 0.77,
          legend: {
            "0": "No risk",
            "1": "Low risk",
            "2": "Moderate risk",
            "3": "High risk",
            "4": "Critical risk",
          },
          probabilities: { "0": 0, "1": 0, "2": 0, "3": 0.27, "4": 0.73 },
        },
      },
      usage: { input_tokens: 469, output_tokens: 76 },
    };
    expect(SystemOneResponseSchema.parse(live).answers["urgent"]).toEqual({
      type: "noul",
      noul: 0.96,
    });
  });

  it("estimates tokens at chars/3.5", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("x".repeat(35))).toBe(10);
  });
});
