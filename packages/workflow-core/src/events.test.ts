/**
 * `RunEventSchema` against the documented examples in `fixtures/events/`: exactly one
 * JSON example per event type (the file name is the type), every example parses
 * unchanged, and every field of every example is load-bearing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RunEventSchema,
  TERMINAL_EVENT_TYPES,
  TimerPurposeSchema,
  WaitReasonSchema,
  type RunEvent,
  type RunEventType,
} from "./events.js";
import { ErrorInfoSchema } from "./errors.js";
import { DecisionResultSchema } from "./decision.js";
import { HumanRequestSchema, HumanResponseSchema } from "./human.js";

const EVENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "events");
const EVENT_TYPES: RunEventType[] = RunEventSchema.options.map((o) => o.shape.type.value);

/** Reads every `fixtures/events/*.json` as untyped JSON keyed by file stem. */
function readExamples(): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const file of readdirSync(EVENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    out.set(
      file.slice(0, -".json".length),
      JSON.parse(readFileSync(join(EVENTS_DIR, file), "utf8")),
    );
  }
  return out;
}

const examples = readExamples();

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("expected an object");
  return { ...value };
}

describe("fixtures/events", () => {
  it("holds exactly one example per RunEvent type, named after the type", () => {
    expect([...examples.keys()]).toEqual([...EVENT_TYPES].sort());
    expect(EVENT_TYPES).toHaveLength(50);
  });

  for (const type of EVENT_TYPES) {
    describe(type, () => {
      const raw = examples.get(type);

      it("parses with RunEventSchema and survives unchanged", () => {
        const result = RunEventSchema.safeParse(raw);
        expect(
          result.success,
          JSON.stringify(result.success ? null : result.error.issues, null, 2),
        ).toBe(true);
        if (!result.success) return;
        expect(result.data.type).toBe(type);
        expect(result.data).toEqual(raw);
        expect(JSON.parse(JSON.stringify(result.data))).toEqual(raw);
      });

      it("needs every field it carries (no field is silently optional)", () => {
        const record = asRecord(raw);
        for (const key of Object.keys(record)) {
          const { [key]: _dropped, ...rest } = record;
          expect(RunEventSchema.safeParse(rest).success, `without ${key}`).toBe(false);
        }
      });

      it("rejects a different discriminator with the same payload", () => {
        const record = asRecord(raw);
        const other = EVENT_TYPES.find(
          (t) => t !== type && t.startsWith("NODE_") !== type.startsWith("NODE_"),
        );
        expect(other).toBeDefined();
        expect(RunEventSchema.safeParse({ ...record, type: other }).success).toBe(false);
        expect(RunEventSchema.safeParse({ ...record, type: "UNKNOWN_EVENT" }).success).toBe(false);
      });
    });
  }
});

