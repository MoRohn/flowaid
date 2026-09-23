import type { JsonValue } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import type { ExecutorOutcome } from "./step.js";
import { okResult, simulate, type FakeCall } from "./testing/harness.js";
import { goldenPlan } from "./test/plans.js";

const plan = goldenPlan("support-triage");

const decision = (kind: string, value: JsonValue, confidence: number) => ({
  kind,
  value,
  confidence,
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 300,
  costUsd: 0.0002,
  usage: { inputTokens: 400, outputTokens: 0 },
  attempts: [],
  ...(kind === "boolean"
    ? { pYes: confidence, probabilities: { true: confidence, false: 1 - confidence } }
    : {}),
  ...(kind === "score"
    ? {
        levels: ["low", "medium", "high", "critical", "emergency"],
        level: Math.round(Number(value)),
        levelLabel: "low",
        normalized: Number(value) / 4,
      }
    : {}),
});

function executors(opts: {
  intent?: string;
  urgency?: number;
  escalate?: boolean;
  gate?: "pass" | "review" | "fail";
}) {
  return {
    judgments: () =>
      okResult(
        {
          answers: {
            intent: decision("choice", opts.intent ?? "billing", 0.91),
            urgency: decision("score", opts.urgency ?? 1.2, 0.8),
            escalate: decision("boolean", opts.escalate ?? false, 0.9),
          },
        },
        { costUsd: 0.0006, usage: { inputTokens: 1200, outputTokens: 0 } },
      ),
    "flowaid.tools.http": (c: FakeCall) =>
      okResult({ status: 200, headers: {}, body: { lookedUp: c.nodeId } }),
    security_kb: () => okResult({ result: { articles: 2 } }),
    draft: () =>
      okResult(
        {
          text: "Sorry about the double charge.",
          finish_reason: "stop",
          usage: { inputTokens: 600, outputTokens: 80 },
        },
        { costUsd: 0.0004 },
      ),
    safety: () =>
      okResult({
        answers: {
          on_topic: decision("boolean", true, 0.95),
          safe: decision("boolean", true, 0.97),
        },
      }),
    gate: (): ExecutorOutcome =>
      okResult(
        { decision: {}, passed: opts.gate === "pass", outcome: opts.gate ?? "pass" },
        { route: opts.gate ?? "pass" },
      ),
  };
}

const input = { message: "I was charged twice", customer_id: "cus_1", channel: "email" };

describe("support triage (golden plan)", () => {
  it("auto-responds on the billing path", async () => {
    const sim = await simulate({
      plan,
      input,
      executors: executors({}),
      context: { vars: { billingBase: "https://billing.example" } },
    });
    expect(sim.status).toBe("completed");
    const completed = sim.of("RUN_COMPLETED")[0];
    expect(completed?.outcome).toBe("auto");
    expect(completed?.output).toMatchObject({
      team: "billing",
      urgency: 1.2,
      reply: "Sorry about the double charge.",
      disposition: "auto",
    });
    const s = sim.statuses();
    expect(s).toMatchObject({
      start: "completed",
      judgments: "completed",
      esc_gate: "completed",
      route: "completed",
      billing_lookup: "completed",
      status_lookup: "skipped",
      security_kb: "skipped",
      context: "completed",
      draft: "completed",
      gate: "completed",
      approve: "skipped",
      out_auto: "completed",
      out_esc: "skipped",
      out_human: "skipped",
    });
    // Spend: node totals, counted once.
    expect(completed?.costUsd).toBeCloseTo(0.001);
    expect(sim.of("JOIN_ARRIVED").map((e) => [e.from, e.status])).toEqual(
      expect.arrayContaining([
        ["billing_lookup", "fired"],
        ["status_lookup", "pruned"],
        ["security_kb", "pruned"],
        ["route", "pruned"],
      ]),
    );
    expect(sim.events.map((e) => e.seq)).toEqual(sim.events.map((_, i) => i + 1));
    expect(sim.calls.find((c) => c.nodeId === "billing_lookup")?.config.url).toBe(
      "https://billing.example/customers/cus_1/invoices?limit=3",
    );
  });

  it("keeps going when an onError: ignore lookup fails (the environment variable is missing)", async () => {
    const sim = await simulate({ plan, input, executors: executors({}) });
    expect(sim.status).toBe("completed");
    expect(sim.statuses().billing_lookup).toBe("failed");
    expect(sim.of("NODE_FAILED")[0]?.error.message).toMatch(/billingBase/);
  });

  it("escalates without drafting", async () => {
    const sim = await simulate({ plan, input, executors: executors({ escalate: true }) });
    expect(sim.of("RUN_COMPLETED")[0]?.outcome).toBe("escalated");
    expect(sim.statuses()).toMatchObject({
      route: "skipped",
      draft: "skipped",
      approve: "skipped",
      out_esc: "completed",
    });
  });

  it("waits for a person, then completes with the edited reply", async () => {
    const sim = await simulate({
      plan,
      input,
      executors: executors({ intent: "security", gate: "review" }),
    });
    expect(sim.status).toBe("waiting_for_human");
    expect(sim.of("RUN_WAITING")).toHaveLength(1);
    const [task] = [...sim.humanTasks.values()];
    expect(task?.request).toMatchObject({
      origin: "human_node",
      mode: { type: "review", value: "Sorry about the double charge." },
    });
    expect(task?.request.title).toContain("security");
    await sim.respond("approve", { action: "approve", value: "Edited reply" }, "user:maria");
    expect(sim.status).toBe("completed");
    expect(sim.of("RUN_COMPLETED")[0]).toMatchObject({
      outcome: "human_approved",
      output: { reply: "Edited reply" },
    });
    expect(sim.types()).toContain("RUN_RESUMED");
  });
});
