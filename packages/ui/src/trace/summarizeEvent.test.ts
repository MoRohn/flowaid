import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunEventSchema, type RunEvent, type RunEventType } from "@flowaid/workflow-core";
import {
  EVENT_FAMILIES,
  eventFamily,
  eventIsFailure,
  eventIsWarning,
  eventNodeId,
  eventPayload,
  summarizeEvent,
} from "./summarizeEvent";
import { SAMPLE_NODES, buildSampleCompletionEvents, buildSampleEvents } from "./sampleRun";

/** `packages/workflow-core/fixtures/events/`, resolved from this test file (vitest reports its absolute path). */
function fixturesDir(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("vitest did not report the test path");
  return join(dirname(testPath), "../../../workflow-core/fixtures/events/");
}
const FIXTURES_DIR = fixturesDir();

/** Every `type` literal of the `RunEventSchema` union, read from the schema itself. */
function schemaEventTypes(): RunEventType[] {
  return RunEventSchema.options.map((option) => option.shape.type.value);
}

/** One Zod-validated fixture per event type from `packages/workflow-core/fixtures/events`. */
function fixtureEvents(): Map<RunEventType, RunEvent> {
  const out = new Map<RunEventType, RunEvent>();
  for (const file of readdirSync(FIXTURES_DIR)) {
    if (!file.endsWith(".json")) continue;
    const parsed = RunEventSchema.parse(JSON.parse(readFileSync(`${FIXTURES_DIR}${file}`, "utf8")));
    out.set(parsed.type, parsed);
  }
  return out;
}

