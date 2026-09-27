/** `ctx.state` over `state_entries`: run, session and workspace namespaces, TTLs and versioned CAS. */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { stateEntries, type Database } from "@flowaid/database";
import type { StateAccess } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";
import type { ExecutionCall } from "@flowaid/workflow-runtime";

export function namespaceOf(
  call: Pick<ExecutionCall, "runId" | "sessionId">,
  ns: "run" | "session" | "workspace",
): string {
  if (ns === "workspace") return "workspace";
  if (ns === "session") return call.sessionId ? `session:${call.sessionId}` : `run:${call.runId}`;
  return `run:${call.runId}`;
}

export function stateAccessFor(db: Database, call: ExecutionCall): StateAccess {
  const live = sql`(${stateEntries.expiresAt} is null or ${stateEntries.expiresAt} > now())`;
  return {
    get: async (ns, key) => {
      const [row] = await db.tenant(call.workspaceId, (tx) =>
        tx
          .select({ value: stateEntries.value })
          .from(stateEntries)
          .where(
            and(
              eq(stateEntries.workspaceId, call.workspaceId),
              eq(stateEntries.namespace, namespaceOf(call, ns)),
              eq(stateEntries.key, key),
              live,
            ),
          ),
      );
      return row ? row.value : null;
    },
    set: async (ns, key, value: JsonValue, opts) => {
      const expiresAt = opts?.ttlMs ? new Date(Date.now() + opts.ttlMs) : null;
      await db.tenant(call.workspaceId, (tx) =>
        tx
          .insert(stateEntries)
          .values({
            workspaceId: call.workspaceId,
            namespace: namespaceOf(call, ns),
            key,
            value,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [stateEntries.workspaceId, stateEntries.namespace, stateEntries.key],
            set: {
              value,
              expiresAt,
              version: sql`${stateEntries.version} + 1`,
              updatedAt: new Date(),
            },
          }),
      );
    },
    cas: async (ns, key, expectedVersion, value) => {
      const rows = await db.tenant(call.workspaceId, async (tx) => {
        if (expectedVersion === 0) {
          return tx
            .insert(stateEntries)
            .values({ workspaceId: call.workspaceId, namespace: namespaceOf(call, ns), key, value })
            .onConflictDoNothing()
            .returning({ v: stateEntries.version });
        }
        return tx
          .update(stateEntries)
          .set({ value, version: sql`${stateEntries.version} + 1`, updatedAt: new Date() })
          .where(
            and(
              eq(stateEntries.workspaceId, call.workspaceId),
              eq(stateEntries.namespace, namespaceOf(call, ns)),
              eq(stateEntries.key, key),
              eq(stateEntries.version, expectedVersion),
              or(isNull(stateEntries.expiresAt), gt(stateEntries.expiresAt, new Date())),
            ),
          )
          .returning({ v: stateEntries.version });
      });
      return rows.length > 0;
    },
  };
}
