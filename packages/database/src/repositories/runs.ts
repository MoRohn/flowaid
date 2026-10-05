/** Run queries for the API: idempotency, listing with cursor pagination, human task inbox, audit. */
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import type { HumanTask, JsonObject, Run } from "@flowaid/workflow-core";
import type { Tx } from "../db.js";
import { toHumanTask, toRun } from "../mappers.js";
import { auditEvents, humanTasks, runs, workflows } from "../schema.js";

/** A run started with the same idempotency key in the workspace (24 h window; the sweep nulls older keys). */
export async function findRunByIdempotencyKey(
  tx: Tx,
  workspaceId: string,
  key: string,
): Promise<Run | null> {
  const [row] = await tx
    .select()
    .from(runs)
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.idempotencyKey, key)));
  return row ? toRun(row) : null;
}

export interface RunListFilter {
  workspaceId: string;
  workflowId?: string;
  environmentId?: string;
  status?: Run["status"][];
  origin?: Run["origin"];
  sessionId?: string;
  /**
   * Search, case-insensitive: the start of the run id ("01a10cfc-be8a"), part of the workflow's
   * name, or part of the error message.
   */
  q?: string;
  /** Created at or after. */
  from?: Date;
  /** Created at or before. */
  to?: Date;
  /** Opaque cursor from the previous page. */
  cursor?: string | null;
  limit?: number;
}

/** `text` for a LIKE pattern, with its wildcards taken literally. */
const likeText = (text: string) => text.replace(/[\\%_]/g, "\\$&");

function searchCondition(workspaceId: string, q: string): SQL | undefined {
  const contains = `%${likeText(q)}%`;
  return or(
    sql`${runs.id}::text like ${`${likeText(q.toLowerCase())}%`}`,
    inArray(
      runs.workflowId,
      sql`(select ${workflows.id} from ${workflows} where ${and(
        eq(workflows.workspaceId, workspaceId),
        ilike(workflows.name, contains),
      )})`,
    ),
    sql`${runs.error}->>'message' ilike ${contains}`,
  );
}

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(at ?? "");
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/** Newest first, keyset-paginated on (created_at, id). */
export async function listRuns(
  tx: Tx,
  filter: RunListFilter,
): Promise<{ items: Run[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const conditions: (SQL | undefined)[] = [
    eq(runs.workspaceId, filter.workspaceId),
    filter.workflowId ? eq(runs.workflowId, filter.workflowId) : undefined,
    filter.environmentId ? eq(runs.environmentId, filter.environmentId) : undefined,
    filter.status?.length ? inArray(runs.status, filter.status) : undefined,
    filter.origin ? eq(runs.origin, filter.origin) : undefined,
    filter.sessionId ? eq(runs.sessionId, filter.sessionId) : undefined,
    filter.q?.trim() ? searchCondition(filter.workspaceId, filter.q.trim()) : undefined,
    filter.from ? gte(runs.createdAt, filter.from) : undefined,
    filter.to ? lte(runs.createdAt, filter.to) : undefined,
  ];
  const after = filter.cursor ? decodeCursor(filter.cursor) : null;
  if (after)
    conditions.push(
      or(
        lt(runs.createdAt, after.createdAt),
        and(eq(runs.createdAt, after.createdAt), lt(runs.id, after.id)),
      ),
    );
  const rows = await tx
    .select()
    .from(runs)
    .where(and(...conditions))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toRun),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function listHumanTasks(
  tx: Tx,
  filter: {
    workspaceId: string;
    status?: HumanTask["status"][];
    workflowId?: string;
    limit?: number;
  },
): Promise<HumanTask[]> {
  const rows = await tx
    .select()
    .from(humanTasks)
    .where(
      and(
        eq(humanTasks.workspaceId, filter.workspaceId),
        filter.status?.length ? inArray(humanTasks.status, filter.status) : undefined,
        filter.workflowId ? eq(humanTasks.workflowId, filter.workflowId) : undefined,
      ),
    )
    .orderBy(desc(humanTasks.createdAt))
    .limit(filter.limit ?? 100);
  return rows.map(toHumanTask);
}

export type AuditActorType = (typeof auditEvents.$inferSelect)["actorType"];

/**
 * Appends an audit event; `details` must already be redacted by the caller. With an `id` the
 * insert is idempotent (an existing row with that id is kept): the api writes a request's row
 * inside each transaction the request commits, under one id.
 */
export async function recordAudit(
  tx: Tx,
  input: {
    id?: string;
    workspaceId: string | null;
    actorType: AuditActorType;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    details?: JsonObject;
    ip?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  },
): Promise<void> {
  const { id, ...row } = input;
  const insert = tx
    .insert(auditEvents)
    .values({ ...row, id: id ?? uuidv7(), details: row.details ?? {} });
  await (id ? insert.onConflictDoNothing({ target: auditEvents.id }) : insert);
}

/** Completes a request's audit row once the response is known (the resource id, details). */
export async function completeAudit(
  tx: Tx,
  id: string,
  patch: Pick<
    typeof auditEvents.$inferInsert,
    "workspaceId" | "actorType" | "actorId" | "resourceId" | "details"
  >,
): Promise<boolean> {
  const rows = await tx
    .update(auditEvents)
    .set(patch)
    .where(eq(auditEvents.id, id))
    .returning({ id: auditEvents.id });
  return rows.length > 0;
}

export async function listAudit(tx: Tx, workspaceId: string, limit = 100) {
  return tx
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId))
    .orderBy(desc(auditEvents.at))
    .limit(limit);
}
