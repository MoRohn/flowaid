/** Worker test harness: a migrated database, a tenant with a compiled workflow version, and a worker. */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialService, KeyRing, envMasterKey } from "@flowaid/credentials";
import {
  PgCredentialRepository,
  PgEventBus,
  PgKekStore,
  PgQueueDriver,
  PgRunStore,
  createUser,
  createWorkspace,
  environments,
  runs,
  workflowDeployments,
  workflowVersions,
  workflows,
  type RunReplaySpec,
} from "@flowaid/database";
import { createTestDatabase, type TestDatabase } from "@flowaid/database/testing";
import { coreManifests } from "@flowaid/nodes-core/manifest";
import { DefaultModelCatalog, ProviderRegistry, booleanDecision } from "@flowaid/providers";
import { uuidv7 } from "@flowaid/shared";
import { compile } from "@flowaid/workflow-compiler";
import {
  WORKFLOW_SCHEMA_URI,
  definitionHash,
  type DecisionProvider,
  type JsonValue,
  type NodeCatalog,
  type Run,
} from "@flowaid/workflow-core";
import { and, eq } from "drizzle-orm";
import { createWorker, type Worker } from "../worker.js";

export const catalog: NodeCatalog = {
  get: (id) => coreManifests.find((m) => m.id === id),
  list: () => [...coreManifests],
};

export function fakeTypesafeRegistry(pYes = 0.93): ProviderRegistry {
  const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
  const meta = { provider: "typesafe", model: "jev-test", latencyMs: 7, costUsd: 0.00002 };
  const provider = {
    id: "typesafe",
    model: "jev-test",
    capabilities: {
      batch: false,
      maxQuestions: 1,
      maxStateTokens: 100_000,
      kinds: ["boolean", "choice", "score"],
      text: true,
      images: false,
    },
    decideBoolean: () => Promise.resolve(booleanDecision(pYes, meta)),
    decideChoice: () => Promise.reject(new Error("not used")),
    decideScore: () => Promise.reject(new Error("not used")),
    batch: () => Promise.reject(new Error("not used")),
    health: () => ({
      status: "healthy",
      errorRate1m: 0,
      p95LatencyMs: 0,
      consecutiveFailures: 0,
      checkedAt: new Date().toISOString(),
    }),
  } as unknown as DecisionProvider;
  registry.register({ id: "typesafe", kind: "decision", create: () => provider } as never);
  return registry;
}

export interface Harness {
  db: TestDatabase;
  worker: Worker;
  store: PgRunStore;
  queue: PgQueueDriver;
  workspaceId: string;
  environmentId: string;
  /** where the worker writes artifacts (and export zips) */
  artifactsDir: string;
  deploy(
    name: string,
    definition: Record<string, unknown>,
  ): Promise<{ workflowId: string; versionId: string }>;
  start(
    workflowId: string,
    versionId: string,
    input: JsonValue,
    extra?: Partial<Run>,
    /** set on the row before the start job: a recorded replay (§5.9) and run variables */
    row?: { replay?: RunReplaySpec; variables?: Record<string, JsonValue> },
  ): Promise<string>;
  waitFor(runId: string, statuses: Run["status"][], timeoutMs?: number): Promise<Run>;
  close(): Promise<void>;
}

