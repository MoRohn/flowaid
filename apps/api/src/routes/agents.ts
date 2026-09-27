/**
 * Agent presets and workflows as tools (API.md §3.9, UPGRADE_PLAN P6-10). A preset is a named set of
 * `flowaid.ai.agent` settings (model or failover policy, instructions, tools with their approval
 * mode, bounds) that nodes reference by `config.agentId`; the node's own settings override it.
 * `POST /v1/tools/workflow` registers a workflow as a tool, which is how an agent calls another
 * workflow (including another agent). Everything here answers 404 while `features.agents` is off.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { agents, tools, workflowVersions, workflows } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  GenerationPolicySchema,
  ModelRefSchema,
  NotFoundError,
  type JsonObject,
  type ToolDefinition,
} from "@flowaid/workflow-core";
import type { Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { IdParams, NoContent } from "../dto/common.js";

const need = (p: Principal | null | undefined): Principal => {
  if (!p) throw new ForbiddenError("no principal");
  return p;
};

/** The settings a preset carries (the node's config minus `agentId`). */
export const AgentPresetConfigSchema = z
  .object({
    model: z.union([ModelRefSchema, GenerationPolicySchema]),
    system: z.string().max(32_000).optional(),
    tools: z
      .array(
        z.object({
          name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
          approval: z.enum(["always", "irreversible", "never"]).default("irreversible"),
        }),
      )
      .max(32)
      .default([]),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.int().min(1).max(65_536).optional(),
    maxSteps: z.int().min(1).max(50).optional(),
    maxToolCalls: z.int().min(0).max(200).optional(),
    maxTokens: z.int().min(1).optional(),
    maxCostUsd: z.number().min(0).optional(),
    stream: z.boolean().optional(),
  })
  .strict();

const AgentBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(""),
  config: AgentPresetConfigSchema,
});
const AgentPatch = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  config: AgentPresetConfigSchema.optional(),
});
const AgentDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  config: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type AgentRow = typeof agents.$inferSelect;
const agentDto = (a: AgentRow) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  config: a.config,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

/** Unique-name violations answer 409 instead of 500. */
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  ((e as { code?: string }).code === "23505" ||
    isUniqueViolation((e as { cause?: unknown }).cause));

