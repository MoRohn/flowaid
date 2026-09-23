/**
 * Live smoke tests against api.typesafe.ai, and fixture recording. Run only with a key
 * (TYPESAFE_API_KEY in the environment or .env.local, provided by vitest.config.ts):
 *
 *   pnpm --filter @flowaid/provider-typesafe test          # smoke: the response schema still parses
 *   pnpm --filter @flowaid/provider-typesafe record        # re-records fixtures/*.json
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";
import { TypeSafeClient } from "./client.js";
import { SystemOneResponseSchema, TYPESAFE_BASE_URL } from "./schemas.js";

declare module "vitest" {
  export interface ProvidedContext {
    typesafeApiKey: string;
    typesafeRecord: boolean;
  }
}

const key = inject("typesafeApiKey");
const record = inject("typesafeRecord");
const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

const STATE =
  "Customer (gold plan): I was charged twice for my subscription this month and I want the duplicate refunded.";
const QUESTIONS = {
  boolean: {
    refund: {
      type: "noul",
      instructions: "Is the customer asking for a refund?",
      criteria: { true: "They want money back", false: "Anything else" },
    },
  },
  choice: {
    team: {
      type: "choice",
      instructions: "Which team should handle this ticket?",
      criteria: {
        billing: "Invoices, charges, refunds",
        technical: "Bugs, outages",
        security: "Fraud, account takeover",
        general: "Anything else",
      },
    },
  },
  score: {
    urgency: {
      type: "score",
      instructions: "How urgent is this ticket?",
      criteria: ["Not urgent", "Low", "Medium", "High", "Critical"],
    },
  },
} as const;

async function exchange(apiKey: string, body: unknown) {
  const response = await fetch(`${TYPESAFE_BASE_URL}/v1/systemone`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return {
    recordedAt: new Date().toISOString().slice(0, 10),
    request: body,
    status: response.status,
    headers: { "x-typesafe-request-id": response.headers.get("x-typesafe-request-id") ?? "" },
    body: json,
  };
}

describe.runIf(Boolean(key))("TypeSafe live", () => {
  it("lists models", async () => {
    const models = await new TypeSafeClient({ apiKey: key, http: (u, i) => fetch(u, i) }).models(
      AbortSignal.timeout(20_000),
    );
    expect(models.map((m) => m.name)).toContain("jev-latest");
  }, 30_000);

  it("answers every question kind, singly and batched, with the schema we parse", async () => {
    const cases: Record<string, unknown> = {
      boolean: { model: "jev-latest", state: STATE, questions: QUESTIONS.boolean },
      choice: { model: "jev-latest", state: STATE, questions: QUESTIONS.choice },
      score: { model: "jev-latest", state: STATE, questions: QUESTIONS.score },
      "batch-3": {
        model: "jev-latest",
        state: { message: STATE, tier: "gold" },
        questions: { ...QUESTIONS.boolean, ...QUESTIONS.choice, ...QUESTIONS.score },
      },
    };
    for (const [name, body] of Object.entries(cases)) {
      const ex = await exchange(key, body);
      expect(ex.status, name).toBe(200);
      expect(() => SystemOneResponseSchema.parse(ex.body), name).not.toThrow();
      if (record) writeFileSync(`${FIXTURES}${name}.json`, `${JSON.stringify(ex, null, 2)}\n`);
    }
  }, 120_000);

  it("returns the documented error shapes", async () => {
    const unauthorized = await exchange("fa-invalid-key", {
      model: "jev-latest",
      state: STATE,
      questions: QUESTIONS.boolean,
    });
    expect(unauthorized.status).toBe(401);
    // Semantic validation is a 400; a malformed request shape is a pydantic 422.
    const semantic = await exchange(key, {
      model: "no-such-model",
      state: STATE,
      questions: QUESTIONS.boolean,
    });
    expect(semantic.status).toBe(400);
    const shape = await exchange(key, {
      model: "jev-latest",
      state: 123,
      questions: QUESTIONS.boolean,
    });
    expect(shape.status).toBe(422);
    if (record) {
      writeFileSync(`${FIXTURES}error-401.json`, `${JSON.stringify(unauthorized, null, 2)}\n`);
      writeFileSync(`${FIXTURES}error-400.json`, `${JSON.stringify(semantic, null, 2)}\n`);
      writeFileSync(`${FIXTURES}error-422.json`, `${JSON.stringify(shape, null, 2)}\n`);
    }
  }, 60_000);
});
