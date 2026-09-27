/**
 * `trace_review.run` (ARCHITECTURE.md §10.5, UPGRADE_PLAN P6-04): the TraceReviewer judges one
 * finished run. The verdict lands in `runs.review` and `audit_events` (`run.reviewed`); the
 * alerting verdicts (`PAGE_ON_CALL`, `FILE_BUG`) fire `trace_review.page` on the workspace's
 * notification channels.
 *
 * Reviews are enabled per workspace (`settings.traceReview.enabled`); failures and time-outs are
 * always reviewed, completions at `settings.traceReview.sampleRate` (default 0.05). The judge is
 * the workspace's decision chain head (`settings.defaultDecisionChain[0]`, else TypeSafe) with a
 * workspace credential of its type, else the server's key.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { CredentialService } from "@flowaid/credentials";
import {
  credentials as credentialsTable,
  recordAudit,
  runs,
  workspaces,
  type Database,
  type PgRunStore,
} from "@flowaid/database";
import {
  TraceReviewer,
  shouldReview,
  type AlertDispatcher,
  type TraceReview,
} from "@flowaid/observability";
import type { ProviderRegistry } from "@flowaid/providers";
import {
  ProviderHopSchema,
  type DecisionProvider,
  type JsonObject,
  type ProviderHop,
  type Run,
  type SafeFetch,
} from "@flowaid/workflow-core";
import { serverKeyCredential, type ServerKeys } from "../services/credentials.js";

export interface TraceReviewSettings {
  enabled: boolean;
  sampleRate: number;
}

export function traceReviewSettings(settings: JsonObject | null | undefined): TraceReviewSettings {
  const raw = (settings?.traceReview ?? null) as { enabled?: unknown; sampleRate?: unknown } | null;
  const rate = typeof raw?.sampleRate === "number" ? raw.sampleRate : 0.05;
  return { enabled: raw?.enabled === true, sampleRate: Math.min(1, Math.max(0, rate)) };
}

export interface TraceReviewDeps {
  db: Database;
  store: PgRunStore;
  registry: ProviderRegistry;
  credentials: CredentialService;
  http: SafeFetch;
  serverKeys: ServerKeys;
  alerts?: AlertDispatcher | undefined;
  /** public web URL for alert links */
  webUrl?: string | undefined;
  /** replaces the workspace chain (tests) */
  judge?: DecisionProvider | undefined;
}

/** Whether a finished run should get a `trace_review.run` job. */
export async function wantsReview(db: Database, run: Pick<Run, "id" | "status" | "workspaceId">) {
  const [ws] = await db.system((tx) =>
    tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, run.workspaceId)),
  );
  const s = traceReviewSettings(ws?.settings as JsonObject | undefined);
  return s.enabled && shouldReview(run, s.sampleRate);
}

async function judgeFor(deps: TraceReviewDeps, workspaceId: string, settings: JsonObject) {
  if (deps.judge) return deps.judge;
  const chain = Array.isArray(settings.defaultDecisionChain) ? settings.defaultDecisionChain : [];
  const parsed = ProviderHopSchema.safeParse(chain[0] ?? { provider: "typesafe" });
  const hop: ProviderHop = parsed.success
    ? parsed.data
    : { provider: "typesafe", model: "jev-latest" };
  try {
    return await deps.registry.decision(hop, {
      workspaceId,
      http: deps.http,
      credential: async (providerId, credentialType) => {
        if (!credentialType) return undefined;
        const [row] = await deps.db.system((tx) =>
          tx
            .select({ id: credentialsTable.id })
            .from(credentialsTable)
            .where(
              and(
                eq(credentialsTable.workspaceId, workspaceId),
                eq(credentialsTable.type, credentialType),
                isNull(credentialsTable.environmentId),
              ),
            )
            .orderBy(asc(credentialsTable.createdAt))
            .limit(1),
        );
        if (row) return { id: row.id, value: await deps.credentials.decrypt(row.id) };
        const server = serverKeyCredential(credentialType, deps.serverKeys);
        return server ? { id: `server:${providerId}`, value: server } : undefined;
      },
    });
  } catch {
    return undefined;
  }
}

