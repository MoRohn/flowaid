import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { ExecutionContext } from "@flowaid/node-sdk";
import type { JsonObject, JsonValue } from "@flowaid/workflow-core";
import { PluginHost } from "./host.js";
import { crash, echo, wait } from "./test/fixturePlugin.js";

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function context(over: Partial<ExecutionContext> = {}) {
  const logs: string[] = [];
  const deltas: string[] = [];
  const state = new Map<string, JsonValue>();
  const requests: { url: string; body: string }[] = [];
  const controller = new AbortController();
  const ctx = {
    run: { id: "r1", workspaceId: "w1" },
    node: { id: "n1", nodeRunId: "nr1" },
    config: { url: "https://api.example.test/echo" },
    vars: {},
    scope: {},
    signal: controller.signal,
    logger: {
      debug: () => undefined,
      info: (m: string) => logs.push(m),
      warn: () => undefined,
      error: () => undefined,
    },
    credentials: {
      has: (slot: string) => slot === "api",
      get: () => Promise.resolve({ token: "s3cr3t" }),
    },
    providers: {},
    tools: {},
    state: {
      get: (_ns: string, key: string) => Promise.resolve(state.get(key) ?? null),
      set: (_ns: string, key: string, value: JsonValue) => {
        state.set(key, value);
        return Promise.resolve();
      },
    },
    artifacts: {},
    events: { emit: () => undefined, stream: (_c: string, d: string) => deltas.push(d) },
    budget: { remainingCostUsd: null, remainingTokens: null, remainingMs: 10_000 },
    http: async (url: string, init?: RequestInit) => {
      requests.push({ url, body: await new Response(init?.body).text() });
      return new Response(`pong:${requests.length}`, { status: 201 });
    },
    clock: { now: () => new Date() },
    ...over,
  } as unknown as ExecutionContext;
  return { ctx, logs, deltas, state, requests, controller };
}

describe("plugin host process", () => {
  const host = new PluginHost({
    packageName: "acme-plugin",
    version: "1.0.0",
    modulePath: fileURLToPath(new URL("./test/fixturePlugin.ts", import.meta.url)),
    log: silent,
  });
  afterAll(() => host.stop());

  it("runs the node in another process with its context proxied back", async () => {
    const c = context();
    const result = await host.execute(echo as never, c.ctx, { text: "hello" });
    expect(result.kind).toBe("ok");
    const out = (result as { output: JsonObject }).output;
    expect(out).toMatchObject({
      text: "hello",
      secret: "s3cr3t",
      status: 201,
      body: "pong:1",
      stored: "hello",
    });
    expect(out.pid).not.toBe(process.pid);
    expect(c.requests).toEqual([{ url: "https://api.example.test/echo", body: "hello" }]);
    expect(c.logs).toEqual(["echoing"]);
    expect(c.deltas).toEqual(["hello"]);
  }, 30_000);

  it("propagates the worker's cancellation into the host", async () => {
    const c = context();
    const pending = host.execute(wait as never, c.ctx, {});
    setTimeout(() => c.controller.abort(), 200);
    await expect(pending).resolves.toMatchObject({ kind: "ok", output: { aborted: true } });
  }, 30_000);

  it("hosts the bundled LangChain package (allow-listed by name)", async () => {
    const lc = new PluginHost({ packageName: "@flowaid/nodes-langchain", log: silent });
    try {
      const splitter = { id: "@flowaid/nodes-langchain.text_splitter", version: "1.0.0" };
      const c = context({
        config: {
          splitter: "markdown",
          chunkSize: 60,
          chunkOverlap: 0,
          separator: "\n\n",
          language: "js",
        } as never,
      });
      const r = await lc.execute(splitter as never, c.ctx, {
        text: "# One\nFirst section text here.\n\n# Two\nSecond section text here.",
      });
      expect(r).toMatchObject({ kind: "ok", output: { count: 2 } });
      // a node's thrown FlowaidError keeps its code across the boundary
      const bad = await lc.execute(
        splitter as never,
        context({
          config: { splitter: "recursive", chunkSize: 100, chunkOverlap: 100 } as never,
        }).ctx,
        { text: "x" },
      );
      expect(bad).toMatchObject({ kind: "error", error: { code: "BAD_REQUEST" } });
    } finally {
      await lc.stop();
    }
  }, 60_000);

  it("fails in-flight executions when the host crashes, then restarts it", async () => {
    const c = context();
    await expect(host.execute(crash as never, c.ctx, {})).rejects.toMatchObject({
      code: "NODE_EXECUTION_ERROR",
      retryable: true,
      details: { reason: "PLUGIN_HOST_CRASHED" },
    });
    expect(host.restarts).toBe(1);
    const again = await host.execute(echo as never, context().ctx, { text: "after" });
    expect(again).toMatchObject({ kind: "ok", output: { text: "after" } });
  }, 30_000);
});
