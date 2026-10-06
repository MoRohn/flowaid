/** `scoreCase`: every expectation of a case checked against its run. */
import {
  getPointer,
  type DecisionProvider,
  type DecisionResult,
  type JsonValue,
} from "@flowaid/workflow-core";
import { resolveDecision } from "./decisions.js";
import type { EvaluationCase, Expectation } from "./expectation.js";
import { NO_JUDGE_MODEL, judge } from "./scorers/judge.js";
import { jsonEquals, matchValue } from "./scorers/matchers.js";
import type { CaseMetrics, CaseResult, CheckResult, NodeRecord, RunRecord } from "./types.js";

export interface ScoreOptions {
  /** decision provider for `judge` matchers; without it they fail with a clear message */
  judge?: DecisionProvider;
  /** the message judge checks fail with when there is no `judge` (default NO_JUDGE_MODEL) */
  judgeUnavailable?: string;
  /** the judge calls' signal: aborting it (a cancelled evaluation) fails the pending checks */
  judgeContext?: { signal?: AbortSignal };
}

/** The value a decision expectation compares against (score decisions also match their level/label). */
function decisionMatches(d: DecisionResult, v: JsonValue): boolean {
  if (jsonEquals(d.value, v)) return true;
  if (d.kind === "score") return v === d.level || v === d.levelLabel;
  if (d.kind === "boolean") return (v === "yes" && d.value) || (v === "no" && !d.value);
  return false;
}

function numericOf(d: DecisionResult): number {
  if (d.kind === "score") return d.value;
  if (d.kind === "boolean") return d.pYes;
  return d.confidence;
}

/** What a decision check expected, as stored on the check (for reports and confusion). */
function expectedOf(exp: Expectation["decisions"][string]): JsonValue {
  const out: Record<string, JsonValue> = {};
  if (exp.value !== undefined) out.value = exp.value;
  if (exp.valueIn) out.valueIn = exp.valueIn;
  if (exp.range) out.range = exp.range;
  if (exp.minConfidence !== undefined) out.minConfidence = exp.minConfidence;
  return out;
}

const EXECUTED = new Set(["completed", "failed", "reused"]);

export function metricsOf(run: RunRecord): CaseMetrics {
  const branches: CaseMetrics["branches"] = {};
  const decisions: CaseMetrics["decisions"] = {};
  for (const n of run.nodes) {
    if (n.firedPort !== undefined) branches[n.nodeId] = n.firedPort;
    const answers = n.answers && Object.keys(n.answers).length ? n.answers : null;
    // a batch step's answers each under `<step>.<question>`; its `decision` is only one of them
    if (answers)
      for (const [q, d] of Object.entries(answers))
        decisions[`${n.nodeId}.${q}`] = { value: d.value, confidence: d.confidence };
    else if (n.decision)
      decisions[n.nodeId] = {
        value: n.decision.value,
        confidence: n.decision.confidence,
      };
  }
  return {
    latencyMs: run.latencyMs,
    costUsd: run.costUsd,
    tokens: run.tokens ?? 0,
    branches,
    decisions,
    humanRequested: run.humanRequested,
    toolCalls: { total: run.tools.length, ok: run.tools.filter((t) => t.ok).length },
    schemaErrors: run.nodes.filter((n) => n.schemaError === true).length,
  };
}

