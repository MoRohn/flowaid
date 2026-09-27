import { describe, expect, it } from "vitest";
import { createTestContext, runNode } from "@flowaid/node-sdk/testing";
import type { ExecutionContext } from "@flowaid/node-sdk";
import { checkpointNode } from "./checkpoint.js";
import { sessionNode } from "./session.js";

/** Several executions over one state store, like consecutive runs of a workflow. */
function sharedRuns(opts: { sessionId?: string | null; now?: () => Date } = {}) {
  const base = createTestContext({
    capabilities: ["state"],
    run: { sessionId: opts.sessionId === undefined ? "sess_1" : opts.sessionId },
    ...(opts.now ? { now: opts.now } : {}),
  });
  return <C>(config: C, idem: string | null = null): ExecutionContext<C> => ({
    ...base.ctx,
    config,
    node: { ...base.ctx.node, idempotencyKey: idem },
  });
}

describe("flowaid.state.session", () => {
  it("appends turns and reads the last N", async () => {
    const at = sharedRuns();
    const cfg = sessionNode.configSchema.parse({ lastN: 2 });
    await sessionNode.execute(at(cfg, "k1"), { turn: { role: "user", content: "one" } });
    await sessionNode.execute(at(cfg, "k2"), { turn: { role: "assistant", content: "two" } });
    const r = await sessionNode.execute(at(cfg, "k3"), {
      turn: { role: "user", content: "three" },
    });
    expect(r).toMatchObject({
      kind: "ok",
      output: { count: 3, turns: [{ content: "two" }, { content: "three" }] },
    });
    const read = await sessionNode.execute(at(sessionNode.configSchema.parse({ op: "read" })), {});
    expect(read).toMatchObject({ output: { count: 3 } });
  });

  it("does not append twice when the same attempt is retried", async () => {
    const at = sharedRuns();
    const cfg = sessionNode.configSchema.parse({});
    await sessionNode.execute(at(cfg, "same"), { turn: "hi" });
    const again = await sessionNode.execute(at(cfg, "same"), { turn: "hi" });
    expect(again).toMatchObject({ output: { count: 1 } });
  });

  it("forgets the session after its time-to-live", async () => {
    let now = Date.parse("2026-09-27T12:00:00Z");
    const at = sharedRuns({ now: () => new Date(now) });
    const cfg = sessionNode.configSchema.parse({ ttlMs: 60_000 });
    await sessionNode.execute(at(cfg, "a"), { turn: "old" });
    now += 61_000;
    const r = await sessionNode.execute(at(cfg, "b"), { turn: "new" });
    expect(r).toMatchObject({ output: { count: 1, turns: ["new"] } });
  });

  it("needs a session", async () => {
    const r = await runNode(sessionNode, {
      config: {},
      input: { turn: "x" },
      run: { sessionId: null },
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "BAD_REQUEST" } });
  });
});

describe("flowaid.state.checkpoint", () => {
  it("saves versions and loads the latest", async () => {
    const at = sharedRuns();
    const save = checkpointNode.configSchema.parse({ name: "plan" });
    const first = await checkpointNode.execute(at(save, "s1"), { value: { step: 1 } });
    expect(first).toMatchObject({ output: { version: 1, found: true, value: { step: 1 } } });
    const second = await checkpointNode.execute(at(save, "s2"), {
      value: { step: 2 },
      expected_version: 1,
    });
    expect(second).toMatchObject({ output: { version: 2 } });
    const load = await checkpointNode.execute(
      at(checkpointNode.configSchema.parse({ name: "plan", op: "load" })),
      {},
    );
    expect(load).toMatchObject({ output: { version: 2, value: { step: 2 }, found: true } });
  });

  it("refuses a save against a stale version", async () => {
    const at = sharedRuns();
    const save = checkpointNode.configSchema.parse({ name: "plan" });
    await checkpointNode.execute(at(save, "s1"), { value: 1 });
    await expect(
      checkpointNode.execute(at(save, "s2"), { value: 2, expected_version: 0 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a retried save keeps its version", async () => {
    const at = sharedRuns();
    const save = checkpointNode.configSchema.parse({ name: "plan" });
    await checkpointNode.execute(at(save, "s1"), { value: 1 });
    const retry = await checkpointNode.execute(at(save, "s1"), { value: 1 });
    expect(retry).toMatchObject({ output: { version: 1 } });
  });

  it("loads nothing when there is no checkpoint", async () => {
    const r = await runNode(checkpointNode, { config: { name: "none", op: "load" } });
    expect(r.result).toMatchObject({ output: { found: false, version: 0, value: null } });
  });
});
