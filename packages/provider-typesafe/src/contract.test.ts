import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DefaultModelCatalog, ProviderRegistry } from "@flowaid/providers";
import type {
  BooleanDecision,
  ChoiceDecision,
  DecisionQuestion,
  JsonValue,
  SafeFetch,
  ScoreDecision,
} from "@flowaid/workflow-core";
import { RATE_LIMIT_RETRIES, TypeSafeClient } from "./client.js";
import { assertSize, fromSystemOneAnswer, splitUsage, toSystemOneQuestion } from "./mapping.js";
import { TypeSafeDecisionProvider, typesafeFactory } from "./provider.js";
import { TYPESAFE_INPUT_PRICE_PER_TOKEN, type SystemOneAnswer } from "./schemas.js";

interface Fixture {
  request: {
    model: string;
    state: unknown;
    questions: Record<string, { type: string; instructions: string; criteria?: unknown }>;
  };
  status: number;
  headers: Record<string, string>;
  body: JsonValue;
}
const DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(`${DIR}${name}.json`, "utf8")) as Fixture;

/** A fetch that answers with the given fixtures in order and records requests. */
function replay(...fixtures: Fixture[]) {
  const requests: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  let i = 0;
  const http: SafeFetch = (url, init) => {
    requests.push({
      url,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const f = fixtures[Math.min(i, fixtures.length - 1)];
    i += 1;
    if (!f) return Promise.reject(new Error("no fixture"));
    return Promise.resolve(
      new Response(JSON.stringify(f.body), { status: f.status, headers: f.headers }),
    );
  };
  return { http, requests };
}

/** The flowaid question a recorded TypeSafe question came from. */
function flowaidQuestion(q: Fixture["request"]["questions"][string]): DecisionQuestion {
  if (q.type === "noul")
    return {
      kind: "boolean",
      instructions: q.instructions,
      ...(q.criteria ? { criteria: q.criteria as { true: string; false: string } } : {}),
    };
  if (q.type === "choice")
    return {
      kind: "choice",
      instructions: q.instructions,
      options: q.criteria as Record<string, string>,
    };
  return { kind: "score", instructions: q.instructions, levels: q.criteria as string[] };
}

const ctx = () => ({
  signal: new AbortController().signal,
  runId: "r",
  nodeRunId: "n",
  idempotencyKey: null,
});
const instant = () => Promise.resolve();
const provider = (...fixtures: Fixture[]) => {
  const r = replay(...fixtures);
  return {
    ...r,
    provider: new TypeSafeDecisionProvider(
      new TypeSafeClient({ apiKey: "ts-key", http: r.http, sleep: instant, random: () => 0.5 }),
    ),
  };
};

describe("recorded fixtures", () => {
  it.each(["boolean", "choice", "score", "batch-3"])(
    "%s: sends exactly the recorded request and maps every answer",
    async (name) => {
      const f = load(name);
      const questions = Object.fromEntries(
        Object.entries(f.request.questions).map(([id, q]) => [id, flowaidQuestion(q)]),
      );
      for (const [id, q] of Object.entries(questions))
        expect(toSystemOneQuestion(q), id).toEqual(f.request.questions[id]);
      const { provider: p, requests } = provider(f);
      const result = await p.batch(f.request.state as never, questions, ctx());
      expect(requests[0]?.body).toEqual(f.request);
      expect(requests[0]?.headers.authorization).toBe("Bearer ts-key");
      const body = f.body as {
        model: string;
        answers: Record<string, SystemOneAnswer>;
        usage: { input_tokens: number; output_tokens: number };
      };
      expect(result.model).toBe(body.model);
      expect(result.requestId).toBe(f.headers["x-typesafe-request-id"]);
      expect(result.usage).toEqual({
        inputTokens: body.usage.input_tokens,
        outputTokens: body.usage.output_tokens,
      });
      const total = Object.values(result.answers).reduce((a, d) => a + d.costUsd, 0);
      expect(total).toBeCloseTo(body.usage.input_tokens * TYPESAFE_INPUT_PRICE_PER_TOKEN, 12);
      for (const [id, d] of Object.entries(result.answers)) {
        const answer = body.answers[id];
        expect(d).toMatchObject({ provider: "typesafe", model: body.model, raw: answer });
        expect(d.model).not.toBe("jev-latest");
        if (answer?.type === "noul") {
          const b = d as BooleanDecision;
          expect(b).toMatchObject({
            kind: "boolean",
            pYes: answer.noul,
            value: answer.noul >= 0.5,
            confidence: Math.max(answer.noul, 1 - answer.noul),
          });
          expect(b.probabilities.true + b.probabilities.false).toBeCloseTo(1);
        } else if (answer?.type === "choice") {
          const c = d as ChoiceDecision;
          expect(c).toMatchObject({
            kind: "choice",
            value: answer.choice,
            confidence: answer.confidence,
            probabilities: answer.probabilities,
          });
          const q = questions[id];
          expect(
            Object.keys(c.probabilities).every((k) => q?.kind === "choice" && k in q.options),
          ).toBe(true);
        } else if (answer?.type === "score") {
          const s = d as ScoreDecision;
          const labels = Object.entries(answer.legend)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([, l]) => l);
          expect(s).toMatchObject({
            kind: "score",
            value: answer.score,
            levels: labels,
            level: Math.round(answer.score),
            levelLabel: labels[Math.round(answer.score)],
          });
          expect(s.normalized).toBeCloseTo(answer.score / (labels.length - 1));
        }
      }
    },
  );

  it("maps each error status to the flowaid taxonomy", async () => {
    const errorOf = async (name: string) =>
      provider(load(name))
        .provider.decideBoolean("x", { kind: "boolean", instructions: "q" }, ctx())
        .then(
          () => null,
          (e: unknown) =>
            e as { code: string; retryable: boolean; details?: unknown; retryAfterMs?: number },
        );
    expect(await errorOf("error-401")).toMatchObject({
      code: "CREDENTIAL_ERROR",
      retryable: false,
    });
    expect(await errorOf("error-400")).toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false,
      details: "Unknown model: no-such-model",
    });
    const shape = await errorOf("error-422");
    expect(shape).toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    expect(Array.isArray(shape?.details)).toBe(true);
    expect(await errorOf("error-529.synthetic")).toMatchObject({
      code: "PROVIDER_OVERLOADED",
      retryable: true,
    });
    const limited = await errorOf("error-429.synthetic");
    expect(limited).toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfterMs: 2000,
    });
  });
});

