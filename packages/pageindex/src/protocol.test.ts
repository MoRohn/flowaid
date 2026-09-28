import { describe, expect, it } from "vitest";
import { PageIndexServiceClient, PageIndexServiceError, frameJob } from "./protocol.js";

const WS = "0199a000-0000-7000-8000-00000000aaaa";
const JOB = "0199a000-0000-7000-8000-00000000bbbb";

describe("frameJob", () => {
  it("prefixes the JSON spec's length and appends the PDF, without the bytes in the JSON", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 body");
    const framed = frameJob({
      jobId: JOB,
      workspaceId: WS,
      fileName: "a.pdf",
      contentSha256: "ab",
      mode: "flash",
      optimize: "merge",
      model: { litellm: "ollama/qwen2.5:3b", apiBase: "http://127.0.0.1:11434" },
      indexId: "idx",
      pdf,
    });
    const len = new DataView(framed.buffer).getUint32(0, false);
    const spec = JSON.parse(new TextDecoder().decode(framed.slice(4, 4 + len))) as Record<
      string,
      unknown
    >;
    expect(spec).toMatchObject({
      jobId: JOB,
      protocol: "1",
      model: { litellm: "ollama/qwen2.5:3b" },
    });
    expect(spec.pdf).toBeUndefined();
    expect(new TextDecoder().decode(framed.slice(4 + len))).toBe("%PDF-1.7 body");
  });
});

describe("PageIndexServiceClient", () => {
  const status = {
    jobId: JOB,
    workspaceId: WS,
    state: "running",
    stage: "indexing",
    createdAt: "t",
    startedAt: "t",
    endedAt: null,
    result: null,
    error: null,
  };

  it("sends the token and protocol, and validates what comes back", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new PageIndexServiceClient({
      baseUrl: "http://pageindex:8765/",
      token: "t".repeat(40),
      fetch: (url, init) => {
        calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
        return Promise.resolve(new Response(JSON.stringify(status), { status: 200 }));
      },
    });
    const s = await client.getJob(WS, JOB);
    expect(s.state).toBe("running");
    expect(calls[0]?.url).toBe(`http://pageindex:8765/v1/jobs/${JOB}?workspaceId=${WS}`);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${"t".repeat(40)}`);
    expect(headers["x-flowaid-protocol"]).toBe("1");
  });

  it("turns error envelopes, bad bodies and unreachable services into typed errors", async () => {
    const answer = (res: Response | Error) =>
      new PageIndexServiceClient({
        baseUrl: "http://x",
        token: "t",
        fetch: () => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)),
      });
    const notFound = await answer(
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such document" } }), {
        status: 404,
      }),
    )
      .tree(WS, `pi-${"0".repeat(32)}`)
      .catch((e: unknown) => e);
    expect(notFound).toBeInstanceOf(PageIndexServiceError);
    expect(notFound).toMatchObject({ status: 404, code: "NOT_FOUND", transient: false });
    const bad = await answer(new Response(JSON.stringify({ tree: [{ nope: 1 }] })))
      .tree(WS, "pi-x")
      .catch((e: unknown) => e);
    expect(bad).toMatchObject({ code: "BAD_RESPONSE" });
    const down = await answer(new Error("ECONNREFUSED"))
      .health()
      .catch((e: unknown) => e);
    expect(down).toMatchObject({ status: 0, code: "UNAVAILABLE", transient: true });
    const busy = await answer(
      new Response(JSON.stringify({ error: { code: "BUSY", message: "at capacity" } }), {
        status: 429,
      }),
    )
      .getJob(WS, JOB)
      .catch((e: unknown) => e);
    expect(busy).toMatchObject({ transient: true });
  });
});
