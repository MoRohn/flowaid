import { describe, expect, it } from "vitest";
import { createTestContext, runNode } from "@flowaid/node-sdk/testing";
import type { RerankProvider } from "@flowaid/workflow-core";
import { fakeGenerator } from "../test/fakes.js";
import { generateNode } from "./generate.js";
import { imageNode } from "./image.js";
import { promptNode } from "./prompt.js";
import { rerankNode } from "./rerank.js";
import { audioExtension, speechNode } from "./speech.js";
import { sniffImage, visionNode } from "./vision.js";

const model = { provider: "openai", model: "gpt-test" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function fakeReranker(
  scores: number[],
): RerankProvider & { calls: { query: string; docs: string[] }[] } {
  const calls: { query: string; docs: string[] }[] = [];
  return {
    id: "cohere",
    model: "rerank-test",
    calls,
    rerank: (query, docs) => {
      calls.push({ query, docs });
      return Promise.resolve({
        scores,
        usage: { inputTokens: 40, outputTokens: 0 },
        costUsd: 0.001,
      });
    },
    health: () => ({
      status: "healthy",
      errorRate1m: 0,
      p95LatencyMs: 0,
      consecutiveFailures: 0,
      checkedAt: "2026-01-01T00:00:00Z",
    }),
  };
}

describe("flowaid.ai.prompt", () => {
  it("builds system, recent history (without system messages) and the user turn", async () => {
    const r = await runNode(promptNode, {
      config: { system: "Be kind", user: "And now?", historyLimit: 2 },
      input: {
        history: [
          { role: "system", content: "old system" },
          { role: "user", content: "one" },
          { role: "assistant", content: "two" },
          { role: "user", content: "three" },
        ],
      },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: {
        count: 4,
        messages: [
          { role: "system", content: "Be kind" },
          { role: "assistant", content: "two" },
          { role: "user", content: "three" },
          { role: "user", content: "And now?" },
        ],
      },
    });
  });

  it("feeds flowaid.ai.generate, which prepends its own system only when the conversation has none", async () => {
    const gen = fakeGenerator("ok");
    await runNode(generateNode, {
      config: { model, system: "S", stream: false },
      input: { messages: [{ role: "user", content: "hi" }] },
      providers: { generation: gen },
    });
    expect(gen.requests[0]?.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "hi" },
    ]);
    const none = await runNode(generateNode, {
      config: { model, stream: false },
      input: {},
      providers: { generation: fakeGenerator("x") },
    });
    expect(none.result).toMatchObject({ kind: "error", error: { code: "BAD_REQUEST" } });
  });
});

describe("flowaid.ai.rerank", () => {
  it("sorts by score, keeps topK above minScore and reports the spend", async () => {
    const rr = fakeReranker([0.1, 0.9, 0.5, 0.95]);
    const r = await runNode(rerankNode, {
      config: { model: { provider: "cohere", model: "rerank-test" }, topK: 2, minScore: 0.2 },
      input: { query: "refunds", documents: ["a", { text: "b", id: 2 }, "c", "d"] },
      providers: { rerank: rr },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { documents: ["d", { text: "b", id: 2 }], scores: [0.95, 0.9], indices: [3, 1] },
      costUsd: 0.001,
    });
    expect(rr.calls[0]?.docs).toEqual(["a", "b", "c", "d"]);
  });

  it("returns nothing for no documents without calling the provider", async () => {
    const r = await runNode(rerankNode, {
      config: { model: { provider: "cohere", model: "rerank-test" } },
      input: { query: "q", documents: [] },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { documents: [] } });
  });
});

