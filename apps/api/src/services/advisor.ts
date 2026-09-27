/**
 * What the advisor (P6-02) needs from the platform: the model it generates with, provider
 * credentials (the workspace's own first, then the server's keys), 30-day node statistics, the
 * linked evaluation's pass rate and the workspace budget.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { EvalSignal, NodeStats } from "@flowaid/advisor";
import { credentials, evaluationRuns, workspaces, type Tx } from "@flowaid/database";
import { anthropicFactory } from "@flowaid/provider-anthropic";
import { ollamaEmbeddingFactory, ollamaFactory } from "@flowaid/provider-ollama";
import { openaiFactories } from "@flowaid/provider-openai";
import { typesafeFactory } from "@flowaid/provider-typesafe";
import { DefaultModelCatalog, ProviderRegistry, type ResolveContext } from "@flowaid/providers";
import type { JsonObject, ModelRef, WorkflowDefinition } from "@flowaid/workflow-core";
import type { ApiContext } from "../context.js";

/** The server's provider factories (the same set the worker registers). */
export function defaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
  registry.register(typesafeFactory());
  for (const f of openaiFactories()) registry.register(f);
  registry.register(anthropicFactory());
  registry.register(ollamaFactory());
  registry.register(ollamaEmbeddingFactory());
  return registry;
}

export function registryOf(ctx: ApiContext): ProviderRegistry {
  ctx.providers ??= defaultProviderRegistry();
  return ctx.providers;
}

/** Server-wide provider keys (FLOWAID env), by credential type. */
function serverKey(ctx: ApiContext, credentialType: string): Record<string, string> | undefined {
  const env = ctx.env as Record<string, unknown> | undefined;
  const value = (name: string) =>
    typeof env?.[name] === "string" && env[name] ? String(env[name]) : undefined;
  switch (credentialType) {
    case "typesafe.api_key": {
      const k = value("TYPESAFE_API_KEY");
      return k ? { apiKey: k } : undefined;
    }
    case "openai.api_key": {
      const k = value("OPENAI_API_KEY");
      return k ? { apiKey: k } : undefined;
    }
    case "anthropic.api_key": {
      const k = value("ANTHROPIC_API_KEY");
      return k ? { apiKey: k } : undefined;
    }
    case "ollama.host":
    case "ollama.none": {
      const h = value("OLLAMA_HOST");
      return h ? { host: h } : undefined;
    }
    default:
      return undefined;
  }
}

