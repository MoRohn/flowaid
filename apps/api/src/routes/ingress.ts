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
import { and, eq, isNull, or } from "drizzle-orm";
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
import { limitStore, type ApiContext } from "../context.js";
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
  // Each signature is accepted once across every api replica (Redis with REDIS_URL, P3-3).
  const replays = limitStore(ctx);

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
          // one alert per webhook per hour: a flood of bad requests pages once
          const hour = new Date(ctx.clock.now()).toISOString().slice(0, 13);
          void ctx.alerts?.dispatch(w.workspaceId, `webhook.rejected:${w.id}:${hour}`, {
            event: "webhook.rejected",
            severity: "warning",
            title: `A call to webhook /${w.path} was rejected`,
            text: `${reason} (HTTP ${status}, environment ${env.name}).`,
            url: `${ctx.config.webUrl.replace(/\/$/, "")}/${slug}/triggers?tab=webhooks&webhook=${w.id}`,
            data: { webhookId: w.id, workflowId: w.workflowId, reason, httpStatus: status },
          });
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
            const signature = createHash("sha256").update(given).digest("hex");
            if (!(await replays.claimOnce(`replay:webhook:${w.id}:${signature}`, REPLAY_TTL_MS)))
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
        const claimed = await ctx.db.system(async (tx) => {
          const now = new Date(ctx.clock.now());
          // One row per delivery id (unique index). Body-hash dedupe is bounded to 24 h; header ids
          // dedupe for as long as rows are kept. A call that was refused (bad input, budget, …) never
          // started a run, so its retry is a new attempt, not a duplicate.
          const [prior] = await tx
            .select({
              id: webhookDeliveries.id,
              runId: webhookDeliveries.runId,
              status: webhookDeliveries.status,
              attempt: webhookDeliveries.attempt,
              createdAt: webhookDeliveries.createdAt,
            })
            .from(webhookDeliveries)
            .where(
              and(
                eq(webhookDeliveries.webhookId, w.id),
                eq(webhookDeliveries.externalId, externalId),
                eq(webhookDeliveries.direction, "inbound"),
              ),
            );
          if (prior) {
            const expired =
              externalId.startsWith("b:") && prior.createdAt.getTime() < now.getTime() - 86_400_000;
            if (prior.status !== "rejected" && !expired) {
              // recorded so the Deliveries list shows the repeat and the run it was answered with
              await tx.insert(webhookDeliveries).values({
                id: uuidv7(),
                workspaceId: w.workspaceId,
                webhookId: w.id,
                runId: prior.runId,
                direction: "inbound",
                status: "duplicate",
                httpStatus: 200,
              });
              return { duplicate: prior.runId };
            }
            const [taken] = await tx
              .update(webhookDeliveries)
              .set({
                status: "accepted",
                runId: null,
                error: null,
                httpStatus: null,
                attempt: prior.attempt + 1,
                createdAt: now,
              })
              .where(
                and(
                  eq(webhookDeliveries.id, prior.id),
                  eq(webhookDeliveries.status, prior.status),
                  eq(webhookDeliveries.attempt, prior.attempt),
                ),
              )
              .returning({ id: webhookDeliveries.id });
            // another request took it over at the same moment: that one runs
            return taken ? { deliveryId: taken.id } : { duplicate: null };
          }
          const [inserted] = await tx
            .insert(webhookDeliveries)
            .values({
              id: uuidv7(),
              workspaceId: w.workspaceId,
              webhookId: w.id,
              direction: "inbound",
              status: "accepted",
              externalId,
            })
            .onConflictDoNothing()
            .returning({ id: webhookDeliveries.id });
          return inserted ? { deliveryId: inserted.id } : { duplicate: null };
        });
        if ("duplicate" in claimed)
          return reply.code(200).send({ run_id: claimed.duplicate, duplicate: true });
        const { deliveryId } = claimed;

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
            definition: workflowVersions.definition,
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
          targets: deployed.flatMap((d) => {
            const trigger = d.definition.triggers.find(
              (t) => t.type === "event" && t.eventName === req.params.eventName,
            );
            return trigger?.type === "event"
              ? [{ workflowId: d.workflowId, correlationKey: trigger.correlationKey }]
              : [];
          }),
          waiting: [...new Set(subs.map((s) => s.runId))],
        };
      });
      const started: string[] = [];
      for (const { workflowId, correlationKey } of targets) {
        if (p.workflowIds && !p.workflowIds.has(workflowId)) continue;
        // RFC-0006: the trigger's correlationKey points into the payload; its value (or the
        // published key) becomes the run's sessionId so related events and runs can be found
        const session =
          (correlationKey !== undefined
            ? correlationValue(req.body.payload as JsonValue, correlationKey)
            : undefined) ?? req.body.correlationKey;
        const run = await startRun(ctx, { ...p, environmentId: envId }, workflowId, {
          input: req.body.payload as JsonValue,
          mode: "async",
          environmentId: envId,
          labels: { event: req.params.eventName },
          ...(session !== undefined ? { sessionId: session.slice(0, 128) } : {}),
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
            ...(req.body.correlationKey !== undefined
              ? { correlationKey: req.body.correlationKey }
              : {}),
          },
        });
      req.audit.details = { started: started.length, delivered: waiting.length };
      return reply.code(202).send({ started, delivered: waiting });
    },
  );
}

/** The scalar at a JSON Pointer in the payload, as a correlation string (RFC-0006). */
export function correlationValue(payload: JsonValue, pointer: string): string | undefined {
  let cur: JsonValue | undefined = payload;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (cur !== null && typeof cur === "object") cur = (cur as Record<string, JsonValue>)[key];
    else return undefined;
  }
  return typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean"
    ? String(cur)
    : undefined;
}