describe("summarizeEvent", () => {
  const types = schemaEventTypes();
  const fixtures = fixtureEvents();

  it("has a fixture for every RunEventSchema option", () => {
    expect([...fixtures.keys()].sort()).toEqual([...types].sort());
  });

  it("summarises every event type from its Zod-validated fixture without leaking undefined", () => {
    for (const type of types) {
      const event = fixtures.get(type);
      if (!event) throw new Error(`missing fixture for ${type}`);
      const s = summarizeEvent(event);
      expect(s.length, type).toBeGreaterThan(0);
      expect(s, type).not.toMatch(/undefined|null|\[object|NaN/);
      expect(EVENT_FAMILIES, type).toContain(eventFamily(type));
      const named = summarizeEvent(event, "Named node");
      if (eventNodeId(event)) expect(named, type).toContain("Named node");
    }
  });

  it("strips the envelope and the node address from the payload block", () => {
    const started = fixtures.get("NODE_STARTED");
    if (!started) throw new Error("missing NODE_STARTED fixture");
    const payload = eventPayload(started);
    expect(Object.keys(payload).sort()).toEqual(["input", "pool", "workerId"]);
    const heartbeat = fixtures.get("HEARTBEAT");
    if (!heartbeat) throw new Error("missing HEARTBEAT fixture");
    expect(eventPayload(heartbeat)).toEqual({});
  });

  it("writes the expected one-liners for the sample run", () => {
    const events = [...buildSampleEvents(), ...buildSampleCompletionEvents()];
    const byType = (t: RunEventType): RunEvent => {
      const found = events.find((e) => e.type === t);
      if (!found) throw new Error(`missing sample event ${t}`);
      return found;
    };
    const named = (e: RunEvent) => {
      const nodeId = eventNodeId(e);
      return summarizeEvent(e, nodeId ? SAMPLE_NODES[nodeId]?.name : undefined);
    };
    expect(summarizeEvent(byType("RUN_CREATED"))).toBe("Created by Webhook (async)");
    expect(summarizeEvent(byType("RUN_STARTED"))).toBe("Started on wrk-eu-3");
    expect(named(byType("DECISION_COMPLETED"))).toBe(
      "Intent → security (0.81) · jev-1.13.0 · 84 ms",
    );
    expect(named(byType("NODE_FAILED"))).toBe(
      "Lookup account failed TOOL_EXECUTION_ERROR · GET /v1/customers/cus_9Yt3LqA8 → 503 Service Unavailable (upstream: accounts-api)",
    );
    expect(named(byType("NODE_RETRIED"))).toBe(
      "Lookup account retrying attempt 2 after 500 ms · TOOL_EXECUTION_ERROR",
    );
    expect(named(byType("TOOL_CALLED"))).toBe("Lookup account called accounts.getCustomer (http)");
    expect(named(byType("TOOL_RETURNED"))).toBe(
      "Lookup account · accounts.getCustomer failed TOOL_EXECUTION_ERROR · 815 ms",
    );
    expect(named(byType("PROVIDER_FAILOVER"))).toBe(
      "Draft reply failover openai:eu-west → openai:us-east · PROVIDER_RATE_LIMITED · 429 rate limited, retry-after 30 s exceeds node budget",
    );
    expect(summarizeEvent(byType("CHECKPOINT_CREATED"))).toMatch(/^Checkpoint at seq \d+$/);
    expect(named(byType("LOOP_ITERATION_STARTED"))).toBe("Enrich findings iteration 1 started");
    expect(named(byType("GENERATION_COMPLETED"))).toBe(
      "Draft reply completed · 312 tokens out · $0.00091 · 1.24 s",
    );
    expect(named(byType("HUMAN_APPROVAL_REQUESTED"))).toBe(
      "Approve reply waiting for approval · support-leads · Approve the reply to TCK-48213",
    );
    expect(named(byType("HUMAN_APPROVAL_RECEIVED"))).toBe("Approve reply approve by m.okafor");
    expect(summarizeEvent(byType("RUN_COMPLETED"))).toBe(
      "Run completed · 4 m 17 s · $0.00164 · replied",
    );
    expect(named(byType("LOG"))).toBe(
      "Confidence gate · INFO confidence 0.81 in [0.70, 0.90) → secondary review",
    );
    expect(summarizeEvent(byType("GENERATION_DELTA"))).toMatch(/^draft text delta · “Hi Priya/);
  });

  it("names every run origin, including restart, fork, mcp, subflow and ui", () => {
    const created = fixtures.get("RUN_CREATED");
    if (!created || created.type !== "RUN_CREATED") throw new Error("missing RUN_CREATED fixture");
    expect(summarizeEvent({ ...created, origin: "restart" })).toBe(
      `Created by Restart (${created.mode})`,
    );
    expect(summarizeEvent({ ...created, origin: "fork" })).toBe(
      `Created by Fork (${created.mode})`,
    );
    expect(summarizeEvent({ ...created, origin: "mcp" })).toBe(`Created by MCP (${created.mode})`);
    expect(summarizeEvent({ ...created, origin: "subflow" })).toBe(
      `Created by Subflow (${created.mode})`,
    );
    expect(summarizeEvent({ ...created, origin: "ui" })).toBe(
      `Created by Manual (${created.mode})`,
    );
  });

  it("falls back to the node id when no name is known and truncates long messages", () => {
    const failed = fixtures.get("NODE_FAILED");
    if (!failed || failed.type !== "NODE_FAILED") throw new Error("missing NODE_FAILED fixture");
    expect(summarizeEvent(failed)).toMatch(new RegExp(`^${failed.nodeId} failed`));
    const s = summarizeEvent({ ...failed, error: { ...failed.error, message: "x".repeat(200) } });
    expect(s.length).toBeLessThan(160);
    expect(s).toContain("…");
  });

  it("formats decision values of every kind", () => {
    const completed = fixtures.get("DECISION_COMPLETED");
    if (!completed || completed.type !== "DECISION_COMPLETED")
      throw new Error("missing DECISION_COMPLETED fixture");
    const events = buildSampleEvents();
    const kinds = new Set(
      events
        .filter((e) => e.type === "DECISION_COMPLETED")
        .map((e) => (e.type === "DECISION_COMPLETED" ? e.decision.kind : "")),
    );
    expect([...kinds].sort()).toEqual(["boolean", "choice", "score"]);
    for (const e of events) {
      if (e.type !== "DECISION_COMPLETED") continue;
      const s = summarizeEvent(e, "Q");
      if (e.decision.kind === "boolean") expect(s).toMatch(/^Q → (yes|no) \(/);
      if (e.decision.kind === "score") expect(s).toMatch(/^Q → \d\.\d\d [a-z]+ \(/);
      if (e.decision.kind === "choice")
        expect(s).toMatch(new RegExp(`^Q → ${e.decision.value} \\(`));
    }
    expect(summarizeEvent(completed, "Intent")).toBe(
      "Intent → billing (0.91) · jev-1.13.0 · 310 ms",
    );
  });
});

describe("eventFamily", () => {
  it("classifies every schema type into a family", () => {
    for (const type of schemaEventTypes()) expect(EVENT_FAMILIES).toContain(eventFamily(type));
    expect(eventFamily("RUN_CREATED")).toBe("run");
    expect(eventFamily("NODE_RETRIED")).toBe("node");
    expect(eventFamily("BRANCH_EVALUATED")).toBe("flow");
    expect(eventFamily("FOREACH_ITEM_COMPLETED")).toBe("loop");
    expect(eventFamily("SUBFLOW_COMPLETED")).toBe("subflow");
    expect(eventFamily("DECISION_COMPLETED")).toBe("decision");
    expect(eventFamily("GENERATION_DELTA")).toBe("generation");
    expect(eventFamily("TOOL_RETURNED")).toBe("tool");
    expect(eventFamily("PROVIDER_FAILOVER")).toBe("provider");
    expect(eventFamily("CHECKPOINT_CREATED")).toBe("checkpoint");
    expect(eventFamily("HUMAN_APPROVAL_RECEIVED")).toBe("human");
    expect(eventFamily("METRIC")).toBe("log");
  });
  it("marks failures and warnings", () => {
    const types = schemaEventTypes();
    expect(types.filter(eventIsFailure).sort()).toEqual([
      "NODE_FAILED",
      "RUN_FAILED",
      "RUN_TIMED_OUT",
    ]);
    expect(types.filter(eventIsWarning).sort()).toEqual([
      "HUMAN_TASK_EXPIRED",
      "NODE_CANCELLED",
      "NODE_RETRIED",
      "PROVIDER_FAILOVER",
      "RUN_CANCELLED",
      "RUN_CANCEL_REQUESTED",
    ]);
  });
});

describe("sample events", () => {
  it("are spec-exact RunEvents", () => {
    for (const e of [...buildSampleEvents(), ...buildSampleCompletionEvents()]) {
      const parsed = RunEventSchema.safeParse(e);
      expect(
        parsed.success,
        `${e.type} seq ${e.seq}: ${parsed.success ? "" : parsed.error.message}`,
      ).toBe(true);
    }
  });
});
