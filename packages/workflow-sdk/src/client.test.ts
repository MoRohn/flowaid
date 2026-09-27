import { describe, expect, expectTypeOf, it } from "vitest";
import { Flowaid } from "./client.js";
import { FlowaidApiError } from "./errors.js";
import { fillPath } from "./api.js";
import { apiError, end, fakeFetch, frame, json, noWait, sse } from "./test/fakeServer.js";

const WF = "0190b5a4-0000-7000-8000-00000000000a";
const RUN = "0190b5a4-0000-7000-8000-000000000001";
const runRecord = (status: string) => ({
  id: RUN,
  workflowId: WF,
  status,
  lastSeq: 3,
  output: status === "completed" ? { answer: 42 } : null,
});

describe("Flowaid client", () => {
  it("sends auth, the CSRF header and the workspace on every call", async () => {
    const server = fakeFetch([() => json(200, { items: [], next_cursor: null })]);
    const fa = new Flowaid({
      baseUrl: "http://api.test/v1",
      apiKey: "fa_live_k",
      workspace: "acme",
      fetch: server.fetch,
    });
    await fa.workflows.list({ q: "triage" });
    const [req] = server.requests;
    expect(req?.url.href).toBe("http://api.test/v1/workflows?q=triage");
    expect(req?.headers).toMatchObject({
      authorization: "Bearer fa_live_k",
      "x-requested-with": "flowaid",
      "x-workspace": "acme",
    });
  });

  it("maps the error envelope to FlowaidApiError", async () => {
    const server = fakeFetch([() => apiError(409, "CONFLICT", { field: "slug" })]);
    const fa = new Flowaid({ baseUrl: "http://api.test", fetch: server.fetch });
    const error = await fa.workflows.get(WF).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlowaidApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "CONFLICT",
      retryable: false,
      requestId: "req-1",
      details: { field: "slug" },
    });
  });

  it("starts runs (async and sync, with an idempotency key) and waits for them", async () => {
    let polls = 0;
    const server = fakeFetch([
      (req) =>
        req.method === "POST" && req.url.pathname === `/v1/workflows/${WF}/run`
          ? json((req.body as { mode?: string }).mode === "sync" ? 200 : 202, {
              run_id: RUN,
              status: (req.body as { mode?: string }).mode === "sync" ? "completed" : "queued",
              links: { self: "", stream: "", output: "" },
            })
          : undefined,
      (req) =>
        req.url.pathname === `/v1/runs/${RUN}`
          ? json(200, runRecord(polls++ === 0 ? "running" : "completed"))
          : undefined,
      (req) =>
        req.url.pathname === `/v1/runs/${RUN}/stream`
          ? sse([frame({ type: "RUN_COMPLETED", runId: RUN, seq: 4 }), end(RUN)])
          : undefined,
    ]);
    const fa = new Flowaid({
      baseUrl: "http://api.test",
      fetch: server.fetch,
      streamRuntime: noWait,
    });

    const run = await fa.workflows.run(WF, { message: "hi" }, { idempotencyKey: "k-1" });
    expect(run.id).toBe(RUN);
    expect(server.requests[0]?.body).toEqual({ input: { message: "hi" } });
    expect(server.requests[0]?.headers["idempotency-key"]).toBe("k-1");
    const done = await run.wait();
    expect(done.status).toBe("completed");
    const stream = server.requests.find((r) => r.url.pathname.endsWith("/stream"));
    expect(stream?.headers["last-event-id"]).toBe("3");
    expect(stream?.url.searchParams.get("types")).toContain("RUN_COMPLETED");
    expect(stream?.url.searchParams.get("include")).toBe("none");

    const sync = await fa.workflows.run(WF, {}, { mode: "sync", waitTimeoutMs: 5000 });
    expect(sync.initialStatus).toBe("completed");
    expect((await sync.wait()).output).toEqual({ answer: 42 });
  });

  it("responds to human tasks and emits events", async () => {
    const server = fakeFetch([
      (req) =>
        req.url.pathname.endsWith("/respond")
          ? json(202, { run_id: RUN, status: "running" })
          : undefined,
      (req) =>
        req.url.pathname.startsWith("/v1/events/")
          ? json(202, { started: [], delivered: [RUN] })
          : undefined,
    ]);
    const fa = new Flowaid({ baseUrl: "http://api.test", fetch: server.fetch });
    const answered = await fa.humanTasks.respond("t-1", { action: "approve", comment: "ok" });
    expectTypeOf(answered).toEqualTypeOf<{ run_id: string; status: string }>();
    expect(server.requests[0]?.url.pathname).toBe("/v1/human-tasks/t-1/respond");
    expect(server.requests[0]?.body).toEqual({ response: { action: "approve", comment: "ok" } });

    const emitted = await fa.events.emit("order.paid", { id: 7 }, "order-7");
    expect(emitted.delivered).toEqual([RUN]);
    expect(server.requests[1]?.url.pathname).toBe("/v1/events/order.paid");
    expect(server.requests[1]?.body).toEqual({ payload: { id: 7 }, correlationKey: "order-7" });
  });

  it("types every operation through fa.api", async () => {
    const server = fakeFetch([() => json(200, { items: [], next_cursor: null })]);
    const fa = new Flowaid({ baseUrl: "http://api.test", fetch: server.fetch });
    const page = await fa.api.get("/v1/runs/{id}/events", {
      path: { id: RUN },
      query: { after: 5, limit: 10 },
    });
    expectTypeOf(page).not.toBeAny();
    expect(server.requests[0]?.url.href).toBe(
      `http://api.test/v1/runs/${RUN}/events?after=5&limit=10`,
    );
    // @ts-expect-error — the path template has a parameter, so `path` is required
    await expect(fa.api.get("/v1/runs/{id}", {})).rejects.toThrow(/missing path parameter 'id'/);
  });

  it("downloads a code package: version number → version id, job polling, artifact bytes", async () => {
    let polls = 0;
    const server = fakeFetch([
      (req) =>
        req.url.pathname === `/v1/workflows/${WF}/versions`
          ? json(200, [
              { id: "v-2", version: 2 },
              { id: "v-1", version: 1 },
            ])
          : undefined,
      (req) =>
        req.url.pathname === "/v1/workflow-versions/v-1/export/package"
          ? json(202, { job_id: "job-1" })
          : undefined,
      (req) =>
        req.url.pathname === "/v1/jobs/job-1"
          ? json(
              200,
              polls++ < 2
                ? { id: "job-1", status: "running" }
                : { id: "job-1", status: "completed", artifact_id: "art-1" },
            )
          : undefined,
      (req) =>
        req.url.pathname === "/v1/artifacts/art-1/download"
          ? new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200 })
          : undefined,
    ]);
    const fa = new Flowaid({
      baseUrl: "http://api.test",
      fetch: server.fetch,
      streamRuntime: noWait,
    });
    const zip = await fa.workflows.exportPackage(WF, { version: 1, mode: "vendored" });
    expect([...zip]).toEqual([0x50, 0x4b, 3, 4]);
    expect(server.requests[1]?.body).toEqual({ mode: "vendored" });
    expect(polls).toBe(3);

    const draft = fakeFetch([() => apiError(422, "COMPILE_ERROR")]);
    await expect(
      new Flowaid({ baseUrl: "http://api.test", fetch: draft.fetch }).workflows.exportPackage(WF, {
        version: "draft",
      }),
    ).rejects.toMatchObject({ code: "COMPILE_ERROR" });
    expect(draft.requests[0]?.url.pathname).toBe(`/v1/workflows/${WF}/draft/export/package`);
  });

  it("streams evaluation progress until the evaluation ends", async () => {
    const states = [
      { status: "running", completed: 0, total: 2 },
      { status: "running", completed: 0, total: 2 },
      { status: "running", completed: 1, total: 2 },
      { status: "completed", completed: 2, total: 2 },
    ];
    const server = fakeFetch([() => json(200, { id: "e-1", ...states.shift() })]);
    const fa = new Flowaid({
      baseUrl: "http://api.test",
      fetch: server.fetch,
      streamRuntime: noWait,
    });
    const seen: string[] = [];
    for await (const e of fa.evaluations.runs.stream("e-1"))
      seen.push(`${e.status} ${e.completed}`);
    expect(seen).toEqual(["running 0", "running 1", "completed 2"]);
  });

  it("fills path templates with encoded values", () => {
    expect(fillPath("/v1/nodes/{typeId}", { typeId: "@community/slack.post" })).toBe(
      "/v1/nodes/%40community%2Fslack.post",
    );
    expect(() => fillPath("/v1/runs/{id}", {})).toThrow(TypeError);
  });

  it("replays, restarts, forks and retries nodes, handing back the run to follow", async () => {
    const NEW = "0190b5a4-0000-7000-8000-000000000002";
    const NODE_RUN = "0190b5a4-0000-7000-8000-000000000003";
    const server = fakeFetch([
      (req) =>
        req.url.pathname === `/v1/runs/${RUN}/node-runs/${NODE_RUN}/retry`
          ? json(202, { run_id: RUN, status: "retrying" })
          : json(202, { run_id: NEW }),
    ]);
    const fa = new Flowaid({ baseUrl: "http://api.test", fetch: server.fetch });
    expect((await fa.runs.replay(RUN, { mode: "recorded" })).id).toBe(NEW);
    expect((await fa.runs.restart(RUN, { nodeId: "draft", input: { prompt: "x" } })).id).toBe(NEW);
    expect((await fa.runs.fork(RUN, { draft: true, input: { message: "y" } })).id).toBe(NEW);
    expect((await fa.runs.retryNode(RUN, NODE_RUN)).id).toBe(RUN);
    expect(server.requests.map((r) => [r.method, r.url.pathname, r.body])).toEqual([
      ["POST", `/v1/runs/${RUN}/replay`, { mode: "recorded" }],
      ["POST", `/v1/runs/${RUN}/restart`, { nodeId: "draft", input: { prompt: "x" } }],
      ["POST", `/v1/runs/${RUN}/fork`, { draft: true, input: { message: "y" } }],
      ["POST", `/v1/runs/${RUN}/node-runs/${NODE_RUN}/retry`, undefined],
    ]);
  });
});
