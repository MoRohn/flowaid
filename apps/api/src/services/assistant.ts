/**
 * The read-only tools of Ask FlowAId (FLOWAID_V2_ROADMAP 4.2). Each runs in the principal's
 * tenant transaction with the same visibility as the routes: workflows pinned on an API key and
 * an environment pin narrow every query. The tools return run metadata, errors, metrics and
 * approvals; they never return node inputs or outputs, and never change anything.
 */
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AssistantSource, AssistantTool } from "@flowaid/advisor";
import { RunStatusSchema, type JsonSchema, type JsonValue } from "@flowaid/workflow-core";
import type { Tx } from "@flowaid/database";
import type { Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { INSIGHT_WINDOWS, insightsReport, type InsightWindow } from "./insights.js";
import { dashboardMetrics } from "./metrics.js";

const WINDOWS = Object.keys(INSIGHT_WINDOWS) as [InsightWindow, ...InsightWindow[]];

/** An error whose message is meant for the model; anything else is reported generically. */
class ToolError extends Error {}

function tool<S extends z.ZodType>(
  name: string,
  description: string,
  schema: S,
  run: (args: z.infer<S>) => Promise<{ data: JsonValue; sources: AssistantSource[] }>,
): AssistantTool {
  return {
    name,
    description,
    parameters: z.toJSONSchema(schema, { io: "input" }) as JsonSchema,
    run: async (raw) => {
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success)
        throw new Error(
          `invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      return run(parsed.data);
    },
  };
}

const iso = (v: Date | string | null | undefined): string | null =>
  v ? new Date(v).toISOString() : null;
const short = (s: unknown, n = 300): string | null =>
  typeof s === "string" ? (s.length > n ? `${s.slice(0, n)}…` : s) : null;

/** The runs a principal may see, as SQL over `runs r`. */
function visibleRuns(p: Principal): SQL {
  const parts: SQL[] = [sql`r.workspace_id = ${p.workspaceId}`];
  if (p.environmentId) parts.push(sql`r.environment_id = ${p.environmentId}`);
  if (p.workflowIds)
    parts.push(
      p.workflowIds.size
        ? sql`r.workflow_id in (${sql.join(
            [...p.workflowIds].map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
        : sql`false`,
    );
  return sql.join(parts, sql` and `);
}

function visibleWorkflows(p: Principal): SQL {
  if (!p.workflowIds) return sql`w.workspace_id = ${p.workspaceId}`;
  if (!p.workflowIds.size) return sql`false`;
  return sql`w.workspace_id = ${p.workspaceId} and w.id in (${sql.join(
    [...p.workflowIds].map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

export function assistantTools(ctx: ApiContext, p: Principal): AssistantTool[] {
  const tenant = <T>(fn: (tx: Tx) => Promise<T>) => ctx.db.tenant(p.workspaceId, fn);

  return [
    tool(
      "list_workflows",
      "List workflows in the workspace (id, name, description, latest published version, last update). Optional case-insensitive name filter.",
      z.object({ query: z.string().max(100).optional() }),
      async ({ query }) => {
        const rows = await tenant((tx) =>
          tx.execute<{
            id: string;
            name: string;
            description: string;
            version: number | null;
            updated_at: Date | string;
            archived_at: Date | string | null;
          }>(sql`
            select w.id, w.name, w.description, v.version, w.updated_at, w.archived_at
            from workflows w left join workflow_versions v on v.id = w.latest_version_id
            where ${visibleWorkflows(p)}
              ${query ? sql`and w.name ilike ${`%${query.replace(/[%_\\]/g, "\\$&")}%`}` : sql``}
            order by w.updated_at desc limit 50`),
        );
        const items = [...rows].map((w) => ({
          id: w.id,
          name: w.name,
          description: short(w.description, 200),
          latestVersion: w.version,
          updatedAt: iso(w.updated_at),
          archived: w.archived_at !== null,
        }));
        return {
          data: items,
          sources: items.map((w) => ({
            id: w.id,
            kind: "workflow",
            label: w.name,
            workflowId: w.id,
          })),
        };
      },
    ),

    tool(
      "list_runs",
      "List recent runs, newest first, with status, duration, cost and error code. Filter by workflow, status and a start time.",
      z.object({
        workflowId: z.uuid().optional(),
        status: RunStatusSchema.optional(),
        since: z.iso.datetime({ offset: true }).optional(),
        limit: z.int().min(1).max(25).default(10),
      }),
      async (a) => {
        const rows = await tenant((tx) =>
          tx.execute<{
            id: string;
            workflow_id: string;
            name: string;
            status: string;
            origin: string;
            created_at: Date | string;
            ms: unknown;
            cost: unknown;
            code: string | null;
            message: string | null;
          }>(sql`
            select r.id, r.workflow_id, w.name, r.status, r.origin, r.created_at,
                   extract(epoch from (r.ended_at - r.started_at)) * 1000 as ms,
                   r.cost_usd as cost, r.error->>'code' as code, r.error->>'message' as message
            from runs r join workflows w on w.id = r.workflow_id
            where ${visibleRuns(p)}
              ${a.workflowId ? sql`and r.workflow_id = ${a.workflowId}` : sql``}
              ${a.status ? sql`and r.status = ${a.status}` : sql``}
              ${a.since ? sql`and r.created_at >= ${a.since}::timestamptz` : sql``}
            order by r.created_at desc limit ${a.limit}`),
        );
        const items = [...rows].map((r) => ({
          id: r.id,
          workflowId: r.workflow_id,
          workflow: r.name,
          status: r.status,
          origin: r.origin,
          createdAt: iso(r.created_at),
          durationMs: r.ms === null ? null : Math.round(Number(r.ms)),
          costUsd: r.cost === null ? null : Number(r.cost),
          errorCode: r.code,
          errorMessage: short(r.message),
        }));
        return {
          data: items,
          sources: items.map((r) => ({
            id: r.id,
            kind: "run",
            label: `${r.workflow} run ${r.id.slice(0, 8)}`,
            workflowId: r.workflowId,
          })),
        };
      },
    ),

    tool(
      "get_run",
      "One run in detail: status, version, timing, cost and tokens, its error, the nodes that failed or retried (with their errors), and the automatic trace review verdict. Never includes node inputs or outputs.",
      z.object({ runId: z.uuid() }),
      async ({ runId }) => {
        const out = await tenant(async (tx) => {
          const [run] = await tx.execute<{
            id: string;
            workflow_id: string;
            name: string;
            version: number | null;
            status: string;
            origin: string;
            created_at: Date | string;
            started_at: Date | string | null;
            ended_at: Date | string | null;
            cost: unknown;
            usage: JsonValue;
            error: { code?: string; message?: string } | null;
            review: JsonValue;
          }>(sql`
            select r.id, r.workflow_id, w.name, v.version, r.status, r.origin, r.created_at,
                   r.started_at, r.ended_at, r.cost_usd as cost, r.usage, r.error, r.review
            from runs r join workflows w on w.id = r.workflow_id
            left join workflow_versions v on v.id = r.workflow_version_id
            where ${visibleRuns(p)} and r.id = ${runId}`);
          if (!run) return null;
          const nodes = await tx.execute<{
            node_id: string;
            node_type: string | null;
            status: string;
            attempt: number;
            latency_ms: number | null;
            error: { code?: string; message?: string } | null;
          }>(sql`
            select n.node_id, n.node_type, n.status, n.attempt, n.latency_ms, n.error
            from node_runs n
            where n.run_id = ${runId} and (n.status = 'failed' or n.attempt > 1 or n.error is not null)
            order by n.started_at nulls last limit 20`);
          return { run, nodes: [...nodes] };
        });
        if (!out) throw new ToolError(`run ${runId} not found`);
        const { run, nodes } = out;
        return {
          data: {
            id: run.id,
            workflowId: run.workflow_id,
            workflow: run.name,
            version: run.version,
            status: run.status,
            origin: run.origin,
            createdAt: iso(run.created_at),
            startedAt: iso(run.started_at),
            endedAt: iso(run.ended_at),
            costUsd: run.cost === null ? null : Number(run.cost),
            usage: run.usage,
            error: run.error
              ? { code: run.error.code ?? null, message: short(run.error.message) }
              : null,
            problemNodes: nodes.map((n) => ({
              nodeId: n.node_id,
              type: n.node_type,
              status: n.status,
              attempt: n.attempt,
              latencyMs: n.latency_ms,
              error: n.error
                ? { code: n.error.code ?? null, message: short(n.error.message) }
                : null,
            })),
            review: run.review ?? null,
          },
          sources: [
            {
              id: run.id,
              kind: "run",
              label: `${run.name} run ${run.id.slice(0, 8)}`,
              workflowId: run.workflow_id,
            },
          ],
        };
      },
    ),

    tool(
      "get_metrics",
      "Production-traffic metrics for a window: run counts by status, success and error rate, latency percentiles, AI cost, tokens, decision confidence, human-review and retry rates, provider failovers. Optionally for one workflow.",
      z.object({ window: z.enum(WINDOWS).default("7d"), workflowId: z.uuid().optional() }),
      async ({ window, workflowId }) => {
        if (workflowId && p.workflowIds && !p.workflowIds.has(workflowId))
          throw new ToolError(`workflow ${workflowId} not found`);
        const to = new Date(ctx.clock.now());
        const m = await tenant((tx) =>
          dashboardMetrics(tx, {
            workspaceId: p.workspaceId,
            from: new Date(to.getTime() - INSIGHT_WINDOWS[window]),
            to,
            workflowId,
            environmentId: p.environmentId ?? undefined,
            workflowIds: p.workflowIds ? [...p.workflowIds] : null,
          }),
        );
        const id = `metrics:${window}:${workflowId ?? "all"}`;
        return {
          data: {
            ...m,
            decisionConfidence: { mean: m.decisionConfidence.mean },
          } as unknown as JsonValue,
          sources: [
            {
              id,
              kind: "metrics",
              label: `Metrics, last ${window}${workflowId ? "" : ", all workflows"}`,
              ...(workflowId ? { workflowId } : {}),
            },
          ],
        };
      },
    ),

    tool(
      "get_insights",
      "What changed: statistically tested regressions per workflow (failure rate, latency, cost, decision confidence, new error codes) in a recent window against the four windows before it, with evidence and the version they coincide with; plus open approvals and workflows with failed runs.",
      z.object({ window: z.enum(WINDOWS).default("7d"), workflowId: z.uuid().optional() }),
      async ({ window, workflowId }) => {
        if (workflowId && p.workflowIds && !p.workflowIds.has(workflowId))
          throw new ToolError(`workflow ${workflowId} not found`);
        const r = await tenant((tx) =>
          insightsReport(tx, {
            workspaceId: p.workspaceId,
            now: new Date(ctx.clock.now()),
            window,
            workflowId,
            environmentId: p.environmentId ?? undefined,
            workflowIds: p.workflowIds ? [...p.workflowIds] : null,
          }),
        );
        return {
          data: r as unknown as JsonValue,
          sources: [
            ...r.insights.map((i) => ({
              id: i.id,
              kind: "insight" as const,
              label: i.title,
              workflowId: i.workflowId,
            })),
            ...r.attention.failingWorkflows.map((w) => ({
              id: w.workflowId,
              kind: "workflow" as const,
              label: w.workflowName,
              workflowId: w.workflowId,
            })),
          ],
        };
      },
    ),

    tool(
      "list_open_approvals",
      "Human tasks waiting for a response (approvals, reviews), oldest first, with their workflow, title and expiry.",
      z.object({ limit: z.int().min(1).max(25).default(10) }),
      async ({ limit }) => {
        const rows = await tenant((tx) =>
          tx.execute<{
            id: string;
            workflow_id: string;
            name: string;
            run_id: string;
            title: string | null;
            created_at: Date | string;
            expires_at: Date | string | null;
          }>(sql`
            select h.id, h.workflow_id, w.name, h.run_id, h.request->>'title' as title,
                   h.created_at, h.expires_at
            from human_tasks h join workflows w on w.id = h.workflow_id
            where h.workspace_id = ${p.workspaceId} and h.status = 'open'
              and ${visibleWorkflows(p)}
            order by h.created_at asc limit ${limit}`),
        );
        const items = [...rows].map((h) => ({
          id: h.id,
          workflowId: h.workflow_id,
          workflow: h.name,
          runId: h.run_id,
          title: short(h.title, 200),
          createdAt: iso(h.created_at),
          expiresAt: iso(h.expires_at),
        }));
        return {
          data: items,
          sources: items.map((h) => ({
            id: h.id,
            kind: "task",
            label: h.title ?? `Approval in ${h.workflow}`,
            workflowId: h.workflowId,
          })),
        };
      },
    ),
  ];
}
