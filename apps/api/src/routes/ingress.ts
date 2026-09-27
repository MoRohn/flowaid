/**
 * Ingress (API.md §3.9, §6): `ANY /hooks/:workspaceSlug/<environment>/<path>` and
 * `POST /v1/events/:eventName`.
 *
 * Webhook signatures: `hmac_sha256` — `X-Signature: sha256=<hex>` over `<X-Timestamp>.<raw body>`
 * (timestamp in unix seconds, ±5 min, required unless the webhook opts out, in which case the MAC
 * covers the raw body alone), each signature accepted once (replay cache, 10 min); `token` —
 * `X-Webhook-Token`; `none` — only outside protected environments. Comparisons are constant time.
 * Deliveries are deduplicated by the configured idempotency header or the body hash (24 h): a
 * repeat answers `200 { run_id }` of the original run.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import {
  environments,
  eventSubscriptions,
  webhookDeliveries,
  webhooks,
  workflowDeployments,
  workflowVersions,
  workspaces,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
  getPointer,
  toFlowaidError,
  type JsonObject,
  type JsonValue,
} from "@flowaid/workflow-core";
import type { Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { envelope } from "../plugins/errors.js";
import { startRun, waitForRun } from "../services/runs.js";

const MAX_BODY = 2 * 1024 * 1024;
const REPLAY_TTL_MS = 10 * 60_000;
const SKEW_S = 300;

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `sha256=<hex>` over `<timestamp>.<body>` (or the body alone without a timestamp). */
export function signWebhook(secret: string, body: Buffer, timestamp?: string): string {
  const mac = createHmac("sha256", secret);
  if (timestamp !== undefined) mac.update(`${timestamp}.`);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

class ReplayCache {
  private readonly seen = new Map<string, number>();
  constructor(private readonly now: () => number) {}
  /** false when the key was seen within the TTL */
  add(key: string): boolean {
    const t = this.now();
    if (this.seen.size > 50_000)
      for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    const exp = this.seen.get(key);
    if (exp !== undefined && exp > t) return false;
    this.seen.set(key, t + REPLAY_TTL_MS);
    return true;
  }
}

function webhookPrincipal(w: typeof webhooks.$inferSelect, slug: string): Principal {
  return {
    type: "webhook",
    id: w.id,
    userId: null,
    workspaceId: w.workspaceId,
    workspaceSlug: slug,
    role: null,
    scopes: new Set(["runs:create", "runs:read"]),
    environmentId: w.environmentId,
    workflowIds: new Set([w.workflowId]),
  };
}

export function ingressRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const replays = new ReplayCache(() => ctx.clock.now());

  void app.register((scope, _opts, done) => {
    // Raw bytes for signature checks; parsing happens after verification.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: MAX_BODY },
      (_req, body, next) => next(null, body),
    );
    scope.all(
      "/hooks/:workspaceSlug/*",
      {
        config: {
          auth: "public",
          audit: false,
          rateLimit: {
            max: 300,
            timeWindow: 60_000,
            keyGenerator: (req: FastifyRequest) => `hook:${req.url.split("?")[0] ?? ""}`,
          },
        },
        schema: { hide: true },
      },
      async (req, reply) => {
        const params = req.params as { workspaceSlug: string; "*": string };
        const declared = Number(req.headers["content-length"] ?? "0");
        if (declared > MAX_BODY)
          throw new PayloadTooLargeError("webhook bodies are limited to 2 MiB");
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const found = await ctx.db.system(async (tx) => {
          const [ws] = await tx
            .select()
            .from(workspaces)
            .where(eq(workspaces.slug, params.workspaceSlug));
          if (!ws) return null;
          const [w] = await tx
            .select()
            .from(webhooks)
            .where(and(eq(webhooks.workspaceId, ws.id), eq(webhooks.path, params["*"])));
          const [env] = w
            ? await tx.select().from(environments).where(eq(environments.id, w.environmentId))
            : [];
          return w && w.enabled && env ? { w, env, slug: ws.slug } : null;
        });
        // Unknown and disabled hooks look the same (no existence oracle).
        if (!found) throw new NotFoundError("no such webhook");
        const { w, env, slug } = found;
        const reject = async (reason: string, status = 401) => {
          await ctx.db.system((tx) =>
            tx.insert(webhookDeliveries).values({
              id: uuidv7(),
              workspaceId: w.workspaceId,
              webhookId: w.id,
              direction: "inbound",
              status: "rejected",
              httpStatus: status,
              error: reason,
            }),
          );
          req.log.warn({ webhookId: w.id, reason }, "webhook rejected");
          return reply
            .code(status)
            .send(
              envelope(
                status === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
                "the webhook request was rejected",
                req.id,
              ),
            );
        };

        if (w.signature === "none") {
          if (env.protected)
            return reject("unsigned webhooks are not allowed in protected environments", 403);
        } else {
          const fields = w.secretCredentialId
            ? await ctx.credentials.decrypt(w.secretCredentialId)
            : undefined;
          // http.header → value, http.bearer → token, http.api_key → key.
          const secret = fields ? (fields.value ?? fields.token ?? fields.key) : undefined;
          if (!secret) return reject("the webhook has no signing secret", 403);
          if (w.signature === "token") {
            const token = req.headers["x-webhook-token"];
            if (typeof token !== "string" || !safeEqual(token, secret)) return reject("bad token");
          } else {
            const given = req.headers["x-signature"];
            const ts = req.headers["x-timestamp"];
            if (typeof given !== "string") return reject("missing X-Signature");
            if (typeof ts === "string") {
              const skew = Math.abs(Math.floor(ctx.clock.now() / 1000) - Number(ts));
              if (!Number.isFinite(skew) || skew > SKEW_S)
                return reject("stale or invalid X-Timestamp");
            } else if (w.requireTimestamp) return reject("missing X-Timestamp");
            const expected = signWebhook(secret, raw, typeof ts === "string" ? ts : undefined);
            if (!safeEqual(given, expected)) return reject("bad signature");
            if (!replays.add(`webhook:${w.id}:${createHash("sha256").update(given).digest("hex")}`))
              return reject("replayed signature");
          }
        }

        const headerValue = w.idempotencyHeader
          ? req.headers[w.idempotencyHeader.toLowerCase()]
          : undefined;
        const externalId =
          typeof headerValue === "string" && headerValue
            ? `h:${headerValue.slice(0, 200)}`
            : `b:${createHash("sha256").update(raw).digest("hex")}`;
        const deliveryId = uuidv7();
        const claimed = await ctx.db.system(async (tx) => {
          // Body-hash dedupe is bounded to 24 h; header ids dedupe for as long as rows are kept.
          const [dup] = await tx
            .select({ runId: webhookDeliveries.runId })
            .from(webhookDeliveries)
            .where(
              and(
                eq(webhookDeliveries.webhookId, w.id),
                eq(webhookDeliveries.externalId, externalId),
                eq(webhookDeliveries.direction, "inbound"),
                externalId.startsWith("b:")
                  ? gte(webhookDeliveries.createdAt, new Date(ctx.clock.now() - 86_400_000))
                  : undefined,
              ),
            );
          if (dup) return { duplicate: dup.runId };
          await tx
            .insert(webhookDeliveries)
            .values({
              id: deliveryId,
              workspaceId: w.workspaceId,
              webhookId: w.id,
              direction: "inbound",
              status: "accepted",
              externalId,
            })
            .onConflictDoNothing();
          return { duplicate: undefined };
        });
        if (claimed.duplicate !== undefined)
          return reply.code(200).send({ run_id: claimed.duplicate, duplicate: true });

        let body: JsonValue = null;
        const text = raw.toString("utf8");
        if (text) {
          try {
            body = JSON.parse(text) as JsonValue;
          } catch {
            body = text;
          }
        }
        const allowed = new Set(w.allowedHeaders.map((h) => h.toLowerCase()));
        const headers: JsonObject = Object.fromEntries(
          Object.entries(req.headers).filter(
            ([k, v]) => allowed.has(k) && typeof v === "string",
          ) as [string, string][],
        );
        const query = Object.fromEntries(new URL(req.url, "http://x").searchParams) as JsonObject;
        const doc: JsonObject = { body, headers, query, method: req.method };
        const input = getPointer(doc, w.inputPointer) ?? null;
        try {
          const started = await startRun(
            ctx,
            webhookPrincipal(w, slug),
            w.workflowId,
            {
              input,
              mode: w.responseMode === "sync" ? "sync" : "async",
              environmentId: w.environmentId,
              labels: { webhookId: w.id },
            },
            { origin: "webhook" },
          );
          await ctx.db.system((tx) =>
            tx
              .update(webhookDeliveries)
              .set({ runId: started.run.id })
              .where(eq(webhookDeliveries.id, deliveryId)),
          );
          await ctx.db.system((tx) =>
            tx
              .update(webhooks)
              .set({ lastReceivedAt: new Date(ctx.clock.now()) })
              .where(eq(webhooks.id, w.id)),
          );
          if (w.responseMode !== "sync")
            return reply.code(202).send({ run_id: started.run.id, status: started.run.status });
          const outcome = await waitForRun(ctx, w.workspaceId, started.run.id, 30_000);
          if (outcome.kind === "terminal" && outcome.run.status === "completed")
            return reply
              .code(200)
              .send({ run_id: outcome.run.id, status: "completed", output: outcome.run.output });
          return reply.code(202).send({ run_id: started.run.id, status: outcome.run.status });
        } catch (error) {
          const e = toFlowaidError(error);
          await ctx.db.system((tx) =>
            tx
              .update(webhookDeliveries)
              .set({ status: "rejected", error: e.message.slice(0, 500), httpStatus: e.httpStatus })
              .where(eq(webhookDeliveries.id, deliveryId)),
          );
          throw e;
        }
      },
    );
    done();
  });

  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post(
    "/v1/events/:eventName",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:create",
        audit: { action: "event.publish", resource: "event", idParam: "eventName" },
        cli: { noun: "event", verb: "publish", positional: ["eventName"] },
      },
      schema: {
        tags: ["events"],
        summary: "Start workflows triggered by the event and resume runs waiting for it",
        params: z.object({ eventName: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/) }),
        body: z.object({
          payload: z.unknown().default(null),
          correlationKey: z.string().max(200).optional(),
          environmentId: z.uuid().optional(),
        }),
        response: { 202: z.object({ started: z.array(z.uuid()), delivered: z.array(z.uuid()) }) },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new UnauthorizedError("no principal");
      const envId =
        p.environmentId ??
        req.body.environmentId ??
        (await ctx.db.tenant(
          p.workspaceId,
          async (tx) =>
            (
              await tx
                .select({ id: environments.id })
                .from(environments)
                .where(
                  and(eq(environments.workspaceId, p.workspaceId), eq(environments.name, "dev")),
                )
            )[0]?.id,
        ));
      if (!envId) throw new ForbiddenError("pass environmentId");
      if (p.environmentId && req.body.environmentId && req.body.environmentId !== p.environmentId)
        throw new ForbiddenError("this key is pinned to another environment");
      const { targets, waiting } = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const deployed = await tx
          .select({
            workflowId: workflowDeployments.workflowId,
            triggers: workflowVersions.definition,
          })
          .from(workflowDeployments)
          .innerJoin(workflowVersions, eq(workflowVersions.id, workflowDeployments.versionId))
          .where(
            and(
              eq(workflowDeployments.workspaceId, p.workspaceId),
              eq(workflowDeployments.environmentId, envId),
              eq(workflowDeployments.active, true),
            ),
          );
        const subs = await tx
          .select()
          .from(eventSubscriptions)
          .where(
            and(
              eq(eventSubscriptions.workspaceId, p.workspaceId),
              eq(eventSubscriptions.eventName, req.params.eventName),
              req.body.correlationKey
                ? or(
                    isNull(eventSubscriptions.correlationKey),
                    eq(eventSubscriptions.correlationKey, req.body.correlationKey),
                  )
                : isNull(eventSubscriptions.correlationKey),
            ),
          );
        return {
          targets: deployed
            .filter((d) =>
              d.triggers.triggers.some(
                (t) => t.type === "event" && t.eventName === req.params.eventName,
              ),
            )
            .map((d) => d.workflowId),
          waiting: [...new Set(subs.map((s) => s.runId))],
        };
      });
      const started: string[] = [];
      for (const workflowId of targets) {
        if (p.workflowIds && !p.workflowIds.has(workflowId)) continue;
        const run = await startRun(ctx, { ...p, environmentId: envId }, workflowId, {
          input: req.body.payload as JsonValue,
          mode: "async",
          environmentId: envId,
          labels: { event: req.params.eventName },
        });
        started.push(run.run.id);
      }
      for (const runId of waiting)
        await ctx.queue.enqueue("run:general", {
          type: "run.signal",
          runId,
          signal: {
            type: "event",
            eventName: req.params.eventName,
            payload: req.body.payload as JsonValue,
          },
        });
      req.audit.details = { started: started.length, delivered: waiting.length };
      return reply.code(202).send({ started, delivered: waiting });
    },
  );
}
