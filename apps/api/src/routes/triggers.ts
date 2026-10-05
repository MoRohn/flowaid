/**
 * Webhooks and schedules (API.md §3.9): rows are materialised from deployed triggers; these routes
 * edit only environment-specific fields (definition fields answer 409), rotate webhook secrets,
 * list deliveries, and fire a schedule by hand. Also: the audit log and artifact downloads.
 */
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import {
  artifacts,
  auditEvents,
  credentials,
  schedules,
  webhookDeliveries,
  webhooks,
  type Tx,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { LocalArtifactStore, S3ArtifactStore, type ArtifactStore } from "@flowaid/storage";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@flowaid/workflow-core";
import { canSeeWorkflow, hasScope, type Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import {
  IdParams,
  ListQuery,
  PageQuery,
  queryBool,
  afterCursor,
  decodeCursor,
  encodeCursor,
  toPage,
} from "../dto/common.js";
import { startRun } from "../services/runs.js";

type WebhookRow = typeof webhooks.$inferSelect;

/** Deletes the secrets generated for a webhook other than the one it uses now (`keep`). */
async function dropReplacedSecrets(tx: Tx, webhookId: string, keep: string | null) {
  await tx
    .delete(credentials)
    .where(
      and(eq(credentials.ownerWebhookId, webhookId), keep ? ne(credentials.id, keep) : undefined),
    );
}

/** Only the workflows `p` may see, in SQL so a page is not thinned after the fact. */
const visibleWorkflows = (p: Principal, col: AnyColumn) =>
  p.workflowIds ? (p.workflowIds.size ? inArray(col, [...p.workflowIds]) : sql`false`) : undefined;
type ScheduleRow = typeof schedules.$inferSelect;

const webhookDto = (w: WebhookRow, ctx: ApiContext, slug: string) => ({
  id: w.id,
  workflowId: w.workflowId,
  environmentId: w.environmentId,
  path: w.path,
  url: `${ctx.config.baseUrl.replace(/\/$/, "")}/hooks/${slug}/${w.path}`,
  signature: w.signature,
  requireTimestamp: w.requireTimestamp,
  idempotencyHeader: w.idempotencyHeader,
  secretBound: w.secretCredentialId !== null,
  responseMode: w.responseMode,
  inputPointer: w.inputPointer,
  allowedHeaders: w.allowedHeaders,
  callbackUrl: w.callbackUrl,
  enabled: w.enabled,
  lastReceivedAt: w.lastReceivedAt?.toISOString() ?? null,
  createdAt: w.createdAt.toISOString(),
});
const scheduleDto = (s: ScheduleRow) => ({
  id: s.id,
  workflowId: s.workflowId,
  environmentId: s.environmentId,
  cron: s.cron,
  timezone: s.timezone,
  input: s.input,
  overlap: s.overlap,
  catchUp: s.catchUp,
  maxCatchUp: s.maxCatchUp,
  jitterMs: s.jitterMs,
  enabled: s.enabled,
  nextRunAt: s.nextRunAt?.toISOString() ?? null,
  lastRunAt: s.lastRunAt?.toISOString() ?? null,
  lastRunId: s.lastRunId,
  lastError: s.lastError,
});

export function triggerRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const stores: ArtifactStore[] = [
    ...(ctx.config.s3 ? [new S3ArtifactStore(ctx.config.s3)] : []),
    ...(ctx.config.artifactsDir ? [new LocalArtifactStore(ctx.config.artifactsDir)] : []),
  ];
  const need = (p: Principal | null): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    return p;
  };
  const loadHook = async (tx: Tx, p: Principal, id: string) => {
    const [w] = await tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, p.workspaceId)));
    if (!w || !canSeeWorkflow(p, w.workflowId)) throw new NotFoundError("webhook not found");
    return w;
  };
  const loadSchedule = async (tx: Tx, p: Principal, id: string) => {
    const [s] = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.workspaceId, p.workspaceId)));
    if (!s || !canSeeWorkflow(p, s.workflowId)) throw new NotFoundError("schedule not found");
    return s;
  };

  r.get(
    "/v1/webhooks",
    {
      config: {
        auth: "session_or_api_key",
        scope: "webhooks:write",
        cli: { noun: "webhook", verb: "list" },
      },
      schema: {
        tags: ["triggers"],
        querystring: PageQuery.extend({ workflowId: z.uuid().optional() }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit, cursor } = req.query;
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(webhooks)
          .where(
            and(
              eq(webhooks.workspaceId, p.workspaceId),
              req.query.workflowId ? eq(webhooks.workflowId, req.query.workflowId) : undefined,
              visibleWorkflows(p, webhooks.workflowId),
              afterCursor(webhooks.path, webhooks.id, cursor),
            ),
          )
          .orderBy(asc(webhooks.path), asc(webhooks.id))
          .limit(limit + 1),
      );
      return toPage(
        rows,
        limit,
        (w) => [w.path, w.id],
        (w) => webhookDto(w, ctx, p.workspaceSlug),
      );
    },
  );

  r.patch(
    "/v1/webhooks/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "webhooks:write",
        audit: { action: "webhook.update", resource: "webhook" },
        cli: { noun: "webhook", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["triggers"],
        params: IdParams,
        body: z
          .object({
            secretCredentialId: z.uuid().nullable().optional(),
            callbackUrl: z.url().nullable().optional(),
            allowedHeaders: z.array(z.string().max(100)).max(50).optional(),
            enabled: z.boolean().optional(),
            requireTimestamp: z.boolean().optional(),
            idempotencyHeader: z.string().max(100).nullable().optional(),
            path: z.string().optional(),
          })
          .strict(),
      },
    },
    async (req) => {
      const p = need(req.principal);
      if (req.body.path !== undefined)
        throw new ConflictError(
          "the path is part of the workflow definition; change the trigger and redeploy",
        );
      const w = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadHook(tx, p, req.params.id);
        if (req.body.secretCredentialId) {
          const [c] = await tx
            .select()
            .from(credentials)
            .where(
              and(
                eq(credentials.id, req.body.secretCredentialId),
                eq(credentials.workspaceId, p.workspaceId),
              ),
            );
          if (!c) throw new BadRequestError("secret credential not found");
          if (
            c.ownerNotificationId ||
            (c.ownerWebhookId !== null && c.ownerWebhookId !== req.params.id)
          )
            throw new ConflictError(
              "that credential is the signing secret of another webhook or notification channel",
            );
        }
        const { path: _path, ...fields } = req.body;
        const [u] = await tx
          .update(webhooks)
          .set(fields)
          .where(eq(webhooks.id, req.params.id))
          .returning();
        // a secret generated for this webhook and no longer used by it is deleted
        if (req.body.secretCredentialId !== undefined)
          await dropReplacedSecrets(tx, req.params.id, req.body.secretCredentialId);
        return u as WebhookRow;
      });
      return webhookDto(w, ctx, p.workspaceSlug);
    },
  );

  r.post(
    "/v1/webhooks/:id/rotate-secret",
    {
      config: {
        auth: "session_or_api_key",
        scope: "webhooks:write",
        audit: { action: "webhook.rotate_secret", resource: "webhook" },
        cli: { noun: "webhook", verb: "rotate-secret", positional: ["id"] },
      },
      schema: {
        tags: ["triggers"],
        summary: "Generate a new signing secret (returned once)",
        params: IdParams,
        response: { 200: z.object({ secret: z.string(), credentialId: z.uuid() }) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const secret = `whsec_${randomBytes(32).toString("base64url")}`;
      const credentialId = uuidv7();
      const sealed = await ctx.credentials.seal(credentialId, "http.header", {
        name: "X-Signature-Secret",
        value: secret,
      });
      await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await loadHook(tx, p, req.params.id);
        // the previous secret stops working now, so it is deleted rather than left behind (first:
        // it may hold the name)
        await dropReplacedSecrets(tx, w.id, null);
        // the webhook owns it: not listed under Credentials, deleted with the webhook
        await tx.insert(credentials).values({
          id: credentialId,
          workspaceId: p.workspaceId,
          name: `webhook ${w.path} ${new Date(ctx.clock.now()).toISOString()}`,
          type: "http.header",
          storage: "db",
          ciphertext: sealed.ciphertext,
          wrappedDataKey: sealed.wrappedDataKey,
          keyVersion: sealed.keyVersion,
          publicFields: sealed.publicFields,
          environmentId: w.environmentId,
          ownerWebhookId: w.id,
          createdBy: p.userId,
        });
        await tx
          .update(webhooks)
          .set({ secretCredentialId: credentialId })
          .where(eq(webhooks.id, w.id));
      });
      return { secret, credentialId };
    },
  );

  r.get(
    "/v1/webhooks/:id/deliveries",
    {
      config: {
        auth: "session_or_api_key",
        scope: "webhooks:write",
        cli: { noun: "webhook", verb: "deliveries", positional: ["id"] },
      },
      schema: { tags: ["triggers"], params: IdParams, querystring: ListQuery },
    },
    async (req) => {
      const p = need(req.principal);
      const cursor = decodeCursor(req.query.cursor);
      const rows = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadHook(tx, p, req.params.id);
        return tx
          .select()
          .from(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.webhookId, req.params.id),
              cursor
                ? or(
                    lt(webhookDeliveries.createdAt, new Date(String(cursor[0]))),
                    and(
                      eq(webhookDeliveries.createdAt, new Date(String(cursor[0]))),
                      lt(webhookDeliveries.id, cursor[1]),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
          .limit(req.query.limit + 1);
      });
      const items = rows.slice(0, req.query.limit);
      const last = items.at(-1);
      return {
        items: items.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
        })),
        next_cursor:
          rows.length > req.query.limit && last
            ? encodeCursor(last.createdAt.toISOString(), last.id)
            : null,
      };
    },
  );

  r.get(
    "/v1/schedules",
    {
      config: {
        auth: "session_or_api_key",
        scope: "schedules:write",
        cli: { noun: "schedule", verb: "list" },
      },
      schema: {
        tags: ["triggers"],
        querystring: PageQuery.extend({ workflowId: z.uuid().optional() }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit } = req.query;
      // Soonest next run first, schedules with none (disabled) last; the cursor's "" is such a one.
      const c = decodeCursor(req.query.cursor);
      const after = !c
        ? undefined
        : c[0] === ""
          ? and(isNull(schedules.nextRunAt), gt(schedules.id, c[1]))
          : or(
              isNull(schedules.nextRunAt),
              gt(schedules.nextRunAt, new Date(String(c[0]))),
              and(eq(schedules.nextRunAt, new Date(String(c[0]))), gt(schedules.id, c[1])),
            );
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(schedules)
          .where(
            and(
              eq(schedules.workspaceId, p.workspaceId),
              req.query.workflowId ? eq(schedules.workflowId, req.query.workflowId) : undefined,
              visibleWorkflows(p, schedules.workflowId),
              after,
            ),
          )
          .orderBy(sql`${schedules.nextRunAt} asc nulls last`, asc(schedules.id))
          .limit(limit + 1),
      );
      return toPage(rows, limit, (s) => [s.nextRunAt?.toISOString() ?? "", s.id], scheduleDto);
    },
  );

  r.patch(
    "/v1/schedules/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "schedules:write",
        audit: { action: "schedule.update", resource: "schedule" },
        cli: { noun: "schedule", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["triggers"],
        params: IdParams,
        body: z
          .object({
            enabled: z.boolean().optional(),
            overlap: z.enum(["skip", "allow"]).optional(),
            catchUp: z.enum(["skip", "one", "all"]).optional(),
            maxCatchUp: z.int().min(1).max(100).optional(),
            jitterMs: z.int().min(0).max(3_600_000).optional(),
            cron: z.string().optional(),
          })
          .strict(),
      },
    },
    async (req) => {
      const p = need(req.principal);
      if (req.body.cron !== undefined)
        throw new ConflictError(
          "the cron is part of the workflow definition; change the trigger and redeploy",
        );
      const s = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadSchedule(tx, p, req.params.id);
        const { cron: _cron, ...fields } = req.body;
        const [u] = await tx
          .update(schedules)
          .set(fields)
          .where(eq(schedules.id, req.params.id))
          .returning();
        return u as ScheduleRow;
      });
      return scheduleDto(s);
    },
  );

  r.post(
    "/v1/schedules/:id/trigger",
    {
      config: {
        auth: "session_or_api_key",
        scope: "schedules:write",
        audit: { action: "schedule.trigger", resource: "schedule" },
        cli: { noun: "schedule", verb: "trigger", positional: ["id"] },
      },
      schema: {
        tags: ["triggers"],
        summary: "Fire the schedule now (its input, its environment)",
        params: IdParams,
        response: { 202: z.object({ run_id: z.uuid() }) },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const s = await ctx.db.tenant(p.workspaceId, (tx) => loadSchedule(tx, p, req.params.id));
      const principal: Principal = { ...p, environmentId: null };
      const started = await startRun(
        ctx,
        principal,
        s.workflowId,
        {
          input: s.input,
          mode: "async",
          environmentId: s.environmentId,
          labels: { scheduleId: s.id, manual: "true" },
        },
        { origin: "schedule" },
      );
      // the row's "last run" shows it, like a scheduled fire (overlap: skip waits for it too)
      await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .update(schedules)
          .set({ lastRunAt: new Date(ctx.clock.now()), lastRunId: started.run.id })
          .where(eq(schedules.id, s.id)),
      );
      req.audit.details = { runId: started.run.id };
      return reply.code(202).send({ run_id: started.run.id });
    },
  );

  r.get(
    "/v1/audit",
    {
      config: {
        auth: "session_or_api_key",
        scope: "audit:read",
        cli: { noun: "audit", verb: "list" },
      },
      schema: {
        tags: ["audit"],
        querystring: ListQuery.extend({
          actor: z.string().optional(),
          action: z.string().optional(),
          resourceType: z.string().optional(),
          resourceId: z.string().optional(),
          from: z.iso.datetime().optional(),
          to: z.iso.datetime().optional(),
        }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const q = req.query;
      const cursor = decodeCursor(q.cursor);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.workspaceId, p.workspaceId),
              q.actor ? eq(auditEvents.actorId, q.actor) : undefined,
              q.action ? eq(auditEvents.action, q.action) : undefined,
              q.resourceType ? eq(auditEvents.resourceType, q.resourceType) : undefined,
              q.resourceId ? eq(auditEvents.resourceId, q.resourceId) : undefined,
              q.from ? gte(auditEvents.at, new Date(q.from)) : undefined,
              q.to ? lte(auditEvents.at, new Date(q.to)) : undefined,
              cursor
                ? or(
                    lt(auditEvents.at, new Date(String(cursor[0]))),
                    and(
                      eq(auditEvents.at, new Date(String(cursor[0]))),
                      lt(auditEvents.id, cursor[1]),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(auditEvents.at), desc(auditEvents.id))
          .limit(q.limit + 1),
      );
      const items = rows.slice(0, q.limit);
      const last = items.at(-1);
      return {
        items: items.map((a) => ({ ...a, at: a.at.toISOString() })),
        next_cursor:
          rows.length > q.limit && last ? encodeCursor(last.at.toISOString(), last.id) : null,
      };
    },
  );

  const INLINE = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "text/plain",
    "application/json",
  ]);
  r.get(
    "/v1/artifacts/:id/download",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "artifact", verb: "download", positional: ["id"] },
      },
      schema: {
        tags: ["artifacts"],
        params: IdParams,
        querystring: z.object({ inline: queryBool() }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const [a] = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.id, req.params.id), eq(artifacts.workspaceId, p.workspaceId))),
      );
      if (!a || a.status !== "ready") throw new NotFoundError("artifact not found");
      if (a.expiresAt && a.expiresAt.getTime() <= ctx.clock.now())
        throw new NotFoundError("artifact expired");
      if (a.kind === "export" && !hasScope(p, "workflows:read"))
        throw new ForbiddenError("missing scope workflows:read");
      if (a.workflowId && !canSeeWorkflow(p, a.workflowId))
        throw new NotFoundError("artifact not found");
      const store = stores.find((s) => s.kind === a.storage);
      if (!store) throw new NotFoundError("artifact storage is not available to the API");
      // streamed through the API (the object store need not be reachable from browsers)
      const object = await store.open(a.storageKey);
      const inline = req.query.inline && INLINE.has(a.mimeType);
      void reply
        .header("content-type", a.mimeType)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          `${inline ? "inline" : "attachment"}; filename="${a.name.replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
        );
      if (object.size >= 0) void reply.header("content-length", object.size);
      return reply.send(Readable.fromWeb(object.body));
    },
  );
}
