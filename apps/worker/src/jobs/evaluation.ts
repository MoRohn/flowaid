/**
 * `evaluation.run` (ARCHITECTURE.md §10.4): one run per case (origin `evaluation`, pinned version
 * and environment, labels `{ evaluationRunId, caseId }`), human tasks answered from the case's
 * `expected.human` (default approve), results written as each case finishes, then the summary and
 * the regression report against the baseline evaluation run.
 *
 * `judge` checks use the workspace's generation model (services/judge.ts), resolved once per
 * evaluation and only when a case has one; the judge's priced calls count in the summary's cost
 * and stop when the evaluation is cancelled.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  PgRunStore,
  evaluationCases,
  evaluationResults,
  evaluationRuns,
  humanTasks,
  workflowVersions,
  budgetStatusIfSet,
  type Database,
} from "@flowaid/database";
import {
  compare,
  parseCase,
  runEvaluation,
  summarize,
  type CaseResult,
  type RunLauncher,
  type RunRecord,
} from "@flowaid/evaluation";
import { uuidv7 } from "@flowaid/shared";
import {
  BudgetExceededError,
  type DecisionProvider,
  type JsonObject,
  type QueueDriver,
  type Run,
} from "@flowaid/workflow-core";
import { evaluationJudge, type JudgeDeps } from "../services/judge.js";

const TERMINAL = new Set<Run["status"]>(["completed", "failed", "cancelled", "timed_out"]);

export interface EvaluationJobDeps {
  db: Database;
  queue: QueueDriver;
  /** replaces the workspace's judge model (tests) */
  judge?: DecisionProvider;
  /** what the workspace's judge model resolves through; without it judge checks cannot run */
  providers?: Omit<JudgeDeps, "db">;
  /** per-case wall-clock limit (default 10 min) */
  caseTimeoutMs?: number;
  pollMs?: number;
}

/** Reads a finished run into the evaluation's RunRecord. */
async function recordOf(store: PgRunStore, run: Run, humanRequested: boolean): Promise<RunRecord> {
  const nodes = await store.listNodeRuns(run.id);
  const events = await store.listEvents(run.id, 0, 10_000, ["TOOL_RETURNED"]);
  const last = new Map<string, (typeof nodes)[number]>();
  for (const n of nodes) {
    const prev = last.get(n.nodeId);
    if (!prev || n.attempt >= prev.attempt) last.set(n.nodeId, n);
  }
  return {
    runId: run.id,
    status: run.status,
    outcome: run.outcome,
    output: run.output,
    latencyMs:
      run.endedAt && run.startedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : 0,
    costUsd: run.costUsd,
    tokens: run.usage.inputTokens + run.usage.outputTokens,
    nodes: [...last.values()].map((n) => ({
      nodeId: n.nodeId,
      status: n.status,
      firedPort: n.firedPorts.find((p) => p !== "done") ?? n.firedPorts[0] ?? null,
      decision: n.decision,
      schemaError: n.error?.code === "OUTPUT_SCHEMA_MISMATCH",
    })),
    tools: events.map((e) => {
      const t = e as unknown as { tool: string; ok: boolean };
      return { name: t.tool, ok: t.ok };
    }),
    humanRequested,
    error: run.error ? { code: run.error.code, message: run.error.message } : null,
  };
}

