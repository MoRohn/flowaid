import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MemoryFixtureStore,
  fixtureKey,
  recordingDecisionProvider,
  recordingEmbeddingProvider,
  recordingGenerationProvider,
} from "./recording.js";
import { FileFixtureStore } from "./recording-fs.js";
import { HEALTHY, ctx, scriptedDecider, scriptedGenerator } from "./test/fakes.js";

const Q = { kind: "boolean" as const, instructions: "Urgent?" };

describe("record → replay", () => {
  it("replays decisions without calling the provider, keyed by request", async () => {
    const store = new MemoryFixtureStore();
    const live = scriptedDecider("typesafe", [0.8]);
    const recorded = await recordingDecisionProvider(live, "record", store).decideBoolean(
      "state",
      Q,
      ctx(),
    );
    const never = scriptedDecider("typesafe", [new Error("must not be called")]);
    const replay = recordingDecisionProvider(never, "replay", store);
    expect(await replay.decideBoolean("state", Q, ctx())).toEqual(recorded);
    expect(never.calls).toBe(0);
    await expect(replay.decideBoolean("other state", Q, ctx())).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false,
    });
    await expect(replay.batch("state", { q: Q }, ctx())).rejects.toThrow(/No recorded/);
  });

  it("records and replays generations and streams chunk by chunk", async () => {
    const store = new MemoryFixtureStore();
    const gen = scriptedGenerator(["hello"]);
    const streaming = {
      ...gen,
      stream: async function* () {
        await Promise.resolve();
        yield { type: "text" as const, delta: "he" };
        yield { type: "text" as const, delta: "llo" };
        yield { type: "done" as const, finishReason: "stop" as const };
      },
    };
    const rec = recordingGenerationProvider(streaming, "record", store);
    const req = { messages: [{ role: "user" as const, content: "hi" }] };
    const generated = await rec.generate(req, ctx());
    const chunks: unknown[] = [];
    for await (const chunk of rec.stream(req, ctx())) chunks.push(chunk);
    const replay = recordingGenerationProvider(
      scriptedGenerator([new Error("no")]),
      "replay",
      store,
    );
    expect(await replay.generate(req, ctx())).toEqual(generated);
    const replayed: unknown[] = [];
    for await (const chunk of replay.stream(req, ctx())) replayed.push(chunk);
    expect(replayed).toEqual(chunks);
    await expect(async () => {
      for await (const _ of replay.stream({ messages: [] }, ctx())) void _;
    }).rejects.toThrow(/No recorded/);
  });

  it("records embeddings", async () => {
    const store = new MemoryFixtureStore();
    const inner = {
      id: "openai",
      model: "e",
      dimensions: 2,
      embed: () =>
        Promise.resolve({
          vectors: [[1, 2]],
          usage: { inputTokens: 1, outputTokens: 0 },
          costUsd: 0,
        }),
      health: () => HEALTHY,
    };
    await recordingEmbeddingProvider(inner, "record", store).embed(["x"], ctx());
    expect(
      await recordingEmbeddingProvider(inner, "replay", store).embed(["x"], ctx()),
    ).toMatchObject({ vectors: [[1, 2]] });
  });

  it("keys by provider, model, method and request hash", () => {
    expect(fixtureKey("typesafe", "jev", "boolean", { a: 1 })).toMatch(
      /^typesafe\/jev\/boolean\/[0-9a-f]{64}$/,
    );
    expect(fixtureKey("p", "m", "x", { a: 1, b: 2 })).toBe(
      fixtureKey("p", "m", "x", { b: 2, a: 1 }),
    );
  });
});

describe("FileFixtureStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "flowaid-fixtures-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes one sorted JSON file per provider and reads it back", () => {
    const store = new FileFixtureStore(dir);
    store.set("typesafe/jev/b/2", { v: 2 });
    store.set("typesafe/jev/a/1", { v: 1 });
    expect(
      Object.keys(JSON.parse(readFileSync(join(dir, "typesafe.json"), "utf8")) as object),
    ).toEqual(["typesafe/jev/a/1", "typesafe/jev/b/2"]);
    expect(new FileFixtureStore(dir).get("typesafe/jev/a/1")).toEqual({ v: 1 });
    expect(new FileFixtureStore(dir).get("openai/x/y/z")).toBeUndefined();
  });
});
