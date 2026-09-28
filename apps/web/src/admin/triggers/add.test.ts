import { describe, expect, it } from "vitest";
import { cronProblem, exampleWebhookRequest, webhookPathFrom, withTrigger } from "./add";

describe("adding a trigger to a draft", () => {
  it("derives a webhook path from a workflow name", () => {
    expect(webhookPathFrom("Refund desk")).toBe("refund-desk");
    expect(webhookPathFrom("  Éclair / Orders #2 ")).toBe("eclair-orders-2");
    expect(webhookPathFrom("A")).toBe("a-in");
  });

  it("appends a webhook, refusing a bad or duplicate path", () => {
    const hook = {
      type: "webhook" as const,
      path: "orders",
      signature: "hmac_sha256" as const,
      responseMode: "async" as const,
    };
    const first = withTrigger({ name: "w", triggers: [{ type: "manual" }] }, hook);
    expect("definition" in first && first.definition.triggers).toEqual([
      { type: "manual" },
      { ...hook, inputPointer: "/body", allowedHeaders: [] },
    ]);
    if (!("definition" in first)) throw new Error("expected a definition");
    expect(withTrigger(first.definition, hook)).toEqual({
      error: "This workflow already has a webhook at /orders",
    });
    expect(withTrigger({}, { ...hook, path: "No Spaces" })).toHaveProperty("error");
  });

  it("appends a schedule with a normalised cron, once", () => {
    const tick = { type: "schedule" as const, cron: " 0  9 * * 1-5", timezone: "UTC", input: {} };
    const out = withTrigger({}, tick);
    expect("definition" in out && out.definition.triggers).toEqual([
      { ...tick, cron: "0 9 * * 1-5" },
    ]);
    if (!("definition" in out)) throw new Error("expected a definition");
    expect(withTrigger(out.definition, tick)).toHaveProperty("error");
    expect(cronProblem("every day")).not.toBeNull();
    expect(cronProblem("*/15 * * * *")).toBeNull();
  });

  it("writes a request with the headers each signature scheme needs", () => {
    const url = "http://127.0.0.1:3001/hooks/default/dev/orders";
    const signed = exampleWebhookRequest(url, "hmac_sha256");
    expect(signed).toContain("x-signature: sha256=$SIG");
    expect(signed).toContain("x-timestamp: $TS");
    expect(signed).toContain(`printf '%s.%s' "$TS" "$BODY"`);
    expect(exampleWebhookRequest(url, "token")).toContain("x-webhook-token: <signing secret>");
    expect(exampleWebhookRequest(url, "none")).not.toContain("x-signature");
  });
});