describe("client behaviour", () => {
  it(`retries 429 up to ${RATE_LIMIT_RETRIES} times, honouring Retry-After, then succeeds`, async () => {
    const waits: number[] = [];
    const r = replay(load("error-429.synthetic"), load("error-429.synthetic"), load("boolean"));
    const client = new TypeSafeClient({
      apiKey: "k",
      http: r.http,
      sleep: (ms) => (waits.push(ms), Promise.resolve()),
      now: () => 0,
    });
    const out = await client.systemOne(
      load("boolean").request as never,
      new AbortController().signal,
    );
    expect(out.body.model).toBe("jev-1.13.0");
    expect(waits).toEqual([2000, 2000]);
    expect(r.requests).toHaveLength(3);
  });

  it("uses full-jitter backoff when there is no Retry-After, and gives up after the limit", async () => {
    const noHeader = { ...load("error-429.synthetic"), headers: {} };
    const waits: number[] = [];
    const r = replay(noHeader);
    const client = new TypeSafeClient({
      apiKey: "k",
      http: r.http,
      sleep: (ms) => (waits.push(ms), Promise.resolve()),
      random: () => 1,
    });
    await expect(
      client.systemOne(load("boolean").request as never, new AbortController().signal),
    ).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(r.requests).toHaveLength(RATE_LIMIT_RETRIES + 1);
  });

  it("maps 5xx, transport failures, bad bodies and aborts", async () => {
    const run = (http: SafeFetch, signal = new AbortController().signal) =>
      new TypeSafeClient({ apiKey: "k", http, sleep: instant })
        .systemOne(load("boolean").request as never, signal)
        .then(
          () => null,
          (e: unknown) => e as { code: string; retryable: boolean },
        );
    expect(await run(() => Promise.resolve(new Response("boom", { status: 502 })))).toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: true,
    });
    expect(await run(() => Promise.reject(new TypeError("fetch failed")))).toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
    expect(
      await run(() => Promise.resolve(new Response(JSON.stringify({ nope: 1 }), { status: 200 }))),
    ).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
    const controller = new AbortController();
    controller.abort();
    expect(
      await run(() => Promise.reject(new DOMException("aborted", "AbortError")), controller.signal),
    ).toMatchObject({ code: "CANCELLED_ERROR" });
    expect(await run(() => Promise.resolve(new Response("teapot", { status: 418 })))).toMatchObject(
      { code: "PROVIDER_ERROR", retryable: false },
    );
  });

  it("aborts while waiting to retry", async () => {
    const controller = new AbortController();
    const r = replay(load("error-429.synthetic"));
    const pending = new TypeSafeClient({ apiKey: "k", http: r.http }).systemOne(
      load("boolean").request as never,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED_ERROR" });
  });

  it("lists models", async () => {
    const http: SafeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            models: [{ name: "jev-latest", description: "d", release_date: "2026-09-01" }],
          }),
        ),
      );
    expect(
      await new TypeSafeClient({ apiKey: "k", http }).models(new AbortController().signal),
    ).toEqual([{ name: "jev-latest", description: "d", release_date: "2026-09-01" }]);
    const bad: SafeFetch = () => Promise.resolve(new Response(JSON.stringify({})));
    await expect(
      new TypeSafeClient({ apiKey: "k", http: bad }).models(new AbortController().signal),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("mapping", () => {
  const meta = {
    model: "jev-1.13.0",
    latencyMs: 10,
    usage: { inputTokens: 10, outputTokens: 0 },
    costUsd: 0,
    requestId: null,
  };

  it("applies the boolean threshold and refuses answers of the wrong kind or unknown options", () => {
    const q: DecisionQuestion = { kind: "boolean", instructions: "q" };
    expect(
      fromSystemOneAnswer("q", { type: "noul", noul: 0.6 }, q, { ...meta, booleanThreshold: 0.7 }),
    ).toMatchObject({ value: false, confidence: 0.6 });
    expect(() =>
      fromSystemOneAnswer(
        "q",
        { type: "noul", noul: 0.6 },
        { kind: "score", instructions: "s", levels: ["a", "b"] },
        meta,
      ),
    ).toThrow(/noul answer for a score/);
    expect(() =>
      fromSystemOneAnswer(
        "q",
        { type: "choice", choice: "x", confidence: 1, probabilities: { x: 1 } },
        { kind: "choice", instructions: "c", options: { a: "A", b: "B" } },
        meta,
      ),
    ).toThrow(/unknown options: x/);
  });

  it("falls back to the question's levels when the legend is missing and clamps the score", () => {
    const d = fromSystemOneAnswer(
      "s",
      { type: "score", score: 9, confidence: 0.5, legend: {}, probabilities: {} },
      { kind: "score", instructions: "s", levels: ["lo", "mid", "hi"] },
      meta,
    );
    expect(d).toMatchObject({
      value: 2,
      level: 2,
      levelLabel: "hi",
      levels: ["lo", "mid", "hi"],
      normalized: 1,
    });
  });

  it("guards the 32k state and 64k request limits before calling", () => {
    const q = { a: { kind: "boolean" as const, instructions: "q" } };
    expect(() => assertSize("x".repeat(100), q)).not.toThrow();
    expect(() => assertSize("x".repeat(Math.ceil(32_001 * 3.5)), q)).toThrow(/chunk the state/);
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `q${i}`,
        { kind: "boolean" as const, instructions: "y".repeat(6000) },
      ]),
    );
    expect(() => assertSize("small", many)).toThrow(/maxTokens/);
  });

  it("splits a batch's usage and cost across its answers", () => {
    const split = splitUsage({ inputTokens: 100, outputTokens: 7 }, ["a", "b", "c"]);
    expect([...split.values()].map((s) => s.usage.inputTokens)).toEqual([34, 33, 33]);
    expect([...split.values()].reduce((a, s) => a + s.costUsd, 0)).toBeCloseTo(
      100 * TYPESAFE_INPUT_PRICE_PER_TOKEN,
    );
  });
});

