import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WorkflowDefinitionSchema,
  type GenerationRequest,
  type GenerationResult,
} from "@flowaid/workflow-core";
import { sampleInputs, sampleInputsContext } from "./sampleInputs.js";

const refund = WorkflowDefinitionSchema.parse({
  ...(JSON.parse(
    readFileSync(
      new URL("../../nodes-core/templates/refund-requests.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>),
  id: "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09",
  secrets: [{ name: "BILLING_TOKEN", credentialType: "http.bearer", required: true }],
});

function result(value: unknown): GenerationResult {
  return {
    text: "",
    toolCalls: [],
    structured: value as never,
    finishReason: "stop",
    usage: { inputTokens: 800, outputTokens: 150 },
    costUsd: 0.001,
    priceSnapshot: null,
    latencyMs: 5,
    provider: "fake",
    model: "fake-1",
  };
}

function fake(answers: GenerationResult[]) {
  const requests: GenerationRequest[] = [];
  return {
    requests,
    generate: (req: GenerationRequest) => {
      requests.push(structuredClone(req));
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return Promise.resolve(next);
    },
  };
}

/** The checks runs apply, reduced to what these tests need: required fields and types. */
function validate(input: Record<string, unknown>): string[] {
  const schema = refund.inputs as {
    required: string[];
    properties: Record<string, { type: string }>;
  };
  const issues = schema.required
    .filter((k) => input[k] === undefined)
    .map((k) => `/${k} is required`);
  for (const [k, v] of Object.entries(input)) {
    const type = schema.properties[k]?.type;
    if (type === "integer" && !Number.isInteger(v)) issues.push(`/${k} must be integer`);
    if (type === "number" && typeof v !== "number") issues.push(`/${k} must be number`);
    if (type === "string" && typeof v !== "string") issues.push(`/${k} must be string`);
  }
  return issues;
}

const good = (over: Record<string, unknown> = {}) => ({
  customer_email: "sam@example.com",
  order_id: "10482",
  order_total: 39.9,
  days_since_delivery: 3,
  reason: "The mug arrived cracked.",
  ...over,
});

describe("sampleInputs", () => {
  it("tells the model the inputs, rules and settings, but no secrets", async () => {
    const model = fake([
      result({ samples: [{ title: "Cracked mug", why: "Refunds automatically.", input: good() }] }),
    ]);
    const out = await sampleInputs({
      definition: refund,
      scenario: "edge",
      count: 1,
      generate: model.generate,
      jsonSchema: true,
      validate,
    });
    expect(out.samples).toEqual([
      { title: "Cracked mug", why: "Refunds automatically.", input: good() },
    ]);
    expect(out).toMatchObject({ rejected: 0, iterations: 1, costUsd: 0.001 });
    const prompt = JSON.stringify(model.requests[0]?.messages);
    expect(prompt).toContain("autoRefundLimit");
    expect(prompt).toContain("start.order_total <= $vars.autoRefundLimit");
    expect(prompt).toContain("thresholds");
    expect(prompt).not.toContain("BILLING_TOKEN");
    // the answer format carries the workflow's own input schema
    expect(model.requests[0]?.responseFormat).toMatchObject({
      type: "json_schema",
      schema: { properties: { samples: { items: { properties: { input: refund.inputs } } } } },
    });
  });

  it("repeats the values the person kept, whatever the model wrote", async () => {
    const model = fake([
      result({
        samples: [
          { title: "A", why: "a", input: good({ order_id: "999" }) },
          { title: "B", why: "b", input: good({ order_id: "888", days_since_delivery: 45 }) },
        ],
      }),
    ]);
    const out = await sampleInputs({
      definition: refund,
      scenario: "typical",
      count: 2,
      current: { order_id: "10482", reason: "" },
      keep: ["order_id"],
      generate: model.generate,
      jsonSchema: false,
      validate,
    });
    expect(out.samples.map((s) => s.input.order_id)).toEqual(["10482", "10482"]);
    expect(model.requests[0]?.messages[1]?.content).toContain(`{"order_id":"10482"}`);
    expect(model.requests[0]?.responseFormat).toBeUndefined();
  });

  it("sends invalid samples back once and drops the ones that are still wrong", async () => {
    const model = fake([
      result({
        samples: [
          { title: "Fine", why: "ok", input: good() },
          { title: "Bad days", why: "late", input: good({ days_since_delivery: "forty" }) },
        ],
      }),
      result({
        samples: [
          { title: "Fine", why: "ok", input: good() },
          { title: "Still bad", why: "late", input: good({ days_since_delivery: 40.5 }) },
        ],
      }),
    ]);
    const out = await sampleInputs({
      definition: refund,
      scenario: "edge",
      count: 2,
      generate: model.generate,
      jsonSchema: true,
      validate,
    });
    expect(out.iterations).toBe(2);
    expect(out.samples.map((s) => s.title)).toEqual(["Fine"]);
    expect(out.rejected).toBe(1);
    const repair = model.requests[1]?.messages.at(-1)?.content;
    expect(repair).toContain('"Bad days" does not match the input schema');
    expect(repair).toContain("/days_since_delivery must be integer");
    expect(out.usage).toEqual({ inputTokens: 1600, outputTokens: 300 });
  });

  it("asks again when the answer is not JSON, and returns nothing rather than a guess", async () => {
    const model = fake([
      { ...result(undefined), structured: undefined, text: "Sure! Here you go." },
      { ...result(undefined), structured: undefined, text: "still not json" },
    ]);
    const out = await sampleInputs({
      definition: refund,
      scenario: "unusual",
      count: 3,
      generate: model.generate,
      jsonSchema: false,
      validate,
    });
    expect(out.samples).toEqual([]);
    expect(out.iterations).toBe(2);
    expect(model.requests[1]?.messages.at(-1)?.content).toContain("not a JSON object");
  });

  it("describes branch cases and step rules briefly", () => {
    const ctx = sampleInputsContext(refund) as { steps: { name: string; cases?: unknown }[] };
    expect(ctx.steps.find((s) => s.name === "Decide automatically?")?.cases).toEqual([
      { when: "limits.result.refund" },
      { when: "limits.result.decline" },
    ]);
    expect(ctx.steps.some((s) => s.name === "How to make it yours")).toBe(false);
  });
});
