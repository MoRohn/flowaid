/**
 * Every mutation writes an `audit_events` row (API.md §1), in the same transaction as the change
 * (P3-6), so a change never commits without its row and a row never exists for a change that
 * rolled back.
 *
 * - From its handler on, an audited request runs in an `AsyncLocalStorage` scope holding one
 *   audit id. The api's `Database` is wrapped: when a `tenant`/`system` transaction opened in that
 *   scope has written anything (`pg_current_xact_id_if_assigned()` is set), the row is inserted
 *   just before its commit, idempotently under the request's id. A transaction that only read
 *   writes nothing, and one that rolls back takes its row with it.
 * - When the response is sent, `onSend` completes the row with what the handler learned (the
 *   created resource's id, details, a 4xx/5xx status after a committed change). If that update is
 *   lost (a crash after commit), the row still exists with the action, actor, workspace, route
 *   resource id and request id.
 * - A successful mutation that committed nothing through `ctx.db` (it only enqueued a job, or
 *   the audit row belongs to another workspace than the transaction's) gets its row in `onSend`,
 *   as before: best effort, after the fact.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import { completeAudit, recordAudit, type Database, type Tx } from "@flowaid/database";
import type { ApiContext } from "../context.js";
import type { AuditSpec } from "../types.js";

interface AuditScope {
  readonly id: string;
  readonly req: FastifyRequest;
  readonly spec: AuditSpec;
  /** A transaction that wrote the row has committed. */
  written: boolean;
}

const scopes = new AsyncLocalStorage<AuditScope>();
const byRequest = new WeakMap<FastifyRequest, AuditScope>();
/** On a wrapped `Database`: the database it wraps. */
const UNWRAPPED = Symbol("flowaid.auditing.unwrapped");

function unwrap(db: Database): Database {
  return (db as { [UNWRAPPED]?: Database })[UNWRAPPED] ?? db;
}

type AuditRow = Parameters<typeof recordAudit>[1];

/** The row a request audits now, or null without an actor (nobody to attribute it to). */
function auditRow(req: FastifyRequest, spec: AuditSpec, status?: number): AuditRow | null {
  const actor =
    req.audit.actor ??
    (req.principal
      ? { type: req.principal.type, id: req.principal.id }
      : req.sessionOnly
        ? { type: "user" as const, id: req.sessionOnly.userId }
        : null);
  if (!actor) return null;
  const params = (req.params ?? {}) as Record<string, string>;
  const details = req.audit.details ?? {};
  return {
    workspaceId:
      req.audit.workspaceId !== undefined
        ? req.audit.workspaceId
        : (req.principal?.workspaceId ?? null),
    actorType: actor.type,
    actorId: actor.id,
    action: spec.action,
    resourceType: spec.resource,
    resourceId: req.audit.resourceId ?? params[spec.idParam ?? "id"] ?? "-",
    details: status !== undefined && status >= 400 ? { ...details, status } : details,
    ip: req.ip,
    userAgent:
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"].slice(0, 500)
        : null,
    requestId: req.id,
  };
}

/**
 * Inserts the scope's row in `tx` when `tx` changed something. `workspaceId` is the tenant the
 * transaction is scoped to (null: system scope); a row for another workspace cannot pass that
 * tenant's row-level security, so it is left to `onSend`. True when the row was written.
 */
async function writeInTransaction(
  tx: Tx,
  scope: AuditScope,
  workspaceId: string | null,
): Promise<boolean> {
  const [state] = await tx.execute<{ wrote: boolean }>(
    sql`select pg_current_xact_id_if_assigned() is not null as wrote`,
  );
  if (!state?.wrote) return false;
  const row = auditRow(scope.req, scope.spec);
  if (!row) return false;
  if (workspaceId !== null && row.workspaceId !== workspaceId) return false;
  await recordAudit(tx, { ...row, id: scope.id });
  return true;
}

/** `db` whose transactions write the current request's audit row before they commit. */
export function auditingDatabase(wrapped: Database): Database {
  const db = unwrap(wrapped);
  const scoped =
    <T>(workspaceId: string | null, open: (fn: (tx: Tx) => Promise<T>) => Promise<T>) =>
    async (fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const scope = scopes.getStore();
      if (!scope) return open(fn);
      let wrote = false;
      const result = await open(async (tx) => {
        const value = await fn(tx);
        wrote = await writeInTransaction(tx, scope, workspaceId);
        return value;
      });
      // committed: the row exists from here on
      if (wrote) scope.written = true;
      return result;
    };
  return Object.assign(Object.create(db) as Database, {
    [UNWRAPPED]: db,
    tenant: <T>(workspaceId: string, fn: (tx: Tx) => Promise<T>) =>
      scoped<T>(workspaceId, (f) => db.tenant(workspaceId, f))(fn),
    system: <T>(fn: (tx: Tx) => Promise<T>) => scoped<T>(null, (f) => db.system(f))(fn),
  });
}

/** Called when the response is known (tests replace it to simulate a crash after commit). */
export type AuditCompletion = (
  db: Database,
  scope: { id: string; written: boolean },
  row: AuditRow,
  status: number,
) => Promise<void>;

export const completeAuditRow: AuditCompletion = async (db, scope, row, status) => {
  if (scope.written) {
    const { workspaceId, actorType, actorId, resourceId, details } = row;
    const found = await db.system((tx) =>
      completeAudit(tx, scope.id, { workspaceId, actorType, actorId, resourceId, details }),
    );
    if (found) return;
  }
  // nothing committed through the database (or the row is gone): the after-the-fact row
  if (status < 400) await db.system((tx) => recordAudit(tx, { ...row, id: scope.id }));
};

export function registerAudit(
  app: FastifyInstance,
  ctx: ApiContext,
  complete: AuditCompletion = completeAuditRow,
): void {
  const raw = unwrap(ctx.db);
  ctx.db = auditingDatabase(raw);

  // The scope starts at the last global preHandler, after authentication and the rate limiter
  // (their own writes are not the route's change), and the handler runs inside it.
  app.addHook("preHandler", (req: FastifyRequest, _reply: FastifyReply, done) => {
    const spec = req.routeOptions.config.audit;
    if (!spec) {
      done();
      return;
    }
    const scope: AuditScope = { id: uuidv7(), req, spec, written: false };
    byRequest.set(req, scope);
    scopes.run(scope, done);
  });

  app.addHook("onSend", async (req, reply, payload) => {
    const spec = req.routeOptions.config.audit;
    if (!spec) return payload;
    const scope = byRequest.get(req);
    const status = reply.statusCode;
    if (!scope?.written && status >= 400) return payload;
    const row = auditRow(req, spec, status);
    if (!row) return payload;
    try {
      await complete(raw, scope ?? { id: uuidv7(), written: false }, row, status);
    } catch (error) {
      req.log.error({ err: error, action: spec.action }, "audit completion failed");
    }
    return payload;
  });
}
