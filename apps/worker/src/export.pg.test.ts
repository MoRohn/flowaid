import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readZip } from "@flowaid/codegen";
import { artifacts, jobs } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import { EXPORT_TTL_MS } from "./jobs/export.js";
import { createHarness, type Harness } from "./test/setup.js";

describeDb("export.package job (Postgres)", () => {
  let h: Harness;
  let workflowId: string;
  let versionId: string;
  let runId: string;

  beforeAll(async () => {
    h = await createHarness();
    ({ workflowId, versionId } = await h.deploy("Greeter", {
      inputs: {
        type: "object",
        properties: { name: { type: "string", "x-dataClass": "pii" }, lang: { type: "string" } },
        required: ["name"],
      },
      outputs: { type: "object", properties: { greeting: { type: "string" } } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "greet",
          kind: "task",
          type: "flowaid.data.template",
          typeVersion: "1.0.0",
          name: "Greet",
          config: { template: "Hello {{ start.name }}" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: {
              greeting: { kind: "ref", ref: { kind: "port", node: "greet", port: "text" } },
            },
          },
        },
      ],
    }));
    runId = await h.start(workflowId, versionId, { name: "Ada Lovelace", lang: "en" });
    await h.waitFor(runId, ["completed"]);
  });
  afterAll(() => h.close());

  async function exportJob(payload: Record<string, unknown>) {
    const jobId = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(jobs).values({
        id: jobId,
        workspaceId: h.workspaceId,
        kind: "export.package",
        payload: { workflowId, mode: "npm", ...payload } as never,
        createdBy: "test",
      }),
    );
    await h.queue.enqueue("jobs", {
      type: "export.package",
      jobId,
      workspaceId: h.workspaceId,
      workflowId,
      versionId: (payload.versionId as string | null | undefined) ?? null,
      mode: "npm",
      requestedBy: "test",
    });
    for (let i = 0; i < 200; i++) {
      const [row] = await h.db.app.system((tx) => tx.select().from(jobs).where(eq(jobs.id, jobId)));
      if (row && (row.status === "completed" || row.status === "failed")) return row;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("export job did not finish");
  }

  describe("from the jobs queue", () => {
    it("builds the zip as an export artifact that expires in 24 h and completes the job", async () => {
      const job = await exportJob({
        versionId,
        includeSampleFromRunId: runId,
        includeRecordedRunId: runId,
      });
      expect(job).toMatchObject({ status: "completed", error: null });
      const [a] = await h.db.app.system((tx) =>
        tx
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, job.artifactId as string)),
      );
      expect(a).toMatchObject({
        kind: "export",
        workflowId,
        runId: null,
        mimeType: "application/zip",
        storage: "local",
      });
      expect(a?.name).toMatch(/^flowaid-wf-[0-9a-f]{8}-v1\.zip$/);
      const ttl = (a?.expiresAt?.getTime() ?? 0) - (a?.createdAt.getTime() ?? 0);
      expect(Math.abs(ttl - EXPORT_TTL_MS)).toBeLessThan(60_000);

      const zip = readZip(readFileSync(join(h.artifactsDir, a?.storageKey as string)));
      const root = (a?.name as string).replace(/\.zip$/, "");
      const file = (path: string) => new TextDecoder().decode(zip.get(`${root}/${path}`));
      expect(file("src/workflow.ts")).toContain("defineWorkflow(");
      expect(JSON.parse(file("workflow.plan.json"))).toMatchObject({ workflowId });
      // The sample input and the recorded run carry placeholders for personal data only.
      expect(JSON.parse(file("inputs/example.json"))).toEqual({ name: "[redacted]", lang: "en" });
      const recorded = file("tests/recorded-run.json");
      expect(recorded).not.toContain("Lovelace");
      expect(JSON.parse(recorded)).toMatchObject({ status: "completed", exact: false });
      expect(file("README.md")).toContain("`inputs/example.json#/name` (pii)");
    });

    it("fails the job (not the worker) when the version does not exist", async () => {
      const job = await exportJob({ versionId: uuidv7() });
      expect(job.status).toBe("failed");
      expect(job.error).toMatchObject({ code: "NOT_FOUND" });
      expect(job.artifactId).toBeNull();
    });

    it("rejects runs of another workflow", async () => {
      const job = await exportJob({ versionId, includeSampleFromRunId: uuidv7() });
      expect(job.status).toBe("failed");
      expect(job.error).toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
