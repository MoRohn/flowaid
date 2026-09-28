/** A heartbeat file the container health check reads (`src/health.ts` compares its age). */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where the heartbeat lives: next to the master key file (`/data`) for an orchestrating worker,
 * the temporary directory for a pool-only worker (the sandbox host has no `/data` mount and a
 * read-only root with a tmpfs `/tmp`).
 */
export function heartbeatPath(env: {
  FLOWAID_MASTER_KEY_FILE?: string | undefined;
  WORKER_POOLS: readonly string[];
}): string {
  if (!env.WORKER_POOLS.includes("general")) return join(tmpdir(), "flowaid-worker.heartbeat");
  return join(dirname(env.FLOWAID_MASTER_KEY_FILE ?? "/data/master.key"), "worker.heartbeat");
}

/** `status` adds fields to the file (e.g. the last retention sweep); the health check reads `at`. */
export function startHeartbeat(
  path: string,
  everyMs = 10_000,
  status?: () => Record<string, unknown>,
): () => void {
  const beat = () =>
    void writeFile(
      path,
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...status?.() }),
    ).catch(() => undefined);
  beat();
  const t = setInterval(beat, everyMs);
  t.unref();
  return () => clearInterval(t);
}
