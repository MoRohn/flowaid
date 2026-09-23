import { z } from "zod";
import { ForbiddenError, type DecisionProvider, type ProviderHop } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { defineNode, fail, ok, suspend, type AnyNodeDefinition } from "./index.js";
import { createTestContext, runNode } from "./testing/index.js";

const base = {
  version: "1.0.0",
  metadata: {
    name: "Test",
    description: "A test node",
    category: "data" as const,
    icon: "box",
    tags: [],
  },
  idempotency: "safe" as const,
};

const echo = defineNode({
  ...base,
  id: "flowaid.test.echo",
  configSchema: z.strictObject({ routes: z.array(z.string()).default([]) }),
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string(), length: z.int() }),
  portRules: [{ kind: "controlPortsFromConfig", path: "/routes" }],
  controlPorts: [{ name: "long" }],
  capabilities: ["streaming"],
  execute: (ctx, input) => {
    ctx.events.stream("text", input.text);
    ctx.events.emit({ type: "METRIC", name: "chars", value: input.text.length });
    ctx.logger.info("echoed", { length: input.text.length });
    const route = input.text.length > 5 ? "long" : ctx.config.routes[0];
    return Promise.resolve(
      ok({ text: input.text, length: input.text.length }, route ? { route } : {}),
    );
  },
}) as AnyNodeDefinition;

