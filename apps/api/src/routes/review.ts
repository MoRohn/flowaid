/**
 * External review links (API.md §1, §3.5): a person outside the workspace answers one human task
 * through a link whose token travels in the URL fragment and the `Authorization` header only
 * (never a query string). Tokens are 32 random bytes, stored as SHA-256, revocable, bounded by
 * the task's expiry and 7 days, and single-use: the respond marks the token used in the same
 * transaction as the task's open → responded CAS. Expired, used, revoked and unknown tokens all
 * answer 404. Responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { humanTaskReviewTokens, humanTasks, recordAudit, workflows } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HumanResponseSchema,
  NotFoundError,
} from "@flowaid/workflow-core";
import { hashSecret, randomToken } from "../auth/apiKey.js";
import { canSeeWorkflow } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { NoContent } from "../dto/common.js";
import { checkResponse } from "./runs.js";

const MAX_TTL_MS = 7 * 24 * 3600 * 1000;

function reviewToken(req: FastifyRequest): string {
  if (typeof (req.query as Record<string, unknown> | undefined)?.t === "string")
    throw new BadRequestError("review tokens go in the Authorization header, never the URL");
  const h = req.headers.authorization;
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  if (!m?.[1]) throw new NotFoundError("review link not found");
  return m[1];
}

function privateHeaders(reply: FastifyReply) {
  void reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
}

export function reviewRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/v1/human-tasks/:id/review-link",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:approve",
        audit: { action: "human_task.review_link", resource: "human_task" },
        cli: { noun: "task", verb: "review-link", positional: ["id"] },
      },
      schema: {
        tags: ["human-tasks"],
        params: z.object({ id: z.uuid() }),
        body: z.object({ ttlMs: z.int().min(60_000).max(MAX_TTL_MS).optional() }).default({}),
        response: { 201: z.object({ id: z.uuid(), url: z.string(), expiresAt: z.string() }) },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const token = randomToken();
      const created = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const [t] = await tx
          .select()
          .from(humanTasks)
          .where(and(eq(humanTasks.id, req.params.id), eq(humanTasks.workspaceId, p.workspaceId)));
        if (!t || !canSeeWorkflow(p, t.workflowId)) throw new NotFoundError("task not found");
        if (!t.request.externalReview)
          throw new ForbiddenError("this task does not allow external review");
        if (t.status !== "open") throw new ConflictError(`the task is already ${t.status}`);
        const cap = Math.min(
          ctx.clock.now() + (req.body.ttlMs ?? MAX_TTL_MS),
          t.expiresAt ? t.expiresAt.getTime() : Number.POSITIVE_INFINITY,
        );
        const [row] = await tx
          .insert(humanTaskReviewTokens)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            taskId: t.id,
            tokenHash: hashSecret(token),
            expiresAt: new Date(cap),
            createdBy: `${p.type}:${p.id}`,
          })
          .returning();
        return row as typeof humanTaskReviewTokens.$inferSelect;
      });
      req.audit = { resourceId: req.params.id, details: { linkId: created.id } };
      return reply.code(201).send({
        id: created.id,
        url: `${ctx.config.webUrl.replace(/\/$/, "")}/review#t=${token}`,
        expiresAt: created.expiresAt.toISOString(),
      });
    },
  );

  r.delete(
    "/v1/human-tasks/:id/review-link/:linkId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:approve",
        audit: { action: "human_task.review_link_revoked", resource: "human_task" },
        cli: { noun: "task", verb: "revoke-review-link", positional: ["id", "linkId"] },
      },
      schema: {
        tags: ["human-tasks"],
        params: z.object({ id: z.uuid(), linkId: z.uuid() }),
        response: { 204: NoContent },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .update(humanTaskReviewTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(humanTaskReviewTokens.id, req.params.linkId),
              eq(humanTaskReviewTokens.taskId, req.params.id),
              eq(humanTaskReviewTokens.workspaceId, p.workspaceId),
            ),
          )
          .returning({ id: humanTaskReviewTokens.id }),
      );
      if (!rows.length) throw new NotFoundError("review link not found");
      return reply.code(204).send(null);
    },
  );

  /** The live link and its open task, or 404 for anything else (no existence oracle). */
  const live = async (token: string) =>
    ctx.db.system(async (tx) => {
      const [link] = await tx
        .select()
        .from(humanTaskReviewTokens)
        .where(
          and(
            eq(humanTaskReviewTokens.tokenHash, hashSecret(token)),
            isNull(humanTaskReviewTokens.usedAt),
            isNull(humanTaskReviewTokens.revokedAt),
            gt(humanTaskReviewTokens.expiresAt, new Date(ctx.clock.now())),
          ),
        );
      if (!link) throw new NotFoundError("review link not found");
      const [task] = await tx.select().from(humanTasks).where(eq(humanTasks.id, link.taskId));
      if (!task || task.status !== "open") throw new NotFoundError("review link not found");
      const [wf] = await tx
        .select({ name: workflows.name })
        .from(workflows)
        .where(eq(workflows.id, task.workflowId));
      return { link, task, workflowName: wf?.name ?? "" };
    });

  r.get(
    "/v1/review",
    {
      config: {
        auth: "public",
        rateLimit: { max: 60, timeWindow: 60_000 },
        cli: { noun: "review", verb: "get" },
      },
      schema: {
        tags: ["review"],
        summary: "The task behind an external review link (Authorization: Bearer <token>)",
        response: {
          200: z.object({
            title: z.string(),
            mode: z.unknown(),
            context: z.unknown(),
            expiresAt: z.string(),
            workflowName: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      privateHeaders(reply);
      const { link, task, workflowName } = await live(reviewToken(req));
      // Only what a reviewer needs: never assignees, origin, run or node ids.
      return {
        title: task.request.title,
        mode: task.request.mode,
        context: task.request.context,
        expiresAt: link.expiresAt.toISOString(),
        workflowName,
      };
    },
  );

  r.post(
    "/v1/review/respond",
    {
      config: {
        auth: "public",
        rateLimit: { max: 60, timeWindow: 60_000 },
        audit: false,
        cli: { noun: "review", verb: "respond" },
      },
      schema: {
        tags: ["review"],
        body: z.object({ response: HumanResponseSchema }),
        response: { 202: z.object({ status: z.literal("responded") }) },
      },
    },
    async (req, reply) => {
      privateHeaders(reply);
      const token = reviewToken(req);
      const { link, task } = await live(token);
      const response = req.body.response;
      if (response.action === "escalate") throw new BadRequestError("reviewers cannot escalate");
      checkResponse(task.request, response);
      const done = await ctx.db.system(async (tx) => {
        const [used] = await tx
          .update(humanTaskReviewTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(humanTaskReviewTokens.id, link.id),
              isNull(humanTaskReviewTokens.usedAt),
              isNull(humanTaskReviewTokens.revokedAt),
            ),
          )
          .returning({ id: humanTaskReviewTokens.id });
        if (!used) return false;
        const [answered] = await tx
          .update(humanTasks)
          .set({
            status: "responded",
            response,
            respondedBy: `review_token:${link.id}`,
            respondedAt: new Date(),
          })
          .where(and(eq(humanTasks.id, task.id), eq(humanTasks.status, "open")))
          .returning({ id: humanTasks.id });
        if (!answered) throw new ConflictError("the task was already answered");
        await recordAudit(tx, {
          workspaceId: task.workspaceId,
          actorType: "review_token",
          actorId: link.id,
          action: "human_task.respond",
          resourceType: "human_task",
          resourceId: task.id,
          details: { action: response.action, tokenId: link.id },
          ip: req.ip,
          requestId: req.id,
        });
        return true;
      });
      if (!done) throw new NotFoundError("review link not found");
      await ctx.queue.enqueue("run:general", {
        type: "run.resume",
        runId: task.runId,
        reason: "human",
      });
      return reply.code(202).send({ status: "responded" as const });
    },
  );
}
