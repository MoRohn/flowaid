/** API keys (API.md §1, §3.1): created and rotated with the key shown once; scopes capped by role. */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  apiKeys,
  createApiKey,
  environments,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyRow,
} from "@flowaid/database";
import { BadRequestError, ForbiddenError, NotFoundError } from "@flowaid/workflow-core";
import { and, eq } from "drizzle-orm";
import { generateApiKey } from "../auth/apiKey.js";
import { ROLE_SCOPES, isScope, roleAtLeast } from "../auth/scopes.js";
import type { ApiContext } from "../context.js";
import { IdParams, NoContent } from "../dto/common.js";
import {
  ApiKeyCreatedSchema,
  ApiKeySummarySchema,
  CreateApiKeyRequestSchema,
} from "../dto/identity.js";

const DAY = 24 * 3600 * 1000;

const dto = (k: ApiKeyRow) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes,
  environmentId: k.environmentId,
  workflowIds: k.workflowIds,
  serviceAccount: k.isServiceAccount,
  rateLimitPerMin: k.rateLimitPerMin,
  expiresAt: k.expiresAt.toISOString(),
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
  createdAt: k.createdAt.toISOString(),
});

export function apiKeyRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/v1/api-keys",
    {
      config: {
        auth: "session_or_api_key",
        scope: "api_keys:manage",
        cli: { noun: "api-key", verb: "list" },
      },
      schema: { tags: ["api-keys"], response: { 200: z.array(ApiKeySummarySchema) } },
    },
    async (req) => {
      const ws = req.principal?.workspaceId ?? "";
      return (await ctx.db.tenant(ws, (tx) => listApiKeys(tx, ws))).map(dto);
    },
  );

  r.post(
    "/v1/api-keys",
    {
      config: {
        auth: "session_or_api_key",
        scope: "api_keys:manage",
        audit: { action: "api_key.create", resource: "api_key" },
        cli: { noun: "api-key", verb: "create" },
      },
      schema: {
        tags: ["api-keys"],
        summary: "Create an API key (the key is returned once)",
        body: CreateApiKeyRequestSchema,
        response: { 201: ApiKeyCreatedSchema },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const unknown = req.body.scopes.filter((s) => !isScope(s));
      if (unknown.length) throw new BadRequestError(`unknown scopes: ${unknown.join(", ")}`);
      const service = req.body.serviceAccount !== undefined;
      if (service && !roleAtLeast(p.role, "admin") && !p.scopes.has("admin"))
        throw new ForbiddenError("only admins create service-account keys");
      if (!service && p.role) {
        const allowed = ROLE_SCOPES[p.role];
        const over = req.body.scopes.filter((s) => isScope(s) && !allowed.has(s));
        if (over.length) throw new ForbiddenError(`your role cannot grant: ${over.join(", ")}`);
      }
      const ws = p.workspaceId;
      const expiresAt = req.body.expiresAt
        ? new Date(req.body.expiresAt)
        : new Date(ctx.clock.now() + 365 * DAY);
      if (expiresAt.getTime() <= ctx.clock.now())
        throw new BadRequestError("expiresAt must be in the future");
      const generated = generateApiKey(req.body.mode);
      const row = await ctx.db.tenant(ws, async (tx) => {
        if (req.body.environmentId) {
          const [env] = await tx
            .select()
            .from(environments)
            .where(
              and(eq(environments.id, req.body.environmentId), eq(environments.workspaceId, ws)),
            );
          if (!env) throw new BadRequestError("unknown environmentId");
          if (req.body.mode === "test" && env.protected)
            throw new BadRequestError("test keys cannot be pinned to a protected environment");
        }
        return createApiKey(tx, {
          workspaceId: ws,
          name: service ? `${req.body.serviceAccount?.name ?? req.body.name}` : req.body.name,
          prefix: generated.prefix,
          keyHash: generated.hash,
          scopes: req.body.scopes,
          environmentId: req.body.environmentId ?? null,
          workflowIds: req.body.workflowIds ?? null,
          isServiceAccount: service,
          rateLimitPerMin: req.body.rateLimitPerMin ?? null,
          createdBy: p.userId,
          expiresAt,
        });
      });
      req.audit = { resourceId: row.id, details: { scopes: row.scopes, serviceAccount: service } };
      return reply.code(201).send({
        id: row.id,
        prefix: row.prefix,
        key: generated.key,
        expiresAt: row.expiresAt.toISOString(),
      });
    },
  );

  r.post(
    "/v1/api-keys/:id/rotate",
    {
      config: {
        auth: "session_or_api_key",
        scope: "api_keys:manage",
        audit: { action: "api_key.rotate", resource: "api_key" },
        cli: { noun: "api-key", verb: "rotate", positional: ["id"] },
      },
      schema: {
        tags: ["api-keys"],
        params: IdParams,
        body: z
          .object({ graceMinutes: z.int().min(0).max(1440).default(60) })
          .default({ graceMinutes: 60 }),
        response: { 200: ApiKeyCreatedSchema },
      },
    },
    async (req) => {
      const ws = req.principal?.workspaceId ?? "";
      const existing = await ctx.db.tenant(
        ws,
        async (tx) =>
          (
            await tx
              .select()
              .from(apiKeys)
              .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.workspaceId, ws)))
          )[0],
      );
      if (!existing) throw new NotFoundError("API key not found");
      const generated = generateApiKey(existing.prefix.startsWith("fa_test_") ? "test" : "live");
      const created = await ctx.db.tenant(ws, (tx) =>
        rotateApiKey(tx, req.params.id, {
          prefix: generated.prefix,
          keyHash: generated.hash,
          expiresAt: new Date(ctx.clock.now() + 365 * DAY),
          graceMs: req.body.graceMinutes * 60_000,
        }),
      );
      if (!created) throw new NotFoundError("API key not found or revoked");
      req.audit.details = { newKeyId: created.id, graceMinutes: req.body.graceMinutes };
      return {
        id: created.id,
        prefix: created.prefix,
        key: generated.key,
        expiresAt: created.expiresAt.toISOString(),
      };
    },
  );

  r.delete(
    "/v1/api-keys/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "api_keys:manage",
        audit: { action: "api_key.revoke", resource: "api_key" },
        cli: { noun: "api-key", verb: "revoke", positional: ["id"] },
      },
      schema: { tags: ["api-keys"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const ws = req.principal?.workspaceId ?? "";
      const [row] = await ctx.db.tenant(ws, (tx) =>
        tx
          .select()
          .from(apiKeys)
          .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.workspaceId, ws))),
      );
      if (!row) throw new NotFoundError("API key not found");
      await ctx.db.tenant(ws, (tx) => revokeApiKey(tx, req.params.id));
      return reply.code(204).send(null);
    },
  );
}
