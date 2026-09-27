/**
 * `export.package` (CODE_EXPORT.md §4, RFC-0001): builds the "Download code" zip for a workflow
 * version (or a compiled draft the API put in the job's payload) and stores it as an artifact
 * (`kind='export'`, `workflow_id` set, expires in 24 h), then completes the `jobs` row. Reads only
 * persisted — already redacted — run data for the optional sample input and recorded run;
 * `buildExportBundle` scrubs it once more. Never reads environment variables or secret values.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { buildExportBundle, type RecordedRunInput } from "@flowaid/codegen";
import {
  PgRunStore,
  artifacts,
  jobs,
  runs,
  workflowVersions,
  workflows,
  type Database,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import type { ArtifactStorage } from "@flowaid/storage";
import { NotFoundError, toFlowaidError, type JsonValue, type Job } from "@flowaid/workflow-core";

export type ExportJob = Extract<Job, { type: "export.package" }>;

export interface ExportJobDeps {
  db: Database;
  /** where the zip goes (S3 or `<data>/artifacts`, shared with the API, which serves it) */
  storage: ArtifactStorage;
  /** FLOWAID_VENDOR_DIR: the packed runtime packages for vendored exports */
  vendorDir?: string | null;
  now?: () => number;
}

/** How long a download stays available. */
export const EXPORT_TTL_MS = 24 * 3600 * 1000;

async function readVendor(dir: string): Promise<{ name: string; data: Uint8Array }[]> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".tgz")).sort();
  return Promise.all(
    names.map(async (name) => ({ name, data: new Uint8Array(await readFile(join(dir, name))) })),
  );
}

/** Runs one export job; the `jobs` row records the outcome (the job never throws for a bad export). */
export async function runExportJob(deps: ExportJobDeps, job: ExportJob): Promise<void> {
  const now = deps.now ?? Date.now;
  const [claimed] = await deps.db.system((tx) =>
    tx
      .update(jobs)
      .set({ status: "running", startedAt: new Date(now()) })
      .where(and(eq(jobs.id, job.jobId), eq(jobs.status, "queued")))
      .returning(),
  );
  if (!claimed) return; // already taken or finished
  const ws = claimed.workspaceId;
  try {
    const payload = claimed.payload as {
      workflowId: string;
      versionId?: string | null;
      mode?: "npm" | "vendored";
      definition?: JsonValue;
      plan?: JsonValue;
      includeSampleFromRunId?: string;
      includeRecordedRunId?: string;
    };
    const mode = payload.mode ?? job.mode;
    const loaded = await deps.db.tenant(ws, async (tx) => {
      const [wf] = await tx
        .select({ id: workflows.id, slug: workflows.slug, name: workflows.name })
        .from(workflows)
        .where(and(eq(workflows.id, payload.workflowId), eq(workflows.workspaceId, ws)));
      if (!wf) throw new NotFoundError("workflow not found");
      let source: { definition: unknown; plan: unknown; version: number | "draft" };
      if (payload.versionId) {
        const [v] = await tx
          .select()
          .from(workflowVersions)
          .where(
            and(eq(workflowVersions.id, payload.versionId), eq(workflowVersions.workflowId, wf.id)),
          );
        if (!v) throw new NotFoundError("workflow version not found");
        source = {
          definition: v.definition,
          plan: v.plan,
          version: v.kind === "published" && v.version !== null ? v.version : "draft",
        };
      } else {
        if (!payload.definition || !payload.plan)
          throw new NotFoundError("the job carries no compiled draft");
        source = { definition: payload.definition, plan: payload.plan, version: "draft" };
      }
      const runOf = async (id: string | undefined) => {
        if (!id) return undefined;
        const [r] = await tx
          .select()
          .from(runs)
          .where(and(eq(runs.id, id), eq(runs.workflowId, wf.id), eq(runs.workspaceId, ws)));
        if (!r) throw new NotFoundError(`run ${id} not found for this workflow`);
        return r;
      };
      return {
        wf,
        source,
        sample: await runOf(payload.includeSampleFromRunId),
        recorded: await runOf(payload.includeRecordedRunId),
      };
    });

    let recordedRun: RecordedRunInput | undefined;
    if (loaded.recorded) {
      const nodeRuns = await new PgRunStore(deps.db).listNodeRuns(loaded.recorded.id);
      recordedRun = {
        input: loaded.recorded.input,
        status: loaded.recorded.status,
        outcome: loaded.recorded.outcome,
        output: loaded.recorded.output ?? null,
        nodeRuns,
      };
    }
    const bundle = await buildExportBundle({
      definition: loaded.source.definition,
      plan: loaded.source.plan,
      workflow: loaded.wf,
      version: loaded.source.version,
      mode,
      ...(mode === "vendored"
        ? { vendor: await readVendor(deps.vendorDir ?? "/opt/flowaid/vendor") }
        : {}),
      ...(loaded.sample ? { sampleInput: loaded.sample.input } : {}),
      ...(recordedRun ? { recordedRun } : {}),
    });
    const zip = bundle.toZip();

    const artifactId = uuidv7();
    const key = `ws/${ws}/${artifactId}`;
    await deps.storage.primary.put(key, zip, "application/zip");
    await deps.db.tenant(ws, async (tx) => {
      await tx.insert(artifacts).values({
        id: artifactId,
        workspaceId: ws,
        workflowId: loaded.wf.id,
        name: bundle.fileName,
        mimeType: "application/zip",
        bytes: zip.byteLength,
        sha256: createHash("sha256").update(zip).digest("hex"),
        storage: deps.storage.primary.kind,
        storageKey: key,
        kind: "export",
        dataClass: "internal",
        expiresAt: new Date(now() + EXPORT_TTL_MS),
      });
      await tx
        .update(jobs)
        .set({
          status: "completed",
          artifactId,
          endedAt: new Date(now()),
          expiresAt: new Date(now() + EXPORT_TTL_MS),
        })
        .where(eq(jobs.id, job.jobId));
    });
  } catch (error) {
    await deps.db.system((tx) =>
      tx
        .update(jobs)
        .set({ status: "failed", error: toFlowaidError(error).toInfo(), endedAt: new Date(now()) })
        .where(eq(jobs.id, job.jobId)),
    );
  }
}