export function agentRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const enabled = () => {
    if (ctx.config.featuresDisabled.includes("agents")) throw new NotFoundError("agents are off");
  };

  r.get(
    "/v1/agents",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:read",
        cli: { noun: "agent", verb: "list" },
      },
      schema: { tags: ["agents"], response: { 200: z.array(AgentDto) } },
    },
    async (req) => {
      enabled();
      const p = need(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(agents)
          .where(eq(agents.workspaceId, p.workspaceId))
          .orderBy(asc(agents.name)),
      );
      return rows.map(agentDto);
    },
  );

  r.post(
    "/v1/agents",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:write",
        audit: { action: "agent.create", resource: "agent" },
        cli: { noun: "agent", verb: "create" },
      },
      schema: { tags: ["agents"], body: AgentBody, response: { 201: AgentDto } },
    },
    async (req, reply) => {
      enabled();
      const p = need(req.principal);
      try {
        const [row] = await ctx.db.tenant(p.workspaceId, (tx) =>
          tx
            .insert(agents)
            .values({
              id: uuidv7(),
              workspaceId: p.workspaceId,
              name: req.body.name,
              description: req.body.description,
              config: req.body.config as JsonObject,
            })
            .returning(),
        );
        const a = row as AgentRow;
        req.audit = { resourceId: a.id };
        return reply.code(201).send(agentDto(a));
      } catch (e) {
        if (isUniqueViolation(e)) throw new ConflictError(`an agent named ${req.body.name} exists`);
        throw e;
      }
    },
  );

  r.get(
    "/v1/agents/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:read",
        cli: { noun: "agent", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["agents"], params: IdParams, response: { 200: AgentDto } },
    },
    async (req) => {
      enabled();
      const p = need(req.principal);
      const [a] = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(agents)
          .where(and(eq(agents.id, req.params.id), eq(agents.workspaceId, p.workspaceId))),
      );
      if (!a) throw new NotFoundError("agent not found");
      return agentDto(a);
    },
  );

  r.patch(
    "/v1/agents/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:write",
        audit: { action: "agent.update", resource: "agent" },
        cli: { noun: "agent", verb: "update", positional: ["id"] },
      },
      schema: { tags: ["agents"], params: IdParams, body: AgentPatch, response: { 200: AgentDto } },
    },
    async (req) => {
      enabled();
      const p = need(req.principal);
      try {
        const [a] = await ctx.db.tenant(p.workspaceId, (tx) =>
          tx
            .update(agents)
            .set({
              ...(req.body.name !== undefined ? { name: req.body.name } : {}),
              ...(req.body.description !== undefined ? { description: req.body.description } : {}),
              ...(req.body.config !== undefined ? { config: req.body.config } : {}),
              updatedAt: new Date(),
            })
            .where(and(eq(agents.id, req.params.id), eq(agents.workspaceId, p.workspaceId)))
            .returning(),
        );
        if (!a) throw new NotFoundError("agent not found");
        req.audit = { resourceId: a.id };
        return agentDto(a);
      } catch (e) {
        if (isUniqueViolation(e)) throw new ConflictError("an agent with that name exists");
        throw e;
      }
    },
  );

  r.delete(
    "/v1/agents/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:write",
        audit: { action: "agent.delete", resource: "agent" },
        cli: { noun: "agent", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["agents"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      enabled();
      const p = need(req.principal);
      const gone = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .delete(agents)
          .where(and(eq(agents.id, req.params.id), eq(agents.workspaceId, p.workspaceId)))
          .returning({ id: agents.id }),
      );
      if (!gone.length) throw new NotFoundError("agent not found");
      req.audit = { resourceId: req.params.id };
      return reply.code(204).send(null);
    },
  );

  r.post(
    "/v1/tools/workflow",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:write",
        audit: { action: "tool.create", resource: "tool" },
        cli: { noun: "tool", verb: "add-workflow" },
      },
      schema: {
        tags: ["tools"],
        summary:
          "Register a workflow as a tool (agent-as-tool): calls run its version deployed to the caller's environment",
        body: z.object({
          workflowId: z.uuid(),
          toolName: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
          description: z.string().min(1).max(4000),
          approvalRequired: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) => {
      enabled();
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const [w] = await tx
          .select({ id: workflows.id, name: workflows.name, latest: workflows.latestVersionId })
          .from(workflows)
          .where(
            and(eq(workflows.id, req.body.workflowId), eq(workflows.workspaceId, p.workspaceId)),
          );
        if (!w) throw new NotFoundError("workflow not found");
        if (!w.latest) throw new BadRequestError("publish the workflow before using it as a tool");
        const [v] = await tx
          .select({ plan: workflowVersions.plan })
          .from(workflowVersions)
          .where(eq(workflowVersions.id, w.latest));
        const def: ToolDefinition = {
          name: req.body.toolName,
          description: req.body.description,
          inputSchema: v?.plan.inputs ?? { type: "object" },
          ...(v?.plan.outputs ? { outputSchema: v.plan.outputs } : {}),
          idempotency: "none",
          approvalRequired: req.body.approvalRequired,
          source: { kind: "workflow", workflowId: w.id },
        };
        const [t] = await tx
          .insert(tools)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            name: w.name,
            kind: "workflow",
            definitions: [def],
            source: { workflowId: w.id },
          })
          .returning();
        return t;
      });
      if (!row) throw new NotFoundError("tool not created");
      req.audit = { resourceId: row.id, details: { workflowId: req.body.workflowId } };
      return reply.code(201).send({
        id: row.id,
        name: row.name,
        kind: row.kind,
        definitions: row.definitions,
        source: row.source,
        credentialId: row.credentialId,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    },
  );
}
