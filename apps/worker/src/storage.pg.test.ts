import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readZip } from "@flowaid/codegen";
import { artifacts, jobs } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import { artifactStorageFrom, startFakeS3, type FakeS3 } from "@flowaid/storage";
import { createHarness, type Harness } from "./test/setup.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describeDb("artifacts in S3-compatible storage (Postgres)", () => {
  let h: Harness;
  let s3: FakeS3;
  let origin: Server;
  let url: string;
  let workflowId: string;
  let versionId: string;

  beforeAll(async () => {
    s3 = await startFakeS3();
    origin = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG);
    });
    await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(origin.address() as AddressInfo).port}/logo.png`;
    h = await createHarness({
      storage: artifactStorageFrom(
        {
          S3_ENDPOINT: s3.endpoint,
          S3_BUCKET: s3.bucket,
          S3_ACCESS_KEY: s3.accessKey,
          S3_SECRET_KEY: s3.secretKey,
          S3_REGION: s3.region,
          S3_FORCE_PATH_STYLE: true,
        },
        mkdtempSync(join(tmpdir(), "flowaid-artifacts-")),
      ),
    });
  });
  afterAll(async () => {
    await h.close();
    await s3.close();
    await new Promise((r) => origin.close(r));
  });

  it("puts node artifacts in the bucket, recorded as storage s3", async () => {
    ({ workflowId, versionId } = await h.deploy("Fetch logo", {
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: { status: { type: "integer" } } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "fetch",
          kind: "task",
          type: "flowaid.tools.http",
          typeVersion: "1.0.0",
          name: "Fetch",
          config: { method: "GET", url, responseType: "binary" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: {
              status: { kind: "ref", ref: { kind: "port", node: "fetch", port: "status" } },
            },
          },
        },
      ],
      edges: [{ id: "e1", from: { node: "start", port: "done" }, to: { node: "fetch" } }],
    }));
    const runId = await h.start(workflowId, versionId, {});
    await h.waitFor(runId, ["completed"]);
    const [a] = await h.db.app.system((tx) =>
      tx.select().from(artifacts).where(eq(artifacts.runId, runId)),
    );
    expect(a).toMatchObject({ storage: "s3", mimeType: "image/png", bytes: PNG.byteLength });
    const stored = s3.objects.get(a?.storageKey as string);
    expect(stored?.contentType).toBe("image/png");
    expect(Buffer.compare(stored?.body as Buffer, PNG)).toBe(0);
  });

  it("writes export packages to the bucket", async () => {
    const jobId = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(jobs).values({
        id: jobId,
        workspaceId: h.workspaceId,
        kind: "export.package",
        payload: { workflowId, versionId, mode: "npm" } as never,
        createdBy: "test",
      }),
    );
    await h.queue.enqueue("jobs", {
      type: "export.package",
      jobId,
      workspaceId: h.workspaceId,
      workflowId,
      versionId,
      mode: "npm",
      requestedBy: "test",
    });
    let job: typeof jobs.$inferSelect | undefined;
    for (let i = 0; i < 200 && job?.status !== "completed" && job?.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      [job] = await h.db.app.system((tx) => tx.select().from(jobs).where(eq(jobs.id, jobId)));
    }
    expect(job).toMatchObject({ status: "completed", error: null });
    const [a] = await h.db.app.system((tx) =>
      tx
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, job?.artifactId as string)),
    );
    expect(a).toMatchObject({ kind: "export", storage: "s3", mimeType: "application/zip" });
    const zip = readZip(s3.objects.get(a?.storageKey as string)?.body as Buffer);
    expect([...zip.keys()].some((k) => k.endsWith("/src/workflow.ts"))).toBe(true);
  });
});
