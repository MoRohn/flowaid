import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import { assertNode } from "./assert.js";
import { logNode } from "./log.js";
import { metricNode } from "./metric.js";
import { mockNode } from "./mock.js";
import { stateGetNode } from "../state/get.js";
import { stateSetNode } from "../state/set.js";

describe("developer nodes", () => {
  it("log writes at the level and passes the value through", async () => {
    const r = await runNode(logNode, {
      config: { level: "warn", message: "checkpoint" },
      input: { value: { a: 1 } },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { value: { a: 1 } } });
    expect(r.recorder.logs).toEqual([{ level: "warn", message: "checkpoint", data: { a: 1 } }]);
  });

  it("assert passes on true and fails with the message otherwise", async () => {
    // The runtime hands the node the evaluated condition.
    expect(
      (await runNode(assertNode, { config: { condition: true }, input: { value: 1 } })).result,
    ).toMatchObject({ kind: "ok", output: { value: 1 } });
    expect(
      (
        await runNode(assertNode, {
          config: { condition: false, message: "total must be positive" },
        })
      ).result,
    ).toMatchObject({
      kind: "error",
      error: { code: "NODE_EXECUTION_ERROR", message: "total must be positive" },
    });
  });

  it("mock returns output, routes, or fails", async () => {
    expect((await runNode(mockNode, { config: { output: { ok: 1 } } })).result).toMatchObject({
      kind: "ok",
      output: { output: { ok: 1 } },
    });
    expect(
      (await runNode(mockNode, { config: { route: "alt", ports: ["alt"] } })).result,
    ).toMatchObject({ kind: "ok", route: "alt" });
    expect(
      (await runNode(mockNode, { config: { fail: { message: "nope", retryable: true } } })).result,
    ).toMatchObject({
      kind: "error",
      error: { message: "nope", retryable: true },
    });
  });

  it("metric emits a METRIC event", async () => {
    const r = await runNode(metricNode, {
      config: { name: "tickets.routed", labels: { queue: "billing" } },
      input: { value: 3 },
    });
    expect(r.recorder.events).toEqual([
      { type: "METRIC", name: "tickets.routed", value: 3, labels: { queue: "billing" } },
    ]);
  });
});

describe("state nodes", () => {
  it("set then get round-trips; missing keys fall back to default", async () => {
    const set = await runNode(stateSetNode, {
      config: { namespace: "session", key: "cart" },
      input: { value: [1, 2] },
    });
    expect(set.recorder.stateWrites).toEqual([
      { namespace: "session", key: "cart", value: [1, 2] },
    ]);
    const miss = await runNode(stateGetNode, {
      config: { namespace: "session", key: "cart", default: [] },
    });
    expect(miss.result).toMatchObject({ kind: "ok", output: { value: [], found: false } });
  });
});
