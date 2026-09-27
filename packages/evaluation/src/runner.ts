/**
 * `runEvaluation` (ARCHITECTURE.md §10.4): one run per case through the injected `RunLauncher`
 * (origin `evaluation`, labels `{ evaluationRunId, caseId }`), bounded concurrency, human nodes
 * auto-resolved from `expectations.human` (default approve), each case scored as it finishes.
 * A launch that throws is a failed case, never a failed evaluation.
 */
import type { HumanResponse, NodeId } from "@flowaid/workflow-core";
import type { EvaluationCase } from "./expectation.js";
import { scoreCase, type ScoreOptions } from "./score.js";
import { summarize } from "./summarize.js";
import type { CaseResult, EvaluationSummary, RunLauncher } from "./types.js";

export interface RunEvaluationOptions extends ScoreOptions {
  evaluationRunId: string;
  cases: readonly EvaluationCase[];
  launcher: RunLauncher;
  /** parallel runs (default 4) */
  concurrency?: number;
  signal?: AbortSignal;
  /** called as each case finishes (e.g. to insert `evaluation_results` rows) */
  onResult?: (result: CaseResult) => void | Promise<void>;
}

export interface EvaluationOutcome {
  results: CaseResult[];
  summary: EvaluationSummary;
  cancelled: boolean;
}

/** Human auto-responses: the case's own, else approve for any node that asks. */
export function humanResponsesFor(c: EvaluationCase): Record<NodeId, HumanResponse> {
  return { ...c.expected.human };
}

function launchFailed(c: EvaluationCase, error: unknown): CaseResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    caseId: c.id,
    runId: null,
    passed: false,
    checks: [{ kind: "run", id: "run", passed: false, message }],
    failures: [`run: ${message}`],
    metrics: {
      latencyMs: 0,
      costUsd: 0,
      tokens: 0,
      branches: {},
      decisions: {},
      humanRequested: false,
      toolCalls: { total: 0, ok: 0 },
      schemaErrors: 0,
    },
    status: "launch_failed",
  };
}

export async function runEvaluation(o: RunEvaluationOptions): Promise<EvaluationOutcome> {
  const signal = o.signal ?? new AbortController().signal;
  const results = new Array<CaseResult | undefined>(o.cases.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      if (signal.aborted) return;
      const index = next++;
      const c = o.cases[index];
      if (!c) return;
      let result: CaseResult;
      try {
        const run = await o.launcher.launch({
          caseId: c.id,
          input: c.input,
          labels: { evaluationRunId: o.evaluationRunId, caseId: c.id },
          human: humanResponsesFor(c),
          signal,
        });
        result = await scoreCase(c, run, o);
      } catch (error) {
        result = launchFailed(c, error);
      }
      results[index] = result;
      await o.onResult?.(result);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, o.cases.length || 1)) }, () =>
      worker(),
    ),
  );
  const done = results.filter((r): r is CaseResult => r !== undefined);
  return {
    results: done,
    summary: summarize(done),
    cancelled: signal.aborted && done.length < o.cases.length,
  };
}
