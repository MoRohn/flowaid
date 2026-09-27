/**
 * The container health check (docker/Dockerfile, compose): exits 0 while the worker's heartbeat
 * file is fresh, 1 otherwise. The worker writes it every 10 s next to the master key file
 * (`<data>/worker.heartbeat`); a stale or missing file means the process is stuck or gone.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadEnv } from "@flowaid/env";

export const MAX_HEARTBEAT_AGE_MS = 45_000;

export function heartbeatIsFresh(
  content: string,
  now: number,
  maxAgeMs = MAX_HEARTBEAT_AGE_MS,
): boolean {
  try {
    const at = Date.parse((JSON.parse(content) as { at?: string }).at ?? "");
    return Number.isFinite(at) && now - at <= maxAgeMs;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const env = loadEnv();
  const path = join(
    dirname(String(env.FLOWAID_MASTER_KEY_FILE ?? "/data/master.key")),
    "worker.heartbeat",
  );
  try {
    return heartbeatIsFresh(await readFile(path, "utf8"), Date.now()) ? 0 : 1;
  } catch {
    return 1;
  }
}

// Run as the health-check entry point only (tests import the helper).
if (import.meta.url === `file://${process.argv[1] ?? ""}`) process.exit(await main());