export async function scoreCase(
  c: EvaluationCase,
  run: RunRecord,
  o: ScoreOptions = {},
): Promise<CaseResult> {
  const e = c.expected;
  const checks: CheckResult[] = [];
  const add = (check: CheckResult) => checks.push(check);
  const byNode = new Map<string, NodeRecord>(run.nodes.map((n) => [n.nodeId, n]));
  let judgeCostUsd = 0;
  let judged = false;

  // A run that did not reach a terminal success still gets every check, so failures are specific.
  for (const { path, matcher } of e.output) {
    const actual = getPointer(run.output, path);
    const id = `output:${path || "/"}:${matcher.type}`;
    if (matcher.type === "judge") {
      if (!o.judge) {
        add({ kind: "output", id, passed: false, message: o.judgeUnavailable ?? NO_JUDGE_MODEL });
        continue;
      }
      const signal = o.judgeContext?.signal;
      if (signal?.aborted) {
        add({ kind: "output", id, passed: false, message: "judge skipped: evaluation cancelled" });
        continue;
      }
      judged = true;
      try {
        const v = await judge(
          o.judge,
          matcher,
          { input: c.input, actual },
          {
            runId: run.runId,
            nodeRunId: `eval:${c.id}`,
            idempotencyKey: null,
            signal: signal ?? new AbortController().signal,
          },
        );
        judgeCostUsd += v.costUsd;
        add({
          kind: "output",
          id,
          passed: v.passed,
          actual: { pYes: v.pYes },
          ...(v.message ? { message: v.message } : {}),
        });
      } catch (error) {
        add({
          kind: "output",
          id,
          passed: false,
          message: `judge failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      continue;
    }
    const m = matchValue(matcher, actual);
    add({
      kind: "output",
      id,
      passed: m.passed,
      ...(actual !== undefined ? { actual } : {}),
      ...(m.message ? { message: m.message } : {}),
    });
  }

  for (const [key, exp] of Object.entries(e.decisions)) {
    const expected = expectedOf(exp);
    const step = key.split(".")[0] as string;
    const found = resolveDecision(key, exp, byNode.get(step));
    if (!found.ok) {
      add({
        kind: "decision",
        id: `decision:${key}`,
        passed: false,
        expected,
        message: found.message,
      });
      continue;
    }
    // checks are named after the answer they read (`triage.topic`), so accuracy, calibration and
    // confusion are per question even for a case that names only the step
    const id = `decision:${found.key}`;
    const d = found.decision;
    const problems: string[] = [];
    if (exp.value !== undefined && !decisionMatches(d, exp.value))
      problems.push(`value ${JSON.stringify(d.value)} ≠ ${JSON.stringify(exp.value)}`);
    if (exp.valueIn && !exp.valueIn.some((v) => decisionMatches(d, v)))
      problems.push(`value ${JSON.stringify(d.value)} not in ${JSON.stringify(exp.valueIn)}`);
    if (exp.range) {
      const x = numericOf(d);
      if (x < exp.range[0] || x > exp.range[1])
        problems.push(`${x} outside [${exp.range[0]}, ${exp.range[1]}]`);
    }
    if (exp.minConfidence !== undefined && d.confidence < exp.minConfidence)
      problems.push(`confidence ${d.confidence.toFixed(3)} < ${exp.minConfidence}`);
    add({
      kind: "decision",
      id,
      passed: problems.length === 0,
      expected,
      actual: { value: d.value as JsonValue, confidence: d.confidence },
      ...(problems.length ? { message: problems.join("; ") } : {}),
    });
  }

  for (const [nodeId, port] of Object.entries(e.branches)) {
    const fired = byNode.get(nodeId)?.firedPort ?? null;
    add({
      kind: "branch",
      id: `branch:${nodeId}`,
      passed: fired === port,
      expected: port,
      actual: fired,
      ...(fired === port
        ? {}
        : { message: `${nodeId} fired ${fired ?? "nothing"}, expected ${port}` }),
    });
  }

  for (const nodeId of e.requiredNodes) {
    const ran = EXECUTED.has(byNode.get(nodeId)?.status ?? "");
    add({
      kind: "node",
      id: `node:${nodeId}:required`,
      passed: ran,
      ...(ran ? {} : { message: `${nodeId} did not run` }),
    });
  }
  for (const nodeId of e.forbiddenNodes) {
    const ran = EXECUTED.has(byNode.get(nodeId)?.status ?? "");
    add({
      kind: "node",
      id: `node:${nodeId}:forbidden`,
      passed: !ran,
      ...(ran ? { message: `${nodeId} ran` } : {}),
    });
  }
  const tools = new Set(run.tools.map((t) => t.name));
  for (const t of e.requiredTools)
    add({
      kind: "tool",
      id: `tool:${t}:required`,
      passed: tools.has(t),
      ...(tools.has(t) ? {} : { message: `${t} was not called` }),
    });
  for (const t of e.forbiddenTools)
    add({
      kind: "tool",
      id: `tool:${t}:forbidden`,
      passed: !tools.has(t),
      ...(tools.has(t) ? { message: `${t} was called` } : {}),
    });

  const expectedStatus = e.status ?? (e.outcome !== undefined ? undefined : "completed");
  if (expectedStatus !== undefined)
    add({
      kind: "status",
      id: "status",
      passed: run.status === expectedStatus,
      expected: expectedStatus,
      actual: run.status,
      ...(run.status === expectedStatus
        ? {}
        : {
            message: `run ${run.status}${run.error ? ` (${run.error.code}: ${run.error.message})` : ""}`,
          }),
    });
  if (e.outcome !== undefined)
    add({
      kind: "outcome",
      id: "outcome",
      passed: run.outcome === e.outcome,
      expected: e.outcome,
      actual: run.outcome,
    });
  if (e.maxLatencyMs !== undefined)
    add({
      kind: "latency",
      id: "latency",
      passed: run.latencyMs <= e.maxLatencyMs,
      expected: e.maxLatencyMs,
      actual: run.latencyMs,
    });
  if (e.maxCostUsd !== undefined)
    add({
      kind: "cost",
      id: "cost",
      passed: run.costUsd <= e.maxCostUsd,
      expected: e.maxCostUsd,
      actual: run.costUsd,
    });
  if (e.humanExpected !== undefined)
    add({
      kind: "human",
      id: "human",
      passed: run.humanRequested === e.humanExpected,
      expected: e.humanExpected,
      actual: run.humanRequested,
    });

  const failures = checks
    .filter((k) => !k.passed)
    .map((k) => `${k.id}${k.message ? `: ${k.message}` : ""}`);
  return {
    caseId: c.id,
    runId: run.runId,
    passed: failures.length === 0,
    checks,
    failures,
    metrics: { ...metricsOf(run), ...(judged ? { judgeCostUsd } : {}) },
    status: run.status,
  };
}