export async function createHarness(o: { registry?: ProviderRegistry } = {}): Promise<Harness> {
  const db = await createTestDatabase();
  const credentials = new CredentialService({
    repository: new PgCredentialRepository(db.app),
    keyring: new KeyRing(envMasterKey(randomBytes(32).toString("base64")), new PgKekStore(db.app)),
  });
  const queue = new PgQueueDriver(db.app.sql, { pollMs: 25 });
  const bus = new PgEventBus(db.app.sql);
  const { workspaceId, environmentId } = await db.app.system(async (tx) => {
    const owner = await createUser(tx, {
      email: `owner-${uuidv7()}@example.com`,
      name: "Owner",
      status: "active",
    });
    const { workspace } = await createWorkspace(tx, {
      slug: `ws-${randomBytes(3).toString("hex")}`,
      name: "WS",
      ownerUserId: owner.id,
    });
    const [dev] = await tx
      .select()
      .from(environments)
      .where(and(eq(environments.workspaceId, workspace.id), eq(environments.name, "dev")));
    return { workspaceId: workspace.id, environmentId: dev?.id as string };
  });
  const artifactsDir = mkdtempSync(join(tmpdir(), "flowaid-artifacts-"));
  const worker = createWorker({
    db: db.app,
    queue,
    bus,
    credentials,
    http: (url, init) => fetch(url, init),
    artifactsDir,
    registry: o.registry ?? fakeTypesafeRegistry(),
    maintenance: { timerPollMs: 100 },
  });
  await worker.start();
  const store = new PgRunStore(db.app);

  return {
    db,
    worker,
    store,
    queue,
    workspaceId,
    environmentId,
    artifactsDir,
    async deploy(name, body) {
      const workflowId = uuidv7();
      const definition = { $schema: WORKFLOW_SCHEMA_URI, id: workflowId, name, ...body };
      const result = compile(definition, { catalog, level: "publish" });
      if (!result.ok)
        throw new Error(
          `does not compile: ${JSON.stringify(result.diagnostics.filter((d) => d.severity === "error"))}`,
        );
      const versionId = uuidv7();
      await db.app.system(async (tx) => {
        await tx.insert(workflows).values({
          id: workflowId,
          workspaceId,
          name,
          slug: `wf-${workflowId.slice(-8)}`,
          draft: definition as never,
        });
        await tx.insert(workflowVersions).values({
          id: versionId,
          workspaceId,
          workflowId,
          kind: "published",
          version: 1,
          definition: definition as never,
          definitionHash: definitionHash(definition),
          plan: result.plan,
          planHash: result.plan.planHash,
          compilerVersion: result.plan.compilerVersion,
          catalogSnapshot: {},
        });
        await tx
          .insert(workflowDeployments)
          .values({ id: uuidv7(), workspaceId, workflowId, environmentId, versionId });
      });
      return { workflowId, versionId };
    },
    async start(workflowId, versionId, input, extra = {}, row = {}) {
      const id = uuidv7();
      const now = new Date().toISOString();
      const [v] = await db.app.system((tx) =>
        tx
          .select({ planHash: workflowVersions.planHash })
          .from(workflowVersions)
          .where(eq(workflowVersions.id, versionId)),
      );
      const run: Run = {
        id,
        workspaceId,
        workflowId,
        workflowVersionId: versionId,
        environmentId,
        status: "queued",
        origin: "api",
        mode: "async",
        input,
        output: null,
        outcome: null,
        error: null,
        parentRunId: null,
        parentNodeRunId: null,
        sourceRunId: null,
        sessionId: null,
        idempotencyKey: null,
        labels: {},
        lastSeq: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        nodeRunCount: 0,
        createdAt: now,
        startedAt: null,
        endedAt: null,
        ...extra,
      };
      await store.createRun(run, {
        type: "RUN_CREATED",
        runId: id,
        seq: 1,
        at: now,
        workflowVersionId: versionId,
        environmentId,
        origin: run.origin,
        mode: "async",
        input,
        planHash: v?.planHash ?? "",
        idempotencyKey: null,
        sourceRunId: run.sourceRunId,
      });
      if (row.replay || row.variables)
        await db.app.system((tx) =>
          tx
            .update(runs)
            .set({
              ...(row.replay ? { replay: row.replay } : {}),
              ...(row.variables ? { variables: row.variables } : {}),
            })
            .where(eq(runs.id, id)),
        );
      await queue.enqueue("run:general", { type: "run.start", runId: id });
      return id;
    },
    async waitFor(runId, statuses, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const run = await store.getRun(runId);
        if (run && statuses.includes(run.status)) return run;
        if (Date.now() > deadline)
          throw new Error(
            `run ${runId} is ${run?.status}; expected ${statuses.join("/")}: ${JSON.stringify(run?.error)}`,
          );
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    async close() {
      await worker.stop();
      await queue.close();
      await db.drop();
    },
  };
}
