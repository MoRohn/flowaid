import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import { debugNode, describeValue } from "./debug.js";
import { testNode } from "./test.js";
import { traceNode } from "./trace.js";

describe("flowaid.dev.test", () => {
  it("routes to pass when every assertion holds", async () => {
    const r = await runNode(testNode, {
      config: {
        assertions: [
          { name: "has a reply", check: "$scope.item.reply != ''" },
          { name: "is routed", check: "$scope.item.route == 'billing'" },
        ],
      },
      input: { actual: { reply: "Hi", route: "billing" } },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "pass",
      output: { passed: true, failures: 0 },
    });
  });

  it("routes to fail with each failure, including broken expressions, without throwing", async () => {
    const r = await runNode(testNode, {
      config: {
        assertions: [
          { name: "is routed", check: "$scope.item.route == 'billing'" },
          { name: "broken", check: "$scope.item ==" },
        ],
      },
      input: { actual: { route: "general" } },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "fail",
      output: {
        passed: false,
        failures: 2,
        results: [
          { name: "is routed", passed: false },
          { name: "broken", passed: false, error: expect.any(String) },
        ],
      },
    });
    expect(r.recorder.logs.filter((l) => l.level === "warn")).toHaveLength(2);
  });
});

describe("flowaid.dev.debug", () => {
  it("logs the value or its shape and passes it through", async () => {
    const r = await runNode(debugNode, {
      config: { label: "ticket", show: "shape", level: "info" },
      input: { value: { a: 1, b: [1, 2] } },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { value: { a: 1, b: [1, 2] } } });
    expect(r.recorder.logs[0]).toMatchObject({
      level: "info",
      message: "ticket",
      data: { value: { type: "object", keys: ["a", "b"], size: 2 } },
    });
    expect(describeValue("abc")).toEqual({ type: "string", length: 3 });
  });
});

describe("flowaid.dev.trace", () => {
  it("emits a timeline marker and passes the value through", async () => {
    const r = await runNode(traceNode, {
      config: { name: "after_lookup", attributes: { team: "billing" } },
      input: { value: 3 },
      now: () => new Date("2026-09-27T12:00:00Z"),
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { value: 3, at: "2026-09-27T12:00:00.000Z" },
    });
    expect(r.recorder.events).toEqual([
      {
        type: "METRIC",
        name: "trace.marker",
        value: 1,
        labels: { marker: "after_lookup", team: "billing" },
      },
    ]);
  });
});
