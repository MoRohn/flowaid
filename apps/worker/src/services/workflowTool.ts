/**
 * Workflows as tools (`ToolSource.kind === "workflow"`, agent-as-tool): a call starts a child run
 * of the workflow's version deployed to the caller's environment, with the tool arguments as its
 * input, and waits for it to end. The child is an ordinary run (origin `subflow`, labelled with the
 * calling run and node run), so it shows up in Runs with its own trace; a child waiting for a
 * person is reported back to the caller as not finished rather than blocking the agent.
 */
import { and, eq } from "drizzle-orm";
import {
  PgRunStore,
  workflowDeployments,
  workflowVersions,
  type Database,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  NotFoundError,
  type JsonValue,
  type QueueDriver,
  type Run,
  type ToolResult,
} from "@flowaid/workflow-core";

const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out"]);

export interface WorkflowToolDeps {
  db: Database;
  queue: QueueDriver;
  /** how often the caller checks the child run */
  pollMs?: number;
}

export interface WorkflowToolCall {
  workspaceId: string;
  environmentId: string;
  parentRunId: string;
  parentNodeRunId: string;
  sessionId: string | null;
  signal: AbortSignal;
}

export async function callWorkflowTool(
  deps: WorkflowToolDeps,
  caller: WorkflowToolCall,
  workflowId: string,
  args: JsonValue,
  timeoutMs = 120_000,
): Promise<ToolResult> {
  const started = Date.now();
  const store = new PgRunStore(deps.db);
  const [d] = await deps.db.system((tx) =>
    tx
      .select({ versionId: workflowDeployments.versionId, planHash: workflowVersions.planHash })
      .from(workflowDeployments)
      .innerJoin(workflowVersions, eq(workflowVersions.id, workflowDeployments.versionId))
      .where(
        and(
          eq(workflowDeployments.workflowId, workflowId),
          eq(workflowDeployments.environmentId, caller.environmentId),
          eq(workflowDeployments.workspaceId, caller.workspaceId),
          eq(workflowDeployments.active, true),
        ),
      ),
  );
  if (!d) throw new NotFoundError(`workflow ${workflowId} is not deployed to this environment`);
  const now = new Date().toISOString();
  const child: Run = {
    id: uuidv7(),
    workspaceId: caller.workspaceId,
    workflowId,
    workflowVersionId: d.versionId,
    environmentId: caller.environmentId,
    status: "queued",
    origin: "subflow",
    mode: "async",
    input: args,
    output: null,
    outcome: null,
    error: null,
    // linked by labels, not parentRunId: the caller is not a subflow node waiting for completion
    parentRunId: null,
    parentNodeRunId: null,
    sourceRunId: null,
    sessionId: caller.sessionId,
    idempotencyKey: null,
    labels: {
      "tool.caller_run": caller.parentRunId,
      "tool.caller_node_run": caller.parentNodeRunId,
    },
    lastSeq: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    nodeRunCount: 0,
    createdAt: now,
    startedAt: null,
    endedAt: null,
  };
  await store.createRun(child, {
    type: "RUN_CREATED",
    runId: child.id,
    seq: 1,
    at: now,
    workflowVersionId: d.versionId,
    environmentId: caller.environmentId,
    origin: "subflow",
    mode: "async",
    input: args,
    planHash: d.planHash,
    idempotencyKey: null,
    sourceRunId: null,
  });
  await deps.queue.enqueue(
    "run:general",
    { type: "run.start", runId: child.id },
    { jobId: `run.start:${child.id}` },
  );

  const deadline = started + timeoutMs;
  for (;;) {
    const run = await store.getRun(child.id);
    if (run && TERMINAL.has(run.status)) {
      const latencyMs = Date.now() - started;
      if (run.status === "completed")
        return {
          ok: true,
          content: typeof run.output === "string" ? run.output : JSON.stringify(run.output),
          structured: run.output,
          usage: run.usage,
          latencyMs,
        };
      return {
        ok: false,
        content: `The workflow run ${run.status}`,
        error: run.error ?? {
          code: "NODE_EXECUTION_ERROR",
          message: `The workflow run ${run.status}`,
          retryable: false,
        },
        latencyMs,
      };
    }
    if (run?.status === "waiting_for_human")
      return {
        ok: false,
        content: `The workflow run ${child.id} is waiting for a person; it will finish on its own.`,
        latencyMs: Date.now() - started,
      };
    if (caller.signal.aborted || Date.now() > deadline)
      return {
        ok: false,
        content: `The workflow run ${child.id} did not finish in ${timeoutMs} ms.`,
        error: { code: "TIMEOUT_ERROR", message: "workflow tool timed out", retryable: true },
        latencyMs: Date.now() - started,
      };
    await new Promise((r) => setTimeout(r, deps.pollMs ?? 200));
  }
}
