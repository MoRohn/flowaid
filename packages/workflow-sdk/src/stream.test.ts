import { describe, expect, expectTypeOf, it } from "vitest";
import type { DecisionResult, RunEvent } from "@flowaid/workflow-core";
import { Flowaid } from "./client.js";
import { FlowaidApiError, StreamDisconnectedError, StreamExpiredError } from "./errors.js";
import { backoffDelay } from "./stream.js";
import { apiError, end, fakeFetch, frame, noWait, sse } from "./test/fakeServer.js";

const RUN = "0190b5a4-0000-7000-8000-000000000001";
const base = { runId: RUN, at: "2026-09-27T12:00:00.000Z" };
const created = { ...base, type: "RUN_CREATED", seq: 1 };
const started = { ...base, type: "RUN_STARTED", seq: 2 };
const decision = {
  ...base,
  type: "DECISION_COMPLETED",
  seq: 3,
  nodeRunId: "nr-1",
  nodeId: "intent",
  scope: "",
  attempt: 1,
  batchId: "b1",
  question: "Which queue?",
  decision: { kind: "choice", value: "billing", confidence: 0.91 },
};
const delta = (text: string, index: number) => ({
  ...base,
  type: "GENERATION_DELTA",
  seq: 0,
  nodeRunId: "nr-2",
  nodeId: "draft",
  scope: "",
  attempt: 1,
  ephemeral: true,
  channel: "text",
  delta: text,
  index,
});
const completed = { ...base, type: "RUN_COMPLETED", seq: 4 };

const isStream = (url: URL) => url.pathname === `/v1/runs/${RUN}/stream`;