describe("registry factory", () => {
  it("builds the provider from the typesafe.api_key credential through the registry", async () => {
    const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
    registry.register(typesafeFactory());
    // Single questions travel under the id "q"; the real API answers the ids it was sent.
    const boolean = load("boolean");
    const body = boolean.body as { answers: Record<string, JsonValue> };
    const r = replay({
      ...boolean,
      body: { ...(boolean.body as object), answers: { q: body.answers.refund ?? null } },
    });
    const chain = await registry.chain([{ provider: "typesafe", model: "jev-latest" }], {
      workspaceId: "ws",
      credential: (id, type) =>
        Promise.resolve(
          id === "typesafe" && type === "typesafe.api_key"
            ? { id: "cred-1", value: { apiKey: "from-credential" } }
            : undefined,
        ),
      http: r.http,
    });
    const d = await chain.decideBoolean(
      "I was charged twice",
      { kind: "boolean", instructions: "Is the customer asking for a refund?" },
      ctx(),
    );
    expect(d).toMatchObject({ provider: "typesafe", kind: "boolean" });
    expect(r.requests[0]?.headers.authorization).toBe("Bearer from-credential");
    expect(() =>
      typesafeFactory().create({
        model: "jev-latest",
        credential: {},
        http: r.http,
        catalog: new DefaultModelCatalog(),
      }),
    ).toThrow(/no apiKey/);
  });

  it("refuses an empty batch", async () => {
    await expect(provider(load("boolean")).provider.batch("x", {}, ctx())).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
});