export async function runEvaluationJob(
  deps: EvaluationJobDeps,
  evaluationRunId: string,
): Promise<void> {
  const { db, queue } = deps;
  const [row] = await db.system((tx) =>
    tx.select().from(evaluationRuns).where(eq(evaluationRuns.id, evaluationRunId)),
  );
  if (!row || row.status === "cancelled" || row.status === "completed") return;
  const store = new PgRunStore(db);
  const caseRows = await db.system((tx) =>
    tx
      .select()
      .from(evaluationCases)
      .where(eq(evaluationCases.setId, row.setId))
      .orderBy(asc(evaluationCases.ordinal)),
  );
  const cases = caseRows.map((c) =>
    parseCase({ id: c.id, input: c.input, expected: c.expected, tags: c.tags }),
  );
  const [version] = await db.system((tx) =>
    tx
      .select({ planHash: workflowVersions.planHash })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, row.workflowVersionId)),
  );
  await db.system((tx) =>
    tx
      .update(evaluationRuns)
      .set({ status: "running", total: cases.length, completed: 0 })
      .where(eq(evaluationRuns.id, row.id)),
  );
  const controller = new AbortController();
  const judging = cases.some((c) => c.expected.output.some((o) => o.matcher.type === "judge"));
  let judge: { judge?: DecisionProvider; judgeUnavailable?: string } = {};
  if (deps.judge) judge = { judge: deps.judge };
  else if (judging && deps.providers) {
    const r = await evaluationJudge(
      { db, ...deps.providers },
      row.workspaceId,
      controller.signal,
    ).catch((error: unknown) => ({
      judge: null,
      reason: `no judge model available: ${error instanceof Error ? error.message : String(error)}`,
    }));
    judge = r.judge ? { judge: r.judge } : { judgeUnavailable: r.reason };
  }

  const launcher: RunLauncher = {
    async launch(req) {
      // each case is a new run: none start once the workspace's monthly budget is spent
      const budget = await db.system((tx) => budgetStatusIfSet(tx, row.workspaceId, new Date()));
      if (budget?.reached && budget.monthlyCostUsd !== null)
        throw new BudgetExceededError(budget.month, budget.spentUsd, budget.monthlyCostUsd);
      const id = uuidv7();
      const now = new Date().toISOString();
      const run: Run = {
        id,
        workspaceId: row.workspaceId,
        workflowId: row.workflowId,
        workflowVersionId: row.workflowVersionId,
        environmentId: row.environmentId,
        status: "queued",
        origin: "evaluation",
        mode: "async",
        input: req.input,
        output: null,
        outcome: null,
        error: null,
        parentRunId: null,
        parentNodeRunId: null,
        sourceRunId: null,
        sessionId: null,
        idempotencyKey: null,
        labels: req.labels,
        lastSeq: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        nodeRunCount: 0,
        createdAt: now,
        startedAt: null,
        endedAt: null,
      };
      await store.createRun(run, {
        type: "RUN_CREATED",
        runId: id,
        seq: 1,
        at: now,
        workflowVersionId: row.workflowVersionId,
        environmentId: row.environmentId,
        origin: "evaluation",
        mode: "async",
        input: req.input,
        planHash: version?.planHash ?? "",
        idempotencyKey: null,
        sourceRunId: null,
      });
      await queue.enqueue(
        "run:general",
        { type: "run.start", runId: id },
        { jobId: `run.start:${id}` },
      );
      let humanRequested = false;
      const deadline = Date.now() + (deps.caseTimeoutMs ?? 600_000);
      for (;;) {
        const current = await store.getRun(id);
        if (current && TERMINAL.has(current.status))
          return recordOf(store, current, humanRequested);
        if (current?.status === "waiting_for_human") {
          const open = await db.system((tx) =>
            tx
              .select()
              .from(humanTasks)
              .where(and(eq(humanTasks.runId, id), eq(humanTasks.status, "open"))),
          );
          for (const task of open) {
            humanRequested = true;
            const response =
              req.human[task.nodeId] ??
              (task.request.mode.type === "choice"
                ? { action: "choose" as const, option: task.request.mode.options[0]?.id ?? "" }
                : { action: "approve" as const });
            if (await store.respondHumanTask(task.id, response, "evaluation"))
              await queue.enqueue("run:general", {
                type: "run.resume",
                runId: id,
                reason: "human",
              });
          }
        }
        if (Date.now() > deadline || req.signal.aborted) {
          await store.requestCancel(id, "evaluation", "evaluation case timed out");
          await queue.enqueue("run:control", {
            type: "run.control",
            runId: id,
            action: "cancel",
            by: "evaluation",
            reason: "timeout",
          });
          throw new Error(`case did not finish within ${deps.caseTimeoutMs ?? 600_000} ms`);
        }
        await new Promise((r) => setTimeout(r, deps.pollMs ?? 250));
      }
    },
  };

  // A cancel request stops launching further cases and aborts in-flight runs and judge calls.
  const cancelled = async () => {
    const [state] = await db.system((tx) =>
      tx
        .select({ status: evaluationRuns.status })
        .from(evaluationRuns)
        .where(eq(evaluationRuns.id, row.id)),
    );
    if (state?.status === "cancelled") controller.abort();
  };
  const watch = setInterval(
    () => void cancelled().catch(() => undefined),
    Math.max(250, (deps.pollMs ?? 250) * 4),
  );
  let completed = 0;
  try {
    const outcome = await runEvaluation({
      evaluationRunId: row.id,
      cases,
      launcher,
      concurrency: row.concurrency,
      signal: controller.signal,
      ...judge,
      onResult: async (result) => {
        completed++;
        await db.system(async (tx) => {
          await tx
            .insert(evaluationResults)
            .values({
              evaluationRunId: row.id,
              caseId: result.caseId,
              runId: result.runId,
              passed: result.passed,
              checks: { items: result.checks } as unknown as JsonObject,
              metrics: result.metrics as unknown as JsonObject,
              failures: result.failures,
            })
            .onConflictDoNothing();
          await tx.update(evaluationRuns).set({ completed }).where(eq(evaluationRuns.id, row.id));
        });
        await cancelled();
      },
    });
    let report: JsonObject | null = null;
    if (row.baselineEvaluationRunId || row.gate) {
      const baselineResults = row.baselineEvaluationRunId
        ? await loadResults(db, row.baselineEvaluationRunId)
        : [];
      const [baselineRun] = row.baselineEvaluationRunId
        ? await db.system((tx) =>
            tx
              .select()
              .from(evaluationRuns)
              .where(eq(evaluationRuns.id, row.baselineEvaluationRunId as string)),
          )
        : [];
      report = compare({
        versionId: row.workflowVersionId,
        results: outcome.results,
        summary: outcome.summary,
        baseline: baselineRun
          ? {
              versionId: baselineRun.workflowVersionId,
              results: baselineResults,
              summary: summarize(baselineResults),
            }
          : null,
        gate: row.gate ?? null,
      }) as unknown as JsonObject;
    }
    await db.system((tx) =>
      tx
        .update(evaluationRuns)
        .set({
          status: outcome.cancelled ? "cancelled" : "completed",
          summary: outcome.summary as unknown as JsonObject,
          report,
          endedAt: new Date(),
        })
        .where(
          and(
            eq(evaluationRuns.id, row.id),
            inArray(evaluationRuns.status, ["running", "cancelled"]),
          ),
        ),
    );
  } catch (error) {
    await db.system((tx) =>
      tx
        .update(evaluationRuns)
        .set({
          status: "failed",
          summary: { error: error instanceof Error ? error.message : String(error) },
          endedAt: new Date(),
        })
        .where(eq(evaluationRuns.id, row.id)),
    );
    throw error;
  } finally {
    clearInterval(watch);
  }
}

export async function loadResults(db: Database, evaluationRunId: string): Promise<CaseResult[]> {
  const rows = await db.system((tx) =>
    tx
      .select()
      .from(evaluationResults)
      .where(eq(evaluationResults.evaluationRunId, evaluationRunId)),
  );
  return rows.map((r) => ({
    caseId: r.caseId,
    runId: r.runId,
    passed: r.passed,
    checks: (r.checks as { items?: CaseResult["checks"] }).items ?? [],
    failures: r.failures,
    metrics: r.metrics as unknown as CaseResult["metrics"],
    status: "completed",
  }));
}