describe("flowaid.ai.vision", () => {
  it("sniffs image types", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("sends the prompt and each image (artifact or data URL) as content parts", async () => {
    const gen = fakeGenerator("A cat");
    const { ctx } = createTestContext({
      config: visionNode.configSchema.parse({ model, prompt: "What is this?" }),
      capabilities: visionNode.capabilities,
      providers: { generation: gen },
    });
    const art = await ctx.artifacts.put("cat.png", PNG, "image/png");
    const dataUrl = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    const r = await visionNode.execute(ctx, { images: [art, dataUrl] });
    expect(r).toMatchObject({ kind: "ok", output: { text: "A cat" } });
    const content = gen.requests[0]?.messages[0]?.content as { type: string; mimeType?: string }[];
    expect(content.map((c) => c.type)).toEqual(["text", "image", "image"]);
    expect(content[1]?.mimeType).toBe("image/png");
  });

  it("refuses inputs that are not images", async () => {
    const r = await runNode(visionNode, {
      config: { model, prompt: "?" },
      input: { images: [Buffer.from("hello").toString("base64")] },
      providers: { generation: fakeGenerator("x") },
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "BAD_REQUEST" } });
  });
});

describe("flowaid.ai.speech", () => {
  it("recognises audio containers", () => {
    expect(audioExtension(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBe("wav");
    expect(audioExtension(new TextEncoder().encode("OggS\0\0"))).toBe("ogg");
    expect(audioExtension(new TextEncoder().encode("ID3\u0004"))).toBe("mp3");
  });

  it("transcribes an audio artifact with a multipart upload", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const { ctx } = createTestContext({
      config: speechNode.configSchema.parse({ mode: "transcribe", language: "en" }),
      capabilities: speechNode.capabilities,
      credentials: { llm: { apiKey: "sk-test", baseUrl: "https://llm.test/v1" } },
      http: (url, init) => {
        calls.push({ url: String(url), body: init?.body });
        return Promise.resolve(Response.json({ text: "hello there" }));
      },
    });
    const audio = await ctx.artifacts.put(
      "a.wav",
      new TextEncoder().encode("RIFF\0\0\0\0WAVE"),
      "audio/wav",
    );
    const r = await speechNode.execute(ctx, { audio });
    expect(r).toMatchObject({ kind: "ok", output: { text: "hello there", audio: null } });
    expect(calls[0]?.url).toBe("https://llm.test/v1/audio/transcriptions");
    const form = calls[0]?.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("en");
  });

  it("synthesises speech into an artifact", async () => {
    const r = await runNode(speechNode, {
      config: { mode: "synthesize", model: "gpt-4o-mini-tts", format: "wav" },
      input: { text: "Hi" },
      credentials: { llm: { apiKey: "sk-test" } },
      http: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { text: null, audio: { $artifact: expect.any(String) } },
    });
    const stored = [...r.recorder.artifacts.values()][0];
    expect(stored).toMatchObject({ name: "speech.wav", mimeType: "audio/wav" });
  });

  it("maps provider errors", async () => {
    const r = await runNode(speechNode, {
      config: { mode: "synthesize" },
      input: { text: "Hi" },
      credentials: { llm: { apiKey: "bad" } },
      http: () => Promise.resolve(Response.json({ error: { message: "nope" } }, { status: 401 })),
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "CREDENTIAL_ERROR" } });
  });
});

describe("flowaid.ai.image", () => {
  it("stores each generated image as an artifact", async () => {
    let body: Record<string, unknown> = {};
    const r = await runNode(imageNode, {
      config: { prompt: "a lighthouse", count: 2 },
      credentials: { llm: { apiKey: "sk-test" } },
      http: (_url, init) => {
        body = JSON.parse(init?.body as string) as Record<string, unknown>;
        const b64 = Buffer.from(PNG).toString("base64");
        return Promise.resolve(
          Response.json({
            data: [{ b64_json: b64, revised_prompt: "a tall lighthouse" }, { b64_json: b64 }],
          }),
        );
      },
    });
    expect(body).toMatchObject({
      model: "gpt-image-1",
      prompt: "a lighthouse",
      n: 2,
      size: "1024x1024",
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { revised_prompts: ["a tall lighthouse"] },
    });
    expect(r.recorder.artifacts.size).toBe(2);
    expect(imageNode.idempotency).toBe("none");
  });
});