describe("RunEventSchema invariants", () => {
  const parsed: RunEvent[] = EVENT_TYPES.map((t) => RunEventSchema.parse(examples.get(t)));
  const nodeLevel = parsed.filter((e) => "nodeRunId" in e && "scope" in e && "attempt" in e);

  it("every example shares one run and carries a monotonic seq (0 for ephemeral events)", () => {
    const runIds = new Set(parsed.map((e) => e.runId));
    expect(runIds.size).toBe(1);
    for (const e of parsed) {
      if ("ephemeral" in e) expect(e.seq, e.type).toBe(0);
      else expect(e.seq, e.type).toBeGreaterThanOrEqual(0);
    }
    const durableSeqs = parsed.filter((e) => !("ephemeral" in e)).map((e) => e.seq);
    expect(new Set(durableSeqs).size).toBe(durableSeqs.length);
  });

  it("ephemeral events are exactly GENERATION_DELTA and HEARTBEAT and require ephemeral: true", () => {
    const ephemeral = parsed
      .filter((e) => "ephemeral" in e)
      .map((e) => e.type)
      .sort();
    expect(ephemeral).toEqual(["GENERATION_DELTA", "HEARTBEAT"]);
    const heartbeat = asRecord(examples.get("HEARTBEAT"));
    expect(RunEventSchema.safeParse({ ...heartbeat, ephemeral: false }).success).toBe(false);
    const delta = asRecord(examples.get("GENERATION_DELTA"));
    expect(RunEventSchema.safeParse({ ...delta, ephemeral: false }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...delta, channel: "audio" }).success).toBe(false);
  });

  it("node-level events carry the full (nodeRunId, nodeId, scope, attempt) address", () => {
    expect(nodeLevel.length).toBe(37);
    const scopes = new Set(nodeLevel.map((e) => ("scope" in e ? e.scope : "")));
    expect(scopes.has("")).toBe(true);
    expect(scopes.has("research#0")).toBe(true);
    expect(scopes.has("research#0/search_all#1")).toBe(true);
    const retried = asRecord(examples.get("NODE_RETRIED"));
    expect(RunEventSchema.safeParse({ ...retried, attempt: 0 }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...retried, nextAttempt: 1 }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...retried, scope: "Research#0" }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...retried, nodeRunId: "not-a-uuid" }).success).toBe(false);
  });

  it("run-level events never carry a node address", () => {
    for (const e of parsed) {
      if (e.type.startsWith("RUN_") || e.type === "CHECKPOINT_CREATED" || e.type === "HEARTBEAT") {
        expect("scope" in e, e.type).toBe(false);
        expect("attempt" in e, e.type).toBe(false);
      }
    }
  });

  it("terminal event types are the four run endings and all have examples", () => {
    expect([...TERMINAL_EVENT_TYPES].sort()).toEqual([
      "RUN_CANCELLED",
      "RUN_COMPLETED",
      "RUN_FAILED",
      "RUN_TIMED_OUT",
    ]);
    for (const t of TERMINAL_EVENT_TYPES) {
      const e = parsed.find((x) => x.type === t);
      expect(e).toBeDefined();
      if (e === undefined || !("usage" in e) || !("durationMs" in e) || !("costUsd" in e))
        throw new Error("terminal events carry accounting");
      expect(e.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(e.durationMs).toBeGreaterThanOrEqual(0);
      expect(e.costUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("embeds the nested contract schemas (ErrorInfo, DecisionResult, HumanRequest, HumanResponse)", () => {
    const failed = RunEventSchema.parse(examples.get("NODE_FAILED"));
    if (failed.type !== "NODE_FAILED") throw new Error("unreachable");
    expect(ErrorInfoSchema.safeParse(failed.error).success).toBe(true);
    expect(failed.error.retryable).toBe(true);
    expect(failed.terminal).toBe(true);
    const decided = RunEventSchema.parse(examples.get("DECISION_COMPLETED"));
    if (decided.type !== "DECISION_COMPLETED") throw new Error("unreachable");
    expect(DecisionResultSchema.safeParse(decided.decision).success).toBe(true);
    expect(decided.decision.kind).toBe("choice");
    const requested = RunEventSchema.parse(examples.get("HUMAN_APPROVAL_REQUESTED"));
    if (requested.type !== "HUMAN_APPROVAL_REQUESTED") throw new Error("unreachable");
    expect(HumanRequestSchema.safeParse(requested.request).success).toBe(true);
    expect(requested.request.origin).toBe("human_node");
    const received = RunEventSchema.parse(examples.get("HUMAN_APPROVAL_RECEIVED"));
    if (received.type !== "HUMAN_APPROVAL_RECEIVED") throw new Error("unreachable");
    expect(HumanResponseSchema.safeParse(received.response).success).toBe(true);
    expect(received.humanTaskId).toBe(requested.humanTaskId);
  });

  it("rejects wrong enum members on the closed reason fields", () => {
    const skipped = asRecord(examples.get("NODE_SKIPPED"));
    expect(RunEventSchema.safeParse({ ...skipped, reason: "because" }).success).toBe(false);
    const waiting = asRecord(examples.get("RUN_WAITING"));
    for (const reason of WaitReasonSchema.options)
      expect(RunEventSchema.safeParse({ ...waiting, reason }).success, reason).toBe(true);
    expect(RunEventSchema.safeParse({ ...waiting, reason: "sleep" }).success).toBe(false);
    const timer = asRecord(examples.get("TIMER_SET"));
    for (const purpose of TimerPurposeSchema.options)
      expect(RunEventSchema.safeParse({ ...timer, purpose }).success, purpose).toBe(true);
    expect(RunEventSchema.safeParse({ ...timer, purpose: "snooze" }).success).toBe(false);
    const exited = asRecord(examples.get("LOOP_EXITED"));
    expect(RunEventSchema.safeParse({ ...exited, reason: "bored" }).success).toBe(false);
    const called = asRecord(examples.get("TOOL_CALLED"));
    expect(RunEventSchema.safeParse({ ...called, source: "shell" }).success).toBe(false);
  });

  it("rejects malformed timestamps, ids and negative counters", () => {
    const created = asRecord(examples.get("RUN_CREATED"));
    expect(RunEventSchema.safeParse({ ...created, at: "2026-09-22 10:00" }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...created, runId: "run-1" }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...created, seq: -1 }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...created, seq: 1.5 }).success).toBe(false);
    const completed = asRecord(examples.get("RUN_COMPLETED"));
    expect(RunEventSchema.safeParse({ ...completed, costUsd: -0.01 }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...completed, usage: { inputTokens: 1 } }).success).toBe(
      false,
    );
  });
});