describe("runNode", () => {
  it("validates, executes and records like the runtime", async () => {
    const { result, recorder } = await runNode(echo, { input: { text: "hi" } });
    expect(result).toEqual({ kind: "ok", output: { text: "hi", length: 2 } });
    expect(recorder.deltas).toEqual([{ channel: "text", delta: "hi" }]);
    expect(recorder.events).toEqual([{ type: "METRIC", name: "chars", value: 2 }]);
    expect(recorder.logs).toEqual([{ level: "info", message: "echoed", data: { length: 2 } }]);
  });

  it("rejects invalid config and input before execute", async () => {
    expect((await runNode(echo, { config: { routes: "x" } })).result).toMatchObject({
      kind: "error",
      error: { code: "SCHEMA_VALIDATION_ERROR" },
    });
    expect((await runNode(echo, { input: { text: 5 } })).result).toMatchObject({
      kind: "error",
      error: { code: "SCHEMA_VALIDATION_ERROR" },
    });
  });

  it("accepts declared and config-derived routes and rejects others", async () => {
    expect((await runNode(echo, { input: { text: "longer text" } })).result).toMatchObject({
      kind: "ok",
      route: "long",
    });
    expect(
      (await runNode(echo, { input: { text: "a" }, config: { routes: ["billing"] } })).result,
    ).toMatchObject({ kind: "ok", route: "billing" });
    const rogue = {
      ...echo,
      execute: () => Promise.resolve(ok({ text: "a", length: 1 }, { route: "nowhere" })),
    } as AnyNodeDefinition;
    expect((await runNode(rogue, { input: { text: "a" } })).result).toMatchObject({
      kind: "error",
      error: { code: "NODE_EXECUTION_ERROR" },
    });
  });

  it("turns an output that breaks the schema into OUTPUT_SCHEMA_MISMATCH", async () => {
    const broken = {
      ...echo,
      execute: () => Promise.resolve(ok({ text: 1 })),
    } as AnyNodeDefinition;
    expect((await runNode(broken, { input: { text: "a" } })).result).toMatchObject({
      kind: "error",
      error: { code: "OUTPUT_SCHEMA_MISMATCH" },
    });
  });

  it("turns a throw into an error result", async () => {
    const thrower = {
      ...echo,
      execute: () => Promise.reject(new Error("boom")),
    } as AnyNodeDefinition;
    expect((await runNode(thrower, { input: { text: "a" } })).result).toMatchObject({
      kind: "error",
      error: { code: "INTERNAL", message: "boom" },
    });
    const failing = {
      ...echo,
      execute: () => Promise.resolve(fail(new ForbiddenError("no"))),
    } as AnyNodeDefinition;
    expect((await runNode(failing, { input: { text: "a" } })).result).toMatchObject({
      kind: "error",
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("capability gating", () => {
  it("throws ForbiddenError from every service of an undeclared capability", async () => {
    const { ctx } = createTestContext({ capabilities: ["streaming"] });
    await expect(ctx.credentials.get("x")).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => ctx.credentials.has("x")).toThrow(ForbiddenError);
    await expect(ctx.http("https://example.com")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ctx.tools.list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ctx.state.get("run", "k")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ctx.artifacts.put("a", "b", "text/plain")).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => ctx.providers.decision([{ provider: "typesafe", model: "jev-latest" }])).toThrow(
      /'decision' capability/,
    );
    expect(() => ctx.providers.generation({ provider: "openai", model: "gpt" })).toThrow(
      ForbiddenError,
    );
    expect(() => ctx.events.stream("text", "x")).not.toThrow();
  });

  it("serves declared capabilities from the in-memory fakes", async () => {
    const decision = { id: "fake" } as unknown as DecisionProvider;
    const seen: (readonly ProviderHop[])[] = [];
    const { ctx, recorder } = createTestContext({
      capabilities: ["credentials", "state", "artifacts", "decision"],
      credentials: { typesafe: { apiKey: "k" } },
      providers: { decision: (chain) => (seen.push(chain), decision) },
    });
    expect(await ctx.credentials.get("typesafe")).toEqual({ apiKey: "k" });
    await expect(ctx.credentials.get("other")).rejects.toMatchObject({ code: "CREDENTIAL_ERROR" });
    expect(recorder.credentialReads).toEqual(["typesafe", "other"]);
    await ctx.state.set("run", "k", 1);
    expect(await ctx.state.cas("run", "k", 1, 2)).toBe(true);
    expect(await ctx.state.cas("run", "k", 1, 3)).toBe(false);
    expect(await ctx.state.get("run", "k")).toBe(2);
    const ref = await ctx.artifacts.put("a.txt", "hello", "text/plain");
    expect(new TextDecoder().decode(await ctx.artifacts.get(ref.$artifact))).toBe("hello");
    expect(ctx.providers.decision([{ provider: "typesafe", model: "jev-latest" }])).toBe(decision);
    expect(seen).toHaveLength(1);
  });
});

describe("suspend and resume", () => {
  const approval = defineNode({
    ...base,
    id: "flowaid.test.approval",
    configSchema: z.strictObject({}),
    inputSchema: z.object({ amount: z.number() }),
    outputSchema: z.object({ approved: z.boolean() }),
    capabilities: ["suspend"],
    execute: (ctx, input) => {
      if (!ctx.resume) {
        return Promise.resolve(
          suspend<{ approved: boolean }>(
            {
              kind: "human",
              request: {
                kind: "approval",
                title: `Refund ${input.amount}`,
                context: {},
                assignees: [],
              } as never,
            },
            { amount: input.amount },
          ),
        );
      }
      const approved = ctx.resume.kind === "human" && ctx.resume.response.action === "approve";
      return Promise.resolve(ok({ approved }));
    },
  }) as AnyNodeDefinition;

  it("suspends with state, then completes on re-entry with ctx.resume", async () => {
    const first = await runNode(approval, { input: { amount: 12 } });
    expect(first.result).toMatchObject({ kind: "suspend", state: { amount: 12 } });
    const second = await runNode(approval, {
      input: { amount: 12 },
      resume: {
        kind: "human",
        state: { amount: 12 },
        response: { action: "approve" } as never,
        by: "u1",
        humanTaskId: "t1",
      },
    });
    expect(second.result).toEqual({ kind: "ok", output: { approved: true } });
  });

  it("refuses to suspend without the suspend capability", async () => {
    const sneaky = { ...approval, capabilities: [] } as AnyNodeDefinition;
    expect((await runNode(sneaky, { input: { amount: 1 } })).result).toMatchObject({
      kind: "error",
      error: { code: "FORBIDDEN" },
    });
  });
});
