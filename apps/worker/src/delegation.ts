/**
 * Delegated worker pools (ARCHITECTURE.md §10.7). The orchestrating worker hands a node of a
 * pool it does not serve (the `code` pool of compose's `worker-code`) to that pool:
 *
 * 1. `delegateNode` writes the call (a JSON `ExecutionCall` with the node's input and resolved
 *    config) to `delegated_nodes` and enqueues `node.exec` on `run:<pool>`;
 * 2. the pool's worker claims it with `flowaid_delegated_claim` (a SECURITY DEFINER function:
 *    the sandbox host's `flowaid_code` role has no table access), executes it with its own
 *    registry and services, stores the outcome with `flowaid_delegated_complete` and enqueues
 *    `run.signal{delegated_result}` on `run:general`;
 * 3. the orchestrating worker reads the outcome back (`takeDelegatedResult`) and hands it to the
 *    run as a `delegated_result` trigger.
 *
 * A claim older than the stale window is claimable again, so a job redelivered after its worker
 * died re-executes; the queue's own retries cover a lost signal.
 */
import { eq } from "drizzle-orm";
import { delegatedNodes, type Database } from "@flowaid/database";
import type { JsonObject, Job, QueueDriver, WorkerPool } from "@flowaid/workflow-core";
import {
  executeDelegated,
  type DelegatedNode,
  type ExecutorOutcome,
  type NodeRegistry,
  type NodeServices,
} from "@flowaid/workflow-runtime";
import type { WorkerLogger } from "./worker.js";

/** The orchestrator's `delegate` hook. */
export function delegateNode(db: Database, queue: QueueDriver) {
  return async (node: DelegatedNode): Promise<void> => {
    await db.system((tx) =>
      tx
        .insert(delegatedNodes)
        .values({
          nodeRunId: node.nodeRunId,
          workspaceId: node.workspaceId,
          runId: node.runId,
          pool: node.pool,
          call: {
            call: node.call,
            input: node.input,
            config: node.config,
          } as unknown as JsonObject,
        })
        // a retried effect (lease takeover) keeps the first call and its claim
        .onConflictDoNothing(),
    );
    await queue.enqueue(
      `run:${node.pool}`,
      { type: "node.exec", runId: node.runId, nodeRunId: node.nodeRunId, pool: node.pool },
      { jobId: node.jobId },
    );
  };
}

/** Reads (and removes) the outcome a pool's worker stored; null when there is none yet. */
export async function takeDelegatedResult(
  db: Database,
  nodeRunId: string,
): Promise<ExecutorOutcome | null> {
  return db.system(async (tx) => {
    const [row] = await tx
      .select({ status: delegatedNodes.status, result: delegatedNodes.result })
      .from(delegatedNodes)
      .where(eq(delegatedNodes.nodeRunId, nodeRunId));
    if (row?.status !== "done" || !row.result) return null;
    await tx.delete(delegatedNodes).where(eq(delegatedNodes.nodeRunId, nodeRunId));
    return row.result as unknown as ExecutorOutcome;
  });
}

export interface PoolExecutorDeps {
  db: Database;
  queue: QueueDriver;
  registry: NodeRegistry;
  services: NodeServices;
  workerId: string;
  log: WorkerLogger;
  /** seconds after which another worker may take a running claim over (default 300) */
  staleSeconds?: number;
}

interface Claimed {
  runId: string;
  workspaceId: string;
  call: Pick<DelegatedNode, "call" | "input" | "config">;
}

/** The `node.exec` handler of a pool's worker. */
export function poolExecutor(deps: PoolExecutorDeps) {
  const running = new Set<AbortController>();
  const handle = async (job: Job): Promise<void> => {
    if (job.type !== "node.exec") return;
    const pool: WorkerPool = job.pool;
    const rows = await deps.db.sql<{ claimed: Claimed | null }[]>`
      select flowaid_delegated_claim(${job.nodeRunId}::uuid, ${pool}, ${deps.workerId}, ${
        deps.staleSeconds ?? 300
      }) as claimed`;
    const claimed = rows[0]?.claimed;
    if (!claimed) return; // done, or held by a live worker
    const controller = new AbortController();
    running.add(controller);
    let outcome: ExecutorOutcome;
    const started = Date.now();
    try {
      outcome = await executeDelegated(
        deps.registry,
        deps.services,
        claimed.call,
        controller.signal,
      );
    } catch (error) {
      outcome = {
        kind: "error",
        error: {
          code: "NODE_EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
        latencyMs: Date.now() - started,
      };
    } finally {
      running.delete(controller);
    }
    const stored = await deps.db.sql<{ done: boolean }[]>`
      select flowaid_delegated_complete(${job.nodeRunId}::uuid, ${deps.workerId}, ${JSON.stringify(outcome)}::jsonb) as done`;
    if (!stored[0]?.done) {
      deps.log.warn({ nodeRunId: job.nodeRunId }, "delegated node was taken over; result dropped");
      return;
    }
    await deps.queue.enqueue(
      "run:general",
      {
        type: "run.signal",
        runId: claimed.runId,
        signal: { type: "delegated_result", nodeRunId: job.nodeRunId },
      },
      { jobId: `delegated:${job.nodeRunId}` },
    );
  };
  return {
    handle,
    /** aborts executions in flight (worker shutdown) */
    abortAll() {
      for (const c of running) c.abort(new Error("worker stopping"));
    },
  };
}
