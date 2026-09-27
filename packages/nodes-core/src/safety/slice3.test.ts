import { describe, expect, it } from "vitest";
import { createTestContext, runNode } from "@flowaid/node-sdk/testing";
import { fakeDecider } from "../test/fakes.js";
import { permissionCheckNode, scopeCovers } from "./permission_check.js";
import { policyCheckNode } from "./policy_check.js";
import { rateLimitNode, takeTokens } from "./rate_limit.js";

describe("flowaid.safety.policy_check", () => {
  const rules = [
    { id: "too_big", when: "$scope.item.amount > 500", message: "Refunds over 500 need finance" },
    { id: "blocked", when: "$scope.item.country in ['XX']", message: "Blocked country" },
  ];

  it("allows a subject that breaks no rule", async () => {
    const r = await runNode(policyCheckNode, {
      config: { rules },
      input: { subject: { amount: 40, country: "US" } },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "allow",
      output: { allowed: true, violations: [], decision: null },
    });
  });

  it("lists every violation and denies", async () => {
    const r = await runNode(policyCheckNode, {
      config: { rules },
      input: { subject: { amount: 900, country: "XX" } },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "deny",
      output: { allowed: false, violations: [{ rule: "too_big" }, { rule: "blocked" }] },
    });
  });

  it("adds the policy question's answer when it says yes", async () => {
    const r = await runNode(policyCheckNode, {
      config: {
        rules: [],
        question: { instructions: "Does this promise a refund we do not offer?", threshold: 0.7 },
      },
      input: { subject: "We will refund you twice." },
      providers: { decision: fakeDecider({ pYes: 0.92 }) },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "deny",
      output: { violations: [{ rule: "question" }], decision: { kind: "boolean" } },
    });
  });

  it("reports a broken rule expression", async () => {
    const r = await runNode(policyCheckNode, {
      config: { rules: [{ id: "bad", when: "$scope.item >", message: "x" }] },
      input: { subject: 1 },
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "EXPRESSION_ERROR" } });
  });
});

describe("flowaid.safety.rate_limit", () => {
  it("refills over time and refuses when empty", () => {
    const refill = 10 / 60_000;
    let b = takeTokens(null, 0, 2, refill, 1);
    expect(b).toMatchObject({ allowed: true, bucket: { tokens: 1 } });
    b = takeTokens(b.bucket, 0, 2, refill, 1);
    expect(b.allowed).toBe(true);
    const empty = takeTokens(b.bucket, 0, 2, refill, 1);
    expect(empty).toMatchObject({ allowed: false, retryAfterMs: 6000 });
    expect(takeTokens(b.bucket, 6000, 2, refill, 1).allowed).toBe(true);
  });

  it("passes until the limit, then routes to limited; keys are separate", async () => {
    let now = Date.parse("2026-09-27T12:00:00Z");
    const make = (key: string, idem: string) =>
      createTestContext({
        config: rateLimitNode.configSchema.parse({ key, limit: 2, windowMs: 60_000 }),
        capabilities: rateLimitNode.capabilities,
        now: () => new Date(now),
        node: { idempotencyKey: idem },
      });
    const shared = make("customer:1", "k1");
    const run = async (idem: string, key = "customer:1") => {
      const own = make(key, idem);
      // the same state store for every call: reuse the first context's state
      const ctx = {
        ...own.ctx,
        state: shared.ctx.state,
        node: { ...own.ctx.node, idempotencyKey: idem },
      };
      return rateLimitNode.execute(ctx, { value: "x" });
    };
    expect(await run("a")).toMatchObject({ route: "pass", output: { remaining: 1 } });
    expect(await run("b")).toMatchObject({ route: "pass", output: { remaining: 0 } });
    expect(await run("c")).toMatchObject({
      route: "limited",
      output: { allowed: false, retry_after_ms: 30000 },
    });
    // a retry of the same attempt repeats its answer without paying
    expect(await run("c")).toMatchObject({ route: "limited" });
    expect(await run("d", "customer:2")).toMatchObject({ route: "pass" });
    now += 30_000;
    expect(await run("e")).toMatchObject({ route: "pass" });
  });
});

describe("flowaid.safety.permission_check", () => {
  it("matches wildcards", () => {
    expect(scopeCovers("refunds:*", "refunds:write")).toBe(true);
    expect(scopeCovers("*", "anything")).toBe(true);
    expect(scopeCovers("refunds:read", "refunds:write")).toBe(false);
  });

  it("grants from the subject credential's scopes", async () => {
    const r = await runNode(permissionCheckNode, {
      config: { require: ["refunds:write", "tickets:read"] },
      credentials: { subject: { token: "t", scopes: "refunds:* tickets:read" } },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "granted",
      output: { granted: true, missing: [] },
    });
  });

  it("denies with what is missing, from the scopes input", async () => {
    const r = await runNode(permissionCheckNode, {
      config: { require: ["refunds:write", "tickets:read"] },
      input: { scopes: ["tickets:read"] },
    });
    expect(r.result).toMatchObject({ route: "denied", output: { missing: ["refunds:write"] } });
    const any = await runNode(permissionCheckNode, {
      config: { require: ["refunds:write", "tickets:read"], mode: "any" },
      input: { scopes: "tickets:read" },
    });
    expect(any.result).toMatchObject({ route: "granted" });
  });
});
