import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildExportBundle, readZip } from "@flowaid/codegen";
import { artifacts, jobs, workflowVersions } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

/**
 * Stands in for the worker's `export.package` consumer (apps/worker/src/jobs/export.ts, tested
 * there): builds the bundle from the version, stores the zip as an export artifact, completes the job.
 */
async function startFakeExporter(t: TestApp, artifactsDir: string) {
  return t.ctx.queue.consume(
    "jobs",
    async (job) => {
      if (job.type !== "export.package" || !job.versionId) return;
      const [v] = await t.db.app.system((tx) =>
        tx
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.id, job.versionId as string)),
      );
      if (!v) return;
      const bundle = await buildExportBundle({
        definition: v.definition,
        plan: v.plan,
        workflow: { id: v.workflowId, slug: "exported", name: "Exported" },
        version: v.version ?? "draft",
        mode: job.mode,
      });
      const zip = bundle.toZip();
      const id = uuidv7();
      const key = `ws/${job.workspaceId}/${id}`;
      mkdirSync(dirname(join(artifactsDir, key)), { recursive: true });
      writeFileSync(join(artifactsDir, key), zip);
      await t.db.app.system(async (tx) => {
        await tx.insert(artifacts).values({
          id,
          workspaceId: job.workspaceId,
          workflowId: job.workflowId,
          name: bundle.fileName,
          mimeType: "application/zip",
          bytes: zip.byteLength,
          sha256: createHash("sha256").update(zip).digest("hex"),
          storage: "local",
          storageKey: key,
          kind: "export",
          expiresAt: new Date(t.clock.now() + 24 * 3600_000),
        });
        await tx
          .update(jobs)
          .set({ status: "completed", artifactId: id, endedAt: new Date() })
          .where(eq(jobs.id, job.jobId));
      });
    },
    { concurrency: 1 },
  );
}

describeDb("code export (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let workflowId: string;
  let versionId: string;
  let exporter: { stop(): Promise<void> };

  beforeAll(async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), "flowaid-api-artifacts-"));
    t = await createTestApp({ artifactsDir });
    jar = await login(t.app);
    workflowId = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Echo" })).json()
      .id as string;
    versionId = (await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, {})).json()
      .id as string;
    exporter = await startFakeExporter(t, artifactsDir);
  });
  afterAll(async () => {
    await exporter.stop();
    await t.close();
  });

  it("exports a version or the draft as typed code (format=ts)", async () => {
    const version = await call(
      t.app,
      jar,
      "GET",
      `/v1/workflow-versions/${versionId}/export?format=ts`,
    );
    expect(version.statusCode).toBe(200);
    expect(version.headers["content-disposition"]).toBe('attachment; filename="workflow-v1.ts"');
    expect(version.body).toContain('from "@flowaid/workflow-sdk"');
    expect(version.body).toContain("defineWorkflow(");
    const draft = await call(
      t.app,
      jar,
      "GET",
      `/v1/workflows/${workflowId}/draft/export?format=ts`,
    );
    expect(draft.statusCode).toBe(200);
    expect(draft.body).toContain(`id: "${workflowId}"`);
  });

  it("202 → job completed → zip download (attachment), audited", async () => {
    const accepted = await call(
      t.app,
      jar,
      "POST",
      `/v1/workflow-versions/${versionId}/export/package`,
      {},
    );
    expect(accepted.statusCode).toBe(202);
    const jobId = accepted.json().job_id as string;
    let job: { status: string; artifact_id?: string } = { status: "queued" };
    for (let i = 0; i < 100 && job.status !== "completed"; i++) {
      job = (await call(t.app, jar, "GET", `/v1/jobs/${jobId}`)).json();
      if (job.status !== "completed") await new Promise((r) => setTimeout(r, 50));
    }
    expect(job).toMatchObject({ status: "completed", artifact_id: expect.any(String) });

    const download = await call(
      t.app,
      jar,
      "GET",
      `/v1/artifacts/${job.artifact_id as string}/download`,
    );
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toBe(
      'attachment; filename="flowaid-exported-v1.zip"',
    );
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    const zip = readZip(download.rawPayload);
    expect([...zip.keys()]).toContain("flowaid-exported-v1/src/workflow.ts");

    const audit = (await call(t.app, jar, "GET", "/v1/audit?action=workflow.exported")).json();
    expect(audit.items[0]).toMatchObject({
      resourceId: workflowId,
      details: { versionId, mode: "npm", jobId },
    });

    // A key without workflows:read cannot download the export; after 24 h it is gone.
    const key = (
      await call(t.app, jar, "POST", "/v1/api-keys", { name: "runs-only", scopes: ["runs:read"] })
    ).json().key as string;
    const byKey = await t.app.inject({
      method: "GET",
      url: `/v1/artifacts/${job.artifact_id as string}/download`,
      headers: { authorization: `Bearer ${key}` },
    });
    expect(byKey.statusCode).toBe(403);
    await t.db.app.system((tx) =>
      tx
        .update(artifacts)
        .set({ expiresAt: new Date(t.clock.now() - 1) })
        .where(eq(artifacts.id, job.artifact_id as string)),
    );
    expect(
      (await call(t.app, jar, "GET", `/v1/artifacts/${job.artifact_id as string}/download`))
        .statusCode,
    ).toBe(404);
  });

  it("the draft twin compiles first and carries the compiled plan to the job", async () => {
    const accepted = await call(
      t.app,
      jar,
      "POST",
      `/v1/workflows/${workflowId}/draft/export/package`,
      {},
    );
    expect(accepted.statusCode).toBe(202);
    const [row] = await t.db.app.system((tx) =>
      tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, accepted.json().job_id as string)),
    );
    expect(row?.payload).toMatchObject({
      workflowId,
      versionId: null,
      mode: "npm",
      draftRevision: expect.any(Number),
      plan: { workflowId },
    });
  });

  it("rejects vendored exports without the vendored runtime, and runs of other workflows", async () => {
    const vendored = await call(
      t.app,
      jar,
      "POST",
      `/v1/workflow-versions/${versionId}/export/package`,
      {
        mode: "vendored",
      },
    );
    expect(vendored.statusCode).toBe(400);
    const foreign = await call(
      t.app,
      jar,
      "POST",
      `/v1/workflow-versions/${versionId}/export/package`,
      {
        includeSampleFromRunId: uuidv7(),
      },
    );
    expect(foreign.statusCode).toBe(404);
    expect((await call(t.app, jar, "GET", `/v1/jobs/${uuidv7()}`)).statusCode).toBe(404);
    const me = (await call(t.app, jar, "GET", "/v1/me")).json();
    expect(me.features.code_export).toBe(true);
  });
});
