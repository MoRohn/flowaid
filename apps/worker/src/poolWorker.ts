/**
 * A pool-only worker (`WORKER_POOLS` without `general`): executes the nodes other workers
 * delegate to its pools and nothing else — no orchestration, no scheduler, no credentials. The
 * `code` pool's worker is the sandbox host (compose `worker-code`, ARCHITECTURE.md §10.7): it
 * connects as the restricted `flowaid_code` role, holds no master key or provider key, and runs
 * user code in isolated-vm with only the network bridge (`fetch` through SafeFetch, allow-listed
 * hosts only). Tool and state bridges need the trusted tier and are refused there.
 */
import type { Database } from "@flowaid/database";
import type { NodePackage } from "@flowaid/node-sdk";
import { coreNodes } from "@flowaid/nodes-core";
import { uuidv7 } from "@flowaid/shared";
import type { QueueDriver, SafeFetch, SandboxExecutor, WorkerPool } from "@flowaid/workflow-core";
import { NodeRegistry, type NodeServices } from "@flowaid/workflow-runtime";
import { poolExecutor } from "./delegation.js";
import type { WorkerLogger } from "./worker.js";

export interface PoolWorkerDeps {
  db: Database;
  queue: QueueDriver;
  pools: readonly WorkerPool[];
  http: SafeFetch;
  sandbox?: SandboxExecutor;
  nodes?: readonly NodePackage[];
  workerId?: string;
  concurrency?: number;
  log: WorkerLogger;
}

export interface PoolWorker {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createPoolWorker(deps: PoolWorkerDeps): PoolWorker {
  const workerId = deps.workerId ?? `worker-${deps.pools.join("+")}-${uuidv7().slice(-8)}`;
  const services: NodeServices = {
    http: () => deps.http,
    ...(deps.sandbox ? { sandbox: deps.sandbox } : {}),
  };
  const executor = poolExecutor({
    db: deps.db,
    queue: deps.queue,
    registry: new NodeRegistry([...(deps.nodes ?? [coreNodes])]),
    services,
    workerId,
    log: deps.log,
  });
  const stops: (() => Promise<void>)[] = [];
  return {
    id: workerId,
    async start() {
      for (const pool of deps.pools) {
        const consumer = await deps.queue.consume(`run:${pool}`, executor.handle, {
          concurrency: deps.concurrency ?? 4,
        });
        stops.push(() => consumer.stop());
      }
      deps.log.info({ workerId, pools: deps.pools }, "pool worker started");
    },
    async stop() {
      for (const s of stops.splice(0).reverse()) await s().catch(() => undefined);
      executor.abortAll();
      deps.log.info({ workerId }, "pool worker stopped");
    },
  };
}
