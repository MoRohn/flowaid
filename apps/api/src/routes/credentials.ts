/** Credentials (API.md §3.6): values sealed with per-credential data keys, never returned. */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { assertExternalRef, secretFields } from "@flowaid/credentials";
import { credentials, environments, secretReferences, type Tx } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@flowaid/workflow-core";
import {
  assertEnvironmentAllowed,
  canUseEnvironment,
  hasScope,
  type Principal,
} from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { IdParams, NoContent, PageQuery, afterCursor, page, toPage } from "../dto/common.js";

type CredentialRow = typeof credentials.$inferSelect;

export const CredentialSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.string(),
  storage: z.enum(["db", "external"]),
  externalRef: z.string().nullable(),
  publicFields: z.record(z.string(), z.string()),
  /** masked hints of secret fields, e.g. `sk-…9f2c` */
  hints: z.record(z.string(), z.string()),
  scopes: z.array(z.string()),
  environmentId: z.string().nullable(),
  allowedWorkflowIds: z.array(z.string()).nullable(),
  lastTestedAt: z.string().nullable(),
  lastTestOk: z.boolean().nullable(),
  lastUsedAt: z.string().nullable(),
  rotatedAt: z.string().nullable(),
  createdAt: z.string(),
});

const CreateCredentialSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(100),
  storage: z.enum(["db", "external"]).default("db"),
  values: z.record(z.string(), z.string()).optional(),
  externalRef: z.string().max(500).optional(),
  scopes: z.array(z.string().max(100)).max(50).default([]),
  environmentId: z.uuid().nullable().optional(),
  allowedWorkflowIds: z.array(z.uuid()).max(200).nullable().optional(),
});

const PatchCredentialSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  /** only the fields given change; omitted secret fields keep their values */
  values: z.record(z.string(), z.string()).optional(),
  scopes: z.array(z.string().max(100)).max(50).optional(),
  environmentId: z.uuid().nullable().optional(),
  allowedWorkflowIds: z.array(z.uuid()).max(200).nullable().optional(),
});