describe("RunHandle.stream", () => {
  it("resumes after a mid-stream disconnect with Last-Event-ID, without gaps or repeats", async () => {
    let connection = 0;
    const server = fakeFetch([
      (req) => {
        if (!isStream(req.url)) return undefined;
        connection += 1;
        if (connection === 1)
          return sse([`retry: 2000\n: connected\n\n`, frame(created), frame(started)], {
            drop: true,
          });
        return sse([frame(decision), frame(completed), end(RUN)]);
      },
    ]);
    const fa = new Flowaid({
      baseUrl: "http://api.test/",
      apiKey: "fa_test_x",
      fetch: server.fetch,
      streamRuntime: noWait,
    });
    const run = fa.run(RUN);
    const seen: RunEvent[] = [];
    for await (const ev of run.stream()) seen.push(ev);

    expect(seen.map((e) => e.type)).toEqual([
      "RUN_CREATED",
      "RUN_STARTED",
      "DECISION_COMPLETED",
      "RUN_COMPLETED",
    ]);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]?.headers["last-event-id"]).toBeUndefined();
    expect(server.requests[1]?.headers["last-event-id"]).toBe("2");
    expect(server.requests[0]?.headers.accept).toBe("text/event-stream");
    expect(server.requests[0]?.headers.authorization).toBe("Bearer fa_test_x");
    expect(server.requests[0]?.url.searchParams.get("include")).toBe("deltas");
    expect(run.lastEnd).toEqual({ run_id: RUN, final_status: "completed" });
  });

  it("narrows events on their type (DECISION_COMPLETED carries the decision)", async () => {
    const server = fakeFetch([
      (req) => (isStream(req.url) ? sse([frame(decision), end(RUN)]) : undefined),
    ]);
    const fa = new Flowaid({ baseUrl: "http://api.test", fetch: server.fetch });
    const confidences: number[] = [];
    for await (const ev of fa.run(RUN).stream({ types: ["DECISION_COMPLETED"] })) {
      if (ev.type === "DECISION_COMPLETED") {
        expectTypeOf(ev.decision).toEqualTypeOf<DecisionResult>();
        confidences.push(ev.decision.confidence);
      }
    }
    expect(confidences).toEqual([0.91]);
    expect(server.requests[0]?.url.searchParams.get("types")).toBe("DECISION_COMPLETED");
  });

  it("an expired Last-Event-ID is StreamExpiredError (re-read the run instead)", async () => {
    const server = fakeFetch([
      (req) => (isStream(req.url) ? apiError(404, "NOT_FOUND", { reason: "expired" }) : undefined),
    ]);
    const fa = new Flowaid({ baseUrl: "http://api.test", fetch: server.fetch });
    const it = fa.run(RUN).stream({ after: 40 })[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toBeInstanceOf(StreamExpiredError);
    expect(server.requests[0]?.headers["last-event-id"]).toBe("40");
  });

  it("gives up after 5 consecutive failures, backing off with full jitter", async () => {
    const delays: number[] = [];
    const server = fakeFetch([
      (req) => (isStream(req.url) ? apiError(503, "UNAVAILABLE") : undefined),
    ]);
    const fa = new Flowaid({
      baseUrl: "http://api.test",
      fetch: server.fetch,
      streamRuntime: {
        sleep: (ms) => (delays.push(ms), Promise.resolve()),
        random: () => 0.999,
      },
    });
    const error = await (async () => {
      try {
        for await (const _ of fa.run(RUN).stream()) void _;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(StreamDisconnectedError);
    expect((error as StreamDisconnectedError).attempts).toBe(5);
    expect(server.requests).toHaveLength(5);
    expect(delays).toEqual([999, 1998, 3996, 7992]);
  });

  it("a progressing connection resets the failure count", async () => {
    let n = 0;
    const server = fakeFetch([
      (req) => {
        if (!isStream(req.url)) return undefined;
        n += 1;
        // Every connection delivers one event and drops: six drops in a row still complete.
        if (n <= 6) return sse([frame({ ...base, type: "LOG_MARK", seq: n })], { drop: true });
        return sse([frame(completed), end(RUN)]);
      },
    ]);
    const fa = new Flowaid({
      baseUrl: "http://api.test",
      fetch: server.fetch,
      streamRuntime: noWait,
    });
    const types: string[] = [];
    for await (const ev of fa.run(RUN).stream()) types.push(ev.type);
    expect(types).toHaveLength(7);
    expect(server.requests.at(-1)?.headers["last-event-id"]).toBe("6");
  });

  it("does not retry client errors", async () => {
    const server = fakeFetch([
      (req) => (isStream(req.url) ? apiError(401, "UNAUTHORIZED") : undefined),
    ]);
    const fa = new Flowaid({
      baseUrl: "http://api.test",
      fetch: server.fetch,
      streamRuntime: noWait,
    });
    const it = fa.run(RUN).stream()[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toBeInstanceOf(FlowaidApiError);
    expect(server.requests).toHaveLength(1);
  });

  it("stops quietly when aborted", async () => {
    const controller = new AbortController();
    const server = fakeFetch([
      (req) =>
        isStream(req.url) ? sse([frame(created), frame(started)], { drop: true }) : undefined,
    ]);
    const fa = new Flowaid({
      baseUrl: "http://api.test",
      fetch: server.fetch,
      streamRuntime: noWait,
    });
    const seen: string[] = [];
    for await (const ev of fa.run(RUN).stream({ signal: controller.signal })) {
      seen.push(ev.type);
      controller.abort();
    }
    expect(seen).toEqual(["RUN_CREATED"]);
  });

  it("run.text folds a node's deltas and trims characters repeated after a reconnect", async () => {
    let n = 0;
    const server = fakeFetch([
      (req) => {
        if (!isStream(req.url)) return undefined;
        n += 1;
        if (n === 1) return sse([frame(delta("Hel", 0)), frame(delta("lo ", 3))], { drop: true });
        return sse([frame(delta("o world", 4)), frame(completed), end(RUN)]);
      },
    ]);
    const fa = new Flowaid({
      baseUrl: "http://api.test",
      fetch: server.fetch,
      streamRuntime: noWait,
    });
    let text = "";
    for await (const chunk of fa.run(RUN).text("draft")) text += chunk;
    expect(text).toBe("Hello world");
  });
});

describe("backoffDelay", () => {
  it("is full jitter over 1 s → 30 s", () => {
    expect(backoffDelay(1, () => 1)).toBe(1000);
    expect(backoffDelay(6, () => 1)).toBe(30_000);
    expect(backoffDelay(10, () => 0.5)).toBe(15_000);
    expect(backoffDelay(3, () => 0)).toBe(0);
  });
});