/** The workspace's newest workspace-wide credential of a type (a passing test ranks first). */
async function workspaceCredentialId(
  tx: Tx,
  workspaceId: string,
  credentialType: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.workspaceId, workspaceId),
        eq(credentials.type, credentialType),
        sql`${credentials.environmentId} is null`,
        sql`${credentials.allowedWorkflowIds} is null`,
      ),
    )
    .orderBy(sql`${credentials.lastTestOk} desc nulls last`, desc(credentials.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** `ResolveContext` for the advisor's provider calls in one workspace. */
export function resolveContext(
  ctx: ApiContext,
  workspaceId: string,
  signal?: AbortSignal,
): ResolveContext {
  return {
    workspaceId,
    http: ctx.http,
    ...(signal ? { signal } : {}),
    credential: async (providerId, credentialType) => {
      if (!credentialType) return undefined;
      const id = await ctx.db.tenant(workspaceId, (tx) =>
        workspaceCredentialId(tx, workspaceId, credentialType),
      );
      if (id) return { id, value: await ctx.credentials.decrypt(id) };
      const key = serverKey(ctx, credentialType);
      return key ? { id: `server:${providerId}`, value: key } : undefined;
    },
  };
}

/** Defaults tried in order when the workspace names no advisor model. */
const DEFAULT_MODELS: readonly (ModelRef & { credentialType: string })[] = [
  { provider: "anthropic", model: "claude-sonnet-5", credentialType: "anthropic.api_key" },
  { provider: "openai", model: "gpt-5.5", credentialType: "openai.api_key" },
  { provider: "ollama", model: "qwen3:8b", credentialType: "ollama.host" },
];

export interface AdvisorModel {
  ref: ModelRef;
  /** the model accepts `responseFormat: json_schema` */
  jsonSchema: boolean;
}

function settingsOf(tx: Tx, workspaceId: string): Promise<JsonObject> {
  return tx
    .select({ settings: workspaces.settings })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .then((rows) => (rows[0]?.settings ?? {}) as JsonObject);
}

/**
 * The generation model the AI builder uses: `settings.advisorModel` when the workspace sets one,
 * else the first default whose provider has a workspace credential or a server key. Null when
 * none is available (the `ai_builder` feature is then off).
 */
export async function advisorModel(
  ctx: ApiContext,
  workspaceId: string,
): Promise<AdvisorModel | null> {
  const registry = registryOf(ctx);
  const factories = registry.list("generation");
  const describe = (ref: ModelRef): AdvisorModel => {
    const info = registry.catalog.get(
      ref.provider,
      registry.catalog.resolveAlias(ref.provider, ref.model),
    );
    return { ref, jsonSchema: info?.capabilities.jsonSchema ?? false };
  };
  return ctx.db.tenant(workspaceId, async (tx) => {
    const configured = (await settingsOf(tx, workspaceId)).advisorModel as
      { provider?: unknown; model?: unknown } | undefined;
    if (typeof configured?.provider === "string" && typeof configured.model === "string") {
      const ref = { provider: configured.provider, model: configured.model };
      return factories.some((f) => f.id === ref.provider) ? describe(ref) : null;
    }
    for (const d of DEFAULT_MODELS) {
      if (!factories.some((f) => f.id === d.provider)) continue;
      if (
        serverKey(ctx, d.credentialType) ||
        (await workspaceCredentialId(tx, workspaceId, d.credentialType))
      )
        return describe({ provider: d.provider, model: d.model });
    }
    return null;
  });
}

/** Per-node aggregates of the workflow's completed node runs over the last `days`. */
export async function nodeStats(
  tx: Tx,
  workspaceId: string,
  workflowId: string,
  definition: WorkflowDefinition,
  since: Date,
): Promise<NodeStats[]> {
  const rows = await tx.execute<{
    node_id: string;
    runs: number;
    node_runs: number;
    cost: number;
    latency: number | null;
    tokens_in: number;
    tokens_out: number;
    hashed: number;
    distinct_inputs: number;
  }>(sql`
    select nr.node_id,
           count(distinct nr.run_id)::int as runs,
           count(*)::int as node_runs,
           coalesce(sum(nr.cost_usd), 0)::float as cost,
           avg(nr.latency_ms)::float as latency,
           coalesce(avg((nr.usage->>'inputTokens')::float), 0)::float as tokens_in,
           coalesce(avg((nr.usage->>'outputTokens')::float), 0)::float as tokens_out,
           count(nr.input_hash)::int as hashed,
           count(distinct nr.input_hash)::int as distinct_inputs
      from node_runs nr
      join runs r on r.id = nr.run_id
     where r.workspace_id = ${workspaceId} and r.workflow_id = ${workflowId}
       and nr.status = 'completed' and nr.started_at >= ${since.toISOString()}::timestamptz
     group by nr.node_id`);
  const out: NodeStats[] = [];
  for (const r of rows) {
    if (r.runs === 0) continue;
    const repeatKnown = r.hashed >= r.node_runs * 0.9;
    out.push({
      nodeId: r.node_id,
      runs: r.runs,
      avgCostUsd: r.cost / r.runs,
      avgLatencyMs: r.latency ?? 0,
      avgInputTokens: r.tokens_in,
      avgOutputTokens: r.tokens_out,
      // expressed per run: the optimizer reads repeat rate as 1 − distinct / runs
      distinctInputs: repeatKnown ? Math.round((r.distinct_inputs * r.runs) / r.node_runs) : r.runs,
    });
  }
  const containers = definition.nodes.filter((n) => n.kind === "loop" || n.kind === "foreach");
  for (const c of containers) {
    const per = await tx.execute<{ iters: number }>(sql`
      select max((regexp_match(nr.scope, ${`(?:^|/)${c.id}#(\\d+)`}))[1]::int) + 1 as iters
        from node_runs nr
        join runs r on r.id = nr.run_id
       where r.workspace_id = ${workspaceId} and r.workflow_id = ${workflowId}
         and nr.started_at >= ${since.toISOString()}::timestamptz
         and nr.scope ~ ${`(^|/)${c.id}#`}
       group by nr.run_id`);
    const counts = [...per].map((p) => p.iters).sort((a, b) => a - b);
    if (counts.length === 0) continue;
    const iterations = {
      p95: counts[Math.min(counts.length - 1, Math.ceil(counts.length * 0.95) - 1)] as number,
      max: counts[counts.length - 1] as number,
    };
    const existing = out.find((s) => s.nodeId === c.id);
    if (existing) existing.iterations = iterations;
    else
      out.push({
        nodeId: c.id,
        runs: counts.length,
        avgCostUsd: 0,
        avgLatencyMs: 0,
        avgInputTokens: 0,
        avgOutputTokens: 0,
        distinctInputs: counts.length,
        iterations,
      });
  }
  return out;
}

/** The latest completed evaluation of the linked set: its pass rate and case count. */
export async function evalSignal(tx: Tx, setId: string | null): Promise<EvalSignal | null> {
  if (!setId) return null;
  const [row] = await tx
    .select({ summary: evaluationRuns.summary })
    .from(evaluationRuns)
    .where(and(eq(evaluationRuns.setId, setId), eq(evaluationRuns.status, "completed")))
    .orderBy(desc(evaluationRuns.createdAt))
    .limit(1);
  const s = row?.summary as { passRate?: unknown; cases?: unknown } | null | undefined;
  return typeof s?.passRate === "number" && typeof s.cases === "number"
    ? { passRate: s.passRate, cases: s.cases }
    : null;
}

/** Runs per month, p99 run cost and the workspace budget, for the critic's cost rule. */
export async function costContext(
  tx: Tx,
  workspaceId: string,
  workflowId: string,
  since: Date,
): Promise<{
  budget: { monthlyCostUsd: number; runsPerMonth: number } | null;
  suggestedMaxCostUsd: number | null;
}> {
  const [stats] = await tx.execute<{ n: number; p99: number | null }>(sql`
    select count(*)::int as n,
           percentile_cont(0.99) within group (order by cost_usd)::float as p99
      from runs
     where workspace_id = ${workspaceId} and workflow_id = ${workflowId}
       and created_at >= ${since.toISOString()}::timestamptz`);
  const days = Math.max(1, (Date.now() - since.getTime()) / 86_400_000);
  const runsPerMonth = Math.round(((stats?.n ?? 0) / days) * 30);
  const budgets = (await settingsOf(tx, workspaceId)).budgets as
    { monthlyCostUsd?: unknown } | undefined;
  const monthly = typeof budgets?.monthlyCostUsd === "number" ? budgets.monthlyCostUsd : null;
  const p99 = stats && stats.n >= 10 && stats.p99 !== null && stats.p99 > 0 ? stats.p99 : null;
  // twice the observed p99, rounded up to two significant digits
  const suggested = p99 === null ? null : Number((p99 * 2).toPrecision(2)) || null;
  return {
    budget: monthly !== null && runsPerMonth > 0 ? { monthlyCostUsd: monthly, runsPerMonth } : null,
    suggestedMaxCostUsd: suggested,
  };
}

/** The decision chain's first hop for the judge: the workspace chain, else the definition's. */
export async function judgeHop(tx: Tx, workspaceId: string, definition: WorkflowDefinition) {
  const chain = (await settingsOf(tx, workspaceId)).defaultDecisionChain;
  const first = Array.isArray(chain) ? (chain[0] as unknown) : undefined;
  return (first ??
    definition.execution.decisions
      .primary) as WorkflowDefinition["execution"]["decisions"]["primary"];
}

/** The workspace chain's failover hops (the critic's no-failover rule accepts them). */
export async function workspaceFailover(tx: Tx, workspaceId: string): Promise<unknown[]> {
  const chain = (await settingsOf(tx, workspaceId)).defaultDecisionChain;
  return Array.isArray(chain) ? chain.slice(1) : [];
}