/** First and last few characters of a secret, never enough to use it. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "•".repeat(Math.max(4, value.length));
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function dto(row: CredentialRow, hints: Record<string, string> = {}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    storage: row.storage,
    externalRef: row.externalRef,
    publicFields: row.publicFields,
    hints,
    scopes: row.scopes,
    environmentId: row.environmentId,
    allowedWorkflowIds: row.allowedWorkflowIds,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function credentialRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (p: Principal | null): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    return p;
  };
  const load = async (tx: Tx, p: Principal, id: string): Promise<CredentialRow> => {
    const [row] = await tx
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.workspaceId, p.workspaceId)));
    // an API key pinned to an environment sees that environment's and the shared credentials
    if (!row || (row.environmentId !== null && !canUseEnvironment(p, row.environmentId)))
      throw new NotFoundError("credential not found");
    return row;
  };
  /** Changing a shared credential changes it for every environment: not for pinned keys. */
  const loadForWrite = async (tx: Tx, p: Principal, id: string): Promise<CredentialRow> => {
    const row = await load(tx, p, id);
    assertEnvironmentAllowed(p, row.environmentId);
    return row;
  };
  const hintsOf = (type: string, values: Record<string, string>) => {
    const t = ctx.credentials.types.get(type);
    const secrets = t ? secretFields(t) : [];
    return Object.fromEntries(
      secrets.filter((s) => values[s]).map((s) => [s, maskSecret(values[s] as string)]),
    );
  };
  const checkEnvironment = async (tx: Tx, p: Principal, envId: string | null | undefined) => {
    if (!envId) return;
    const [env] = await tx
      .select()
      .from(environments)
      .where(and(eq(environments.id, envId), eq(environments.workspaceId, p.workspaceId)));
    if (!env) throw new BadRequestError("unknown environmentId");
  };

  r.get(
    "/v1/credential-types",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:read",
        cli: { noun: "credential-type", verb: "list" },
      },
      schema: { tags: ["credentials"] },
    },
    () =>
      ctx.credentials.types.list().map((t) => {
        const secrets = new Set(secretFields(t));
        const schema = z.toJSONSchema(t.schema, { io: "input", unrepresentable: "any" }) as {
          properties?: Record<string, unknown>;
          required?: string[];
        };
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          fields: Object.entries(schema.properties ?? {}).map(([name, s]) => ({
            name,
            secret: secrets.has(name),
            required: (schema.required ?? []).includes(name),
            schema: s,
          })),
          scopes: t.scopes ?? [],
          testSupported: typeof t.test === "function",
        };
      }),
  );

  r.get(
    "/v1/credentials",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:read",
        cli: { noun: "credential", verb: "list" },
      },
      schema: {
        tags: ["credentials"],
        querystring: PageQuery.extend({
          type: z.string().optional(),
          environmentId: z.uuid().optional(),
        }),
        response: { 200: page(CredentialSummarySchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      if (req.query.environmentId) assertEnvironmentAllowed(p, req.query.environmentId);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(credentials)
          .where(
            and(
              eq(credentials.workspaceId, p.workspaceId),
              req.query.type ? eq(credentials.type, req.query.type) : undefined,
              req.query.environmentId
                ? eq(credentials.environmentId, req.query.environmentId)
                : undefined,
              p.environmentId
                ? or(
                    isNull(credentials.environmentId),
                    eq(credentials.environmentId, p.environmentId),
                  )
                : undefined,
              afterCursor(credentials.name, credentials.id, req.query.cursor),
            ),
          )
          .orderBy(asc(credentials.name), asc(credentials.id))
          .limit(req.query.limit + 1),
      );
      return toPage(
        rows,
        req.query.limit,
        (c) => [c.name, c.id],
        (row) => dto(row),
      );
    },
  );

  r.post(
    "/v1/credentials",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:write",
        audit: { action: "credential.create", resource: "credential" },
        cli: { noun: "credential", verb: "create" },
      },
      schema: {
        tags: ["credentials"],
        body: CreateCredentialSchema,
        response: { 201: CredentialSummarySchema },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const b = req.body;
      // a pinned API key creates credentials in its own environment
      const environmentId = b.environmentId ?? p.environmentId ?? null;
      assertEnvironmentAllowed(p, environmentId);
      if (!ctx.credentials.types.get(b.type))
        throw new BadRequestError(`unknown credential type ${b.type}`);
      const id = uuidv7();
      let sealed: {
        ciphertext: string | null;
        wrappedDataKey: string | null;
        keyVersion: number | null;
        publicFields: Record<string, string>;
      };
      let hints: Record<string, string> = {};
      if (b.storage === "external") {
        if (!hasScope(p, "admin"))
          throw new ForbiddenError("external credential references need admin");
        if (!b.externalRef)
          throw new BadRequestError("externalRef is required for storage: external");
        assertExternalRef(b.externalRef);
        sealed = { ciphertext: null, wrappedDataKey: null, keyVersion: null, publicFields: {} };
      } else {
        if (!b.values) throw new BadRequestError("values are required");
        const s = await ctx.credentials.seal(id, b.type, b.values);
        sealed = s;
        hints = hintsOf(b.type, b.values);
      }
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await checkEnvironment(tx, p, environmentId);
        const [dup] = await tx
          .select({ id: credentials.id })
          .from(credentials)
          .where(and(eq(credentials.workspaceId, p.workspaceId), eq(credentials.name, b.name)));
        if (dup) throw new ConflictError(`a credential named ${b.name} exists`);
        const [created] = await tx
          .insert(credentials)
          .values({
            id,
            workspaceId: p.workspaceId,
            name: b.name,
            type: b.type,
            storage: b.storage,
            ciphertext: sealed.ciphertext,
            wrappedDataKey: sealed.wrappedDataKey,
            keyVersion: sealed.keyVersion,
            externalRef: b.storage === "external" ? (b.externalRef ?? null) : null,
            publicFields: sealed.publicFields,
            scopes: b.scopes,
            environmentId,
            allowedWorkflowIds: b.allowedWorkflowIds ?? null,
            createdBy: p.userId,
          })
          .returning();
        return created as CredentialRow;
      });
      req.audit = {
        resourceId: row.id,
        details: {
          type: row.type,
          storage: row.storage,
          ...(row.externalRef ? { ref: row.externalRef.split(":")[0] ?? "" } : {}),
        },
      };
      return reply.code(201).send(dto(row, hints));
    },
  );

  r.get(
    "/v1/credentials/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:read",
        cli: { noun: "credential", verb: "get", positional: ["id"] },
      },
      schema: {
        tags: ["credentials"],
        params: IdParams,
        response: { 200: CredentialSummarySchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      return dto(await ctx.db.tenant(p.workspaceId, (tx) => load(tx, p, req.params.id)));
    },
  );

  r.patch(
    "/v1/credentials/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:write",
        audit: { action: "credential.update", resource: "credential" },
        cli: { noun: "credential", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["credentials"],
        params: IdParams,
        body: PatchCredentialSchema,
        response: { 200: CredentialSummarySchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const current = await ctx.db.tenant(p.workspaceId, (tx) =>
        loadForWrite(tx, p, req.params.id),
      );
      if (req.body.environmentId !== undefined) assertEnvironmentAllowed(p, req.body.environmentId);
      let sealedPatch = {};
      let hints: Record<string, string> = {};
      if (req.body.values) {
        if (current.storage === "external")
          throw new BadRequestError("external credentials have no stored values");
        const merged = { ...(await ctx.credentials.decrypt(current.id)), ...req.body.values };
        const s = await ctx.credentials.seal(current.id, current.type, merged);
        sealedPatch = {
          ciphertext: s.ciphertext,
          wrappedDataKey: s.wrappedDataKey,
          keyVersion: s.keyVersion,
          publicFields: s.publicFields,
          rotatedAt: new Date(),
        };
        hints = hintsOf(current.type, merged);
      }
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await checkEnvironment(tx, p, req.body.environmentId);
        const [u] = await tx
          .update(credentials)
          .set({
            ...(req.body.name ? { name: req.body.name } : {}),
            ...(req.body.scopes ? { scopes: req.body.scopes } : {}),
            ...(req.body.environmentId !== undefined
              ? { environmentId: req.body.environmentId }
              : {}),
            ...(req.body.allowedWorkflowIds !== undefined
              ? { allowedWorkflowIds: req.body.allowedWorkflowIds }
              : {}),
            ...sealedPatch,
            updatedAt: new Date(),
          })
          .where(eq(credentials.id, current.id))
          .returning();
        return u as CredentialRow;
      });
      req.audit.details = {
        fields: Object.keys(req.body),
        valuesChanged: Object.keys(req.body.values ?? {}),
      };
      return dto(row, hints);
    },
  );

  r.post(
    "/v1/credentials/:id/rotate",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:write",
        audit: { action: "credential.rotate", resource: "credential" },
        cli: { noun: "credential", verb: "rotate", positional: ["id"] },
      },
      schema: {
        tags: ["credentials"],
        params: IdParams,
        body: z.object({ values: z.record(z.string(), z.string()) }),
        response: { 200: CredentialSummarySchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const current = await ctx.db.tenant(p.workspaceId, (tx) =>
        loadForWrite(tx, p, req.params.id),
      );
      if (current.storage === "external")
        throw new BadRequestError("rotate external credentials in their secret manager");
      const s = await ctx.credentials.seal(current.id, current.type, req.body.values);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const [u] = await tx
          .update(credentials)
          .set({
            ciphertext: s.ciphertext,
            wrappedDataKey: s.wrappedDataKey,
            keyVersion: s.keyVersion,
            publicFields: s.publicFields,
            rotatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(credentials.id, current.id))
          .returning();
        return u as CredentialRow;
      });
      return dto(row, hintsOf(current.type, req.body.values));
    },
  );

  r.post(
    "/v1/credentials/:id/test",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:write",
        audit: { action: "credential.test", resource: "credential" },
        cli: { noun: "credential", verb: "test", positional: ["id"] },
      },
      schema: {
        tags: ["credentials"],
        params: IdParams,
        response: { 200: z.object({ ok: z.boolean(), message: z.string().optional() }) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const current = await ctx.db.tenant(p.workspaceId, (tx) => load(tx, p, req.params.id));
      const type = ctx.credentials.types.get(current.type);
      let result: { ok: boolean; message?: string };
      if (!type?.test)
        result = {
          ok: true,
          message: "this credential type has no connection test; its values are stored",
        };
      else {
        try {
          result = await type.test(
            await ctx.credentials.decrypt(current.id),
            ctx.http,
            AbortSignal.timeout(15_000),
          );
        } catch (error) {
          result = {
            ok: false,
            message: error instanceof Error ? error.message.slice(0, 300) : "test failed",
          };
        }
      }
      await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .update(credentials)
          .set({ lastTestedAt: new Date(), lastTestOk: result.ok })
          .where(eq(credentials.id, current.id)),
      );
      req.audit.details = { ok: result.ok };
      return result;
    },
  );

  r.delete(
    "/v1/credentials/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:write",
        audit: { action: "credential.delete", resource: "credential" },
        cli: { noun: "credential", verb: "delete", positional: ["id"] },
      },
      schema: {
        tags: ["credentials"],
        params: IdParams,
        querystring: z.object({ force: z.coerce.boolean().default(false) }),
        response: { 204: NoContent },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      await ctx.db.tenant(p.workspaceId, async (tx) => {
        const row = await loadForWrite(tx, p, req.params.id);
        const bound = await tx
          .select()
          .from(secretReferences)
          .where(eq(secretReferences.credentialId, row.id));
        if (bound.length > 0) {
          if (!req.query.force || !hasScope(p, "admin"))
            throw new ConflictError(
              `the credential is bound to ${bound.length} workflow secret(s); unbind it or delete with ?force=true (admin)`,
              {
                bindings: bound.map((b) => ({
                  workflowId: b.workflowId,
                  environmentId: b.environmentId,
                  secretName: b.secretName,
                })),
              },
            );
          await tx.delete(secretReferences).where(eq(secretReferences.credentialId, row.id));
        }
        await tx.delete(credentials).where(eq(credentials.id, row.id));
      });
      req.audit.details = { force: req.query.force };
      return reply.code(204).send(null);
    },
  );
}
