/** API keys: stored as SHA-256 hashes, looked up by hash, never returned in clear after creation. */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import type { Tx } from "../db.js";
import { apiKeys } from "../schema.js";

export type ApiKeyRow = typeof apiKeys.$inferSelect;

export async function createApiKey(
  tx: Tx,
  input: Omit<typeof apiKeys.$inferInsert, "id" | "createdAt" | "lastUsedAt" | "revokedAt">,
): Promise<ApiKeyRow> {
  const [row] = await tx
    .insert(apiKeys)
    .values({ id: uuidv7(), ...input })
    .returning();
  return row as ApiKeyRow;
}

/** The live key with this hash (not revoked, not expired) — system scope: runs before a tenant is known. */
export async function findActiveApiKey(tx: Tx, keyHash: string): Promise<ApiKeyRow | null> {
  const [row] = await tx
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, keyHash),
        isNull(apiKeys.revokedAt),
        gt(apiKeys.expiresAt, sql`now()`),
      ),
    );
  return row ?? null;
}

/** Records use at most once a minute, so authentication does not write on every request. */
export async function touchApiKey(tx: Tx, id: string): Promise<void> {
  await tx
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, id),
        sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < now() - interval '1 minute')`,
      ),
    );
}

export async function listApiKeys(tx: Tx, workspaceId: string): Promise<ApiKeyRow[]> {
  return tx
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .update(apiKeys)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

/**
 * Rotation: a new key with the same settings; the old one keeps working for `graceMs` so
 * clients can switch without downtime.
 */
export async function rotateApiKey(
  tx: Tx,
  id: string,
  next: { prefix: string; keyHash: string; expiresAt: Date; graceMs: number },
): Promise<ApiKeyRow | null> {
  const [old] = await tx
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .for("update");
  if (!old) return null;
  const created = await createApiKey(tx, {
    workspaceId: old.workspaceId,
    name: old.name,
    prefix: next.prefix,
    keyHash: next.keyHash,
    scopes: old.scopes,
    environmentId: old.environmentId,
    workflowIds: old.workflowIds,
    isServiceAccount: old.isServiceAccount,
    rateLimitPerMin: old.rateLimitPerMin,
    createdBy: old.createdBy,
    expiresAt: next.expiresAt,
  });
  await tx
    .update(apiKeys)
    .set({
      expiresAt: sql`least(${apiKeys.expiresAt}, now() + ${next.graceMs} * interval '1 millisecond')`,
    })
    .where(eq(apiKeys.id, id));
  return created;
}
