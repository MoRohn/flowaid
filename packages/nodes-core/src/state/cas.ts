/**
 * Versioned state updates over `ctx.state.cas`. The entry stores `{ version, data }`, where
 * `version` mirrors the store's own entry version (1 after the insert, +1 per update), so the next
 * compare-and-set can name it. Keys updated here must only be written through `casUpdate`.
 */
import type { ExecutionContext } from "@flowaid/node-sdk";
import { ConflictError, type JsonValue } from "@flowaid/workflow-core";

export interface Versioned {
  version: number;
  data: JsonValue;
}

export function readVersioned(raw: JsonValue | null): Versioned | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.version === "number")
    return { version: raw.version, data: raw.data ?? null };
  return null;
}

/**
 * Applies `next(current)` with compare-and-set, retrying on concurrent writers. `next` may return
 * `undefined` to leave the entry unchanged. Resolves with the value written (or kept).
 */
export async function casUpdate(
  ctx: ExecutionContext<unknown>,
  namespace: "run" | "session" | "workspace",
  key: string,
  next: (current: Versioned | null) => JsonValue | undefined,
  attempts = 8,
): Promise<{ written: boolean; value: Versioned | null }> {
  for (let i = 0; i < attempts; i += 1) {
    const current = readVersioned(await ctx.state.get(namespace, key));
    const data = next(current);
    if (data === undefined) return { written: false, value: current };
    const version = (current?.version ?? 0) + 1;
    if (await ctx.state.cas(namespace, key, current?.version ?? 0, { version, data }))
      return { written: true, value: { version, data } };
  }
  throw new ConflictError(`state ${namespace}:${key} kept changing; try again`);
}
