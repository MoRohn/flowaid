import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { humanTasks, runs } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const HOUR = 3_600_000;

describeDb("insights (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let workflowId: string;
  let quietId: string;
  let v2: string;

  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    const workspaceId = (await call(t.app, jar, "GET", "/v1/me")).json().principal
      .workspaceId as string;
    const env = (
      (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
    ).find((e) => e.name === "dev")?.id as string;
    const publish = async (id: string) =>
      (await call(t.app, jar, "POST", `/v1/workflows/${id}/publish`, {})).json().id as string;
    workflowId = (
      await call(t.app, jar, "POST", "/v1/workflows", { name: "Support triage" })
    ).json().id as string;
    const v1 = await publish(workflowId);
    const draft = (await call(t.app, jar, "GET", `/v1/workflows/${workflowId}`)).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${workflowId}/draft`,
      { definition: { ...draft.draft, description: "v2" } },
      { "if-match": String(draft.draftRevision) },
    );
    v2 = await publish(workflowId);
    quietId = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Quiet" })).json()
      .id as string;
    const quietVersion = await publish(quietId);

    const now = t.clock.now();
    const run = (
      wf: string,
      version: string,
      hoursAgo: number,
      failed: boolean,
      origin = "api",
    ) => {
      const at = new Date(now - hoursAgo * HOUR);
      return {
        id: uuidv7(),
        workspaceId,
        workflowId: wf,
        workflowVersionId: version,
        environmentId: env,
        status: (failed ? "failed" : "completed") as never,
        origin: origin as never,
        mode: "async" as never,
        input: {},
        costUsd: "0.01",
        usage: { inputTokens: 0, outputTokens: 0 },
        error: (failed ? { code: "E_UPSTREAM", message: "upstream refused" } : null) as never,
        createdAt: at,
        startedAt: at,
        endedAt: new Date(at.getTime() + 1000),
      };
    };
    const rows = [
      // baseline (the 4 days before the last 24 hours): 60 runs, 2 failures, a different code
      ...Array.from({ length: 60 }, (_, i) => ({
        ...run(workflowId, v1, 30 + i, i < 2),
        error: (i < 2 ? { code: "E_TIMEOUT", message: "timeout" } : null) as never,
      })),
      // recent: 40 runs on the new version, half failing with a new code
      ...Array.from({ length: 40 }, (_, i) => run(workflowId, v2, 1 + i * 0.5, i % 2 === 0)),
      // evaluation runs fail too, but are not production traffic
      ...Array.from({ length: 30 }, (_, i) =>
        run(quietId, quietVersion, 1 + i * 0.5, true, "evaluation"),
      ),
      ...Array.from({ length: 30 }, (_, i) => run(quietId, quietVersion, 30 + i, false)),
      ...Array.from({ length: 30 }, (_, i) => run(quietId, quietVersion, 1 + i * 0.5, false)),
    ];
    await t.db.app.system(async (tx) => {
      await tx.insert(runs).values(rows);
      await tx.insert(humanTasks).values({
        id: uuidv7(),
        workspaceId,
        runId: rows[60]?.id as string,
        nodeRunId: uuidv7(),
        nodeId: "approve",
        workflowId,
        request: { title: "Approve refund", mode: { type: "approval" } } as never,
        expiresAt: new Date(now + 2 * HOUR),
      });
    });
  });
  afterAll(() => t.close());

  it("reports open approvals, failing workflows and a significant regression with evidence", async () => {
    const res = await call(t.app, jar, "GET", "/v1/insights?window=24h");
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.attention.openApprovals).toMatchObject({ count: 1, expiringSoon: 1 });
    expect(r.attention.failingWorkflows).toEqual([
      { workflowId, workflowName: "Support triage", failed: 20, finished: 40 },
    ]);
    const failure = r.insights.find(
      (i: { kind: string; workflowId: string }) =>
        i.kind === "failure_rate" && i.workflowId === workflowId,
    );
    expect(failure).toMatchObject({
      severity: "critical",
      title: "Support triage fails more often since a new version",
      evidence: {
        test: "fisher_exact",
        recent: { value: 0.5, n: 40 },
        baseline: { n: 60 },
      },
      attribution: { versionId: v2, version: 2, share: 1 },
    });
    expect(failure.evidence.qValue).toBeLessThan(0.05);
    expect(
      r.insights.some((i: { id: string }) => i.id === `new_error:${workflowId}:E_UPSTREAM`),
    ).toBe(true);
    // evaluation failures of "Quiet" are not traffic
    expect(r.insights.some((i: { workflowId: string }) => i.workflowId === quietId)).toBe(false);
  });

  it("counts open approvals in the chosen environment only, like the runs", async () => {
    const envs = (await call(t.app, jar, "GET", "/v1/environments")).json() as {
      id: string;
      name: string;
    }[];
    const id = (name: string) => envs.find((e) => e.name === name)?.id as string;
    const approvals = async (env: string) =>
      (await call(t.app, jar, "GET", `/v1/insights?window=24h&environmentId=${env}`)).json()
        .attention.openApprovals.count as number;
    expect(await approvals(id("dev"))).toBe(1);
    const other = envs.find((e) => e.name !== "dev");
    expect(other).toBeDefined();
    expect(await approvals(other?.id as string)).toBe(0);
  });

  it("scopes to a workflow and to API keys pinned to workflows", async () => {
    const one = await call(t.app, jar, "GET", `/v1/insights?window=24h&workflowId=${quietId}`);
    expect(one.json().insights).toEqual([]);
    expect(one.json().attention.openApprovals.count).toBe(0);
    const key = (
      await call(t.app, jar, "POST", "/v1/api-keys", {
        name: "pinned",
        scopes: ["runs:read"],
        workflowIds: [quietId],
      })
    ).json().key as string;
    const pinned = await t.app.inject({
      method: "GET",
      url: "/v1/insights?window=24h",
      headers: { authorization: `Bearer ${key}` },
    });
    expect(pinned.statusCode).toBe(200);
    expect(pinned.json().attention.failingWorkflows).toEqual([]);
    expect(pinned.json().insights).toEqual([]);
  });

  it("counts only production traffic in metrics unless asked for every origin", async () => {
    const from = new Date(t.clock.now() - 24 * HOUR).toISOString();
    const to = new Date(t.clock.now()).toISOString();
    const q = `from=${from}&to=${to}&workflowId=${quietId}`;
    const prod = await call(t.app, jar, "GET", `/v1/metrics/overview?${q}`);
    expect(prod.json().runs.total).toBe(30);
    const all = await call(t.app, jar, "GET", `/v1/metrics/overview?${q}&origin=all`);
    expect(all.json().runs.total).toBe(60);
  });
});