/** p95 duration and cost of the workflow in the environment over 30 days. */
async function baseline(db: Database, run: Run) {
  const rows = await db.system((tx) =>
    tx.execute<{ d: unknown; c: unknown }>(sql`
      select
        percentile_cont(0.95) within group (order by extract(epoch from (ended_at - started_at)) * 1000) as d,
        percentile_cont(0.95) within group (order by cost_usd) as c
      from runs
      where workflow_id = ${run.workflowId} and environment_id = ${run.environmentId}
        and status = 'completed' and started_at is not null and ended_at is not null
        and created_at > now() - interval '30 days' and id <> ${run.id}`),
  );
  const row = [...rows][0];
  const d = Number(row?.d);
  const c = Number(row?.c);
  return {
    ...(Number.isFinite(d) && d > 0 ? { p95DurationMs: d } : {}),
    ...(Number.isFinite(c) && c > 0 ? { p95CostUsd: c } : {}),
  };
}

export type TraceReviewOutcome =
  { status: "reviewed"; review: TraceReview } | { status: "skipped"; reason: string };

export async function runTraceReviewJob(
  deps: TraceReviewDeps,
  runId: string,
): Promise<TraceReviewOutcome> {
  const run = await deps.store.getRun(runId);
  if (!run) return { status: "skipped", reason: "run not found" };
  const [ws] = await deps.db.system((tx) =>
    tx
      .select({ settings: workspaces.settings, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, run.workspaceId)),
  );
  const settings = (ws?.settings ?? {}) as JsonObject;
  const [nodeRuns, events] = await Promise.all([
    deps.store.listNodeRuns(runId),
    deps.store.listEvents(runId, 0, 100_000),
  ]);
  const judge = await judgeFor(deps, run.workspaceId, settings);
  const reviewer = new TraceReviewer({
    provider:
      judge ??
      // Only reached for runs a deterministic rule decides (checked below).
      ({} as DecisionProvider),
    redactor: deps.credentials.redactor,
  });
  const input = { run, nodeRuns, events, baseline: await baseline(deps.db, run) };
  if (!judge && !reviewer.shortCircuit(input))
    return { status: "skipped", reason: "no decision provider is configured for reviews" };
  const review = await reviewer.review(input);

  await deps.db.system(async (tx) => {
    await tx
      .update(runs)
      .set({
        review: {
          verdict: review.verdict,
          confidence: review.confidence ?? 1,
          reasons: [review.reason],
          at: review.reviewedAt,
        },
      })
      .where(eq(runs.id, runId));
    await recordAudit(tx, {
      workspaceId: run.workspaceId,
      actorType: "system",
      actorId: "trace_reviewer",
      action: "run.reviewed",
      resourceType: "run",
      resourceId: runId,
      details: {
        verdict: review.verdict,
        source: review.source,
        ...(review.rule ? { rule: review.rule } : {}),
        likelyWrongOutcome: review.likelyWrongOutcome,
        confidence: review.confidence,
        provider: review.provider,
        model: review.model,
        costUsd: review.costUsd,
        alert: review.alert,
      },
    });
  });

  if (review.alert && deps.alerts) {
    const url =
      deps.webUrl && ws ? `${deps.webUrl.replace(/\/$/, "")}/${ws.slug}/runs/${runId}` : undefined;
    await deps.alerts.dispatch(run.workspaceId, `trace_review.page:${runId}`, {
      event: "trace_review.page",
      severity: review.verdict === "PAGE_ON_CALL" ? "critical" : "warning",
      title: `${review.verdict === "PAGE_ON_CALL" ? "Page on call" : "File a bug"}: run ${runId.slice(0, 8)}`,
      text: review.reason,
      ...(url ? { url } : {}),
      data: {
        runId,
        workflowId: run.workflowId,
        verdict: review.verdict,
        likelyWrongOutcome: review.likelyWrongOutcome,
      },
    });
  }
  return { status: "reviewed", review };
}
