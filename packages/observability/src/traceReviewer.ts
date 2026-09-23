/**
 * The TraceReviewer (ARCHITECTURE.md §10.5), run by the worker job `trace_review.run` for every
 * failed run and a sample of the others.
 *
 * 1. Deterministic short-circuits, in order: a run that failed with `BOUNDS_EXCEEDED` →
 *    `FILE_BUG`; any `NONIDEMPOTENT_INTERRUPTED` (a side effect may have happened twice or not at
 *    all) → `PRIORITY_REVIEW`; a cancelled run → `NO_ACTION`. No model is called.
 * 2. Otherwise a compact, redacted trace summary (statuses, errors, retries, low-confidence
 *    decisions, latency and cost against the workflow's p95, human overrides, failovers) is judged
 *    with one `choice` question over the five verdicts plus one `boolean` question "is the outcome
 *    likely wrong", through the injected decision provider (the workspace chain; the LLM adapter
 *    works when there is no TypeSafe key). Both questions go in one batch when the provider
 *    batches.
 *
 * The verdict is stored in `runs.review` and `audit_events` by the caller; `PAGE_ON_CALL` and
 * `FILE_BUG` set `alert`.
 */
import { createHash } from "node:crypto";
import {
  BadRequestError,
  TERMINAL_RUN_STATUSES,
  type BooleanDecision,
  type BooleanQuestion,
  type ChoiceDecision,
  type ChoiceQuestion,
  type DecisionProvider,
  type ErrorInfo,
  type JsonObject,
  type JsonValue,
  type NodeRun,
  type Run,
  type RunEvent,
} from "@flowaid/workflow-core";
import type { Redactor } from "@flowaid/credentials";

export const REVIEW_VERDICTS = [
  "NO_ACTION",
  "REVIEW",
  "PRIORITY_REVIEW",
  "FILE_BUG",
  "PAGE_ON_CALL",
] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** Verdicts that fire the workspace alert channels. */
export const ALERT_VERDICTS: ReadonlySet<ReviewVerdict> = new Set<ReviewVerdict>([
  "PAGE_ON_CALL",
  "FILE_BUG",
]);

export const VERDICT_QUESTION: ChoiceQuestion = {
  kind: "choice",
  instructions:
    "You review one finished workflow run from its trace summary. Choose what the operators " +
    "should do. Prefer NO_ACTION for healthy runs and expected, handled failures; escalate only " +
    "on evidence in the summary.",
  options: {
    NO_ACTION: "The run behaved as designed; nothing to do.",
    REVIEW:
      "Something looks off (low confidence, unusual cost or latency, retries); a person should look when convenient.",
    PRIORITY_REVIEW:
      "A person should look soon: a wrong or harmful outcome is plausible, or a person overrode the automation.",
    FILE_BUG:
      "The workflow or a node is defective (a deterministic error, a schema mismatch, a bound hit by design).",
    PAGE_ON_CALL:
      "An outage or incident: providers or tools are failing across the board and runs cannot succeed.",
  },
};

export const WRONG_OUTCOME_QUESTION: BooleanQuestion = {
  kind: "boolean",
  instructions:
    "From the trace summary, is the run's final outcome likely wrong (a wrong route, a wrong " +
    "answer, or an action that should not have been taken), even if the run completed?",
  criteria: {
    true: "The evidence suggests the outcome is wrong.",
    false: "Nothing suggests the outcome is wrong.",
  },
};

export interface ReviewBaseline {
  /** The workflow's p95 run duration in the environment. */
  p95DurationMs?: number;
  /** The workflow's p95 run cost in the environment. */
  p95CostUsd?: number;
}

export interface TraceReviewInput {
  run: Run;
  nodeRuns: readonly NodeRun[];
  events: readonly RunEvent[];
  baseline?: ReviewBaseline;
}

export interface TraceReview {
  runId: string;
  verdict: ReviewVerdict;
  /** null when a short-circuit decided without asking. */
  likelyWrongOutcome: boolean | null;
  source: "rule" | "provider";
  /** The short-circuit rule that decided, when `source` is `rule`. */
  rule?: "bounds_exceeded" | "nonidempotent_interrupted" | "cancelled";
  reason: string;
  alert: boolean;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  costUsd: number;
  summary: JsonObject;
  reviewedAt: string;
}

export interface TraceReviewerOptions {
  provider: DecisionProvider;
  redactor?: Redactor;
  /** Decisions below this confidence are listed in the summary (default 0.7). */
  lowConfidence?: number;
  /** Most items per list in the summary (default 20). */
  maxItems?: number;
  now?: () => Date;
}

const MAX_TEXT = 300;

function truncate(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function errorCodes(error: ErrorInfo | null | undefined): string[] {
  const codes: string[] = [];
  for (let e = error ?? undefined, depth = 0; e && depth < 8; e = e.cause, depth += 1)
    codes.push(e.code);
  return codes;
}

function durationMs(run: Run): number | null {
  if (!run.startedAt || !run.endedAt) return null;
  return Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt));
}

/**
 * Deterministic sampling: failures, time-outs and non-idempotent interruptions are always
 * reviewed; completed runs by a stable hash of the run id, so retries of the job agree.
 */
export function shouldReview(run: Pick<Run, "id" | "status">, sampleRate: number): boolean {
  if (run.status === "failed" || run.status === "timed_out") return true;
  if (run.status !== "completed") return false;
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  const bucket = createHash("sha256").update(run.id).digest().readUInt32BE(0) / 0x1_0000_0000;
  return bucket < sampleRate;
}

export class TraceReviewer {
  private readonly lowConfidence: number;
  private readonly maxItems: number;
  private readonly now: () => Date;

  constructor(private readonly options: TraceReviewerOptions) {
    this.lowConfidence = options.lowConfidence ?? 0.7;
    this.maxItems = options.maxItems ?? 20;
    this.now = options.now ?? (() => new Date());
  }

  /** The deterministic verdict, when one applies. */
  shortCircuit(
    input: Pick<TraceReviewInput, "run" | "nodeRuns" | "events">,
  ): Pick<TraceReview, "verdict" | "rule" | "reason"> | null {
    const { run } = input;
    if (run.status === "failed" && errorCodes(run.error)[0] === "BOUNDS_EXCEEDED") {
      return {
        verdict: "FILE_BUG",
        rule: "bounds_exceeded",
        reason: "The run failed with BOUNDS_EXCEEDED: a loop, cost or token bound was hit.",
      };
    }
    const interrupted =
      errorCodes(run.error).includes("NONIDEMPOTENT_INTERRUPTED") ||
      input.nodeRuns.some((nr) => errorCodes(nr.error).includes("NONIDEMPOTENT_INTERRUPTED")) ||
      input.events.some(
        (e) =>
          (e.type === "NODE_FAILED" || e.type === "NODE_RETRIED" || e.type === "RUN_FAILED") &&
          errorCodes(e.error).includes("NONIDEMPOTENT_INTERRUPTED"),
      );
    if (interrupted) {
      return {
        verdict: "PRIORITY_REVIEW",
        rule: "nonidempotent_interrupted",
        reason:
          "A non-idempotent node was interrupted: its side effect may have happened twice or not at all.",
      };
    }
    if (run.status === "cancelled") {
      return {
        verdict: "NO_ACTION",
        rule: "cancelled",
        reason: "The run was cancelled by a person or the API.",
      };
    }
    return null;
  }

  /** The compact trace summary sent as decision state (redacted, bounded). */
  summarize(input: TraceReviewInput): JsonObject {
    const { run, nodeRuns, events, baseline } = input;
    const text = (s: string) =>
      truncate(this.options.redactor ? this.options.redactor.redactText(s) : s);
    const cap = <T>(list: T[]) => list.slice(0, this.maxItems);
    const statuses: Record<string, number> = {};
    for (const nr of nodeRuns) statuses[nr.status] = (statuses[nr.status] ?? 0) + 1;

    const failures = nodeRuns
      .filter((nr) => nr.status === "failed" && nr.error)
      .map((nr) => ({
        node: nr.nodeId,
        type: nr.nodeType ?? nr.kind,
        attempt: nr.attempt,
        code: nr.error?.code ?? "INTERNAL",
        message: text(nr.error?.message ?? ""),
      }));
    const retries = events
      .filter((e) => e.type === "NODE_RETRIED")
      .map((e) => ({ node: e.nodeId, nextAttempt: e.nextAttempt, code: e.error.code }));
    const decisions = nodeRuns
      .filter((nr) => nr.decision && nr.decision.confidence < this.lowConfidence)
      .map((nr) => ({
        node: nr.nodeId,
        kind: nr.decision?.kind ?? "",
        value: nr.decision ? (nr.decision.value as JsonValue) : null,
        confidence: Number((nr.decision?.confidence ?? 0).toFixed(3)),
        provider: nr.decision?.provider ?? "",
      }));
    const overrides = events
      .filter((e) => e.type === "HUMAN_APPROVAL_RECEIVED")
      .map((e) => ({
        node: e.nodeId,
        action: e.response.action,
        edited: e.response.action === "approve" && e.response.value !== undefined,
      }))
      .filter((o) => o.action !== "approve" || o.edited);
    const failovers = events
      .filter((e) => e.type === "PROVIDER_FAILOVER")
      .map((e) => ({ node: e.nodeId, from: e.from, to: e.to, code: e.error.code }));
    const toolErrors = events
      .filter((e) => e.type === "TOOL_RETURNED" && !e.ok)
      .map((e) => ({
        tool: e.type === "TOOL_RETURNED" ? e.tool : "",
        code: e.type === "TOOL_RETURNED" ? (e.error?.code ?? "") : "",
      }));

    const duration = durationMs(run);
    const summary: JsonObject = {
      run: {
        status: run.status,
        origin: run.origin,
        outcome: run.outcome,
        error: run.error ? { code: run.error.code, message: text(run.error.message) } : null,
        durationMs: duration,
        costUsd: Number(run.costUsd.toFixed(6)),
        tokens: run.usage.inputTokens + run.usage.outputTokens,
        nodeRuns: nodeRuns.length,
      },
      nodeStatuses: statuses,
      failures: cap(failures),
      retries: { count: retries.length, items: cap(retries) },
      lowConfidenceDecisions: { threshold: this.lowConfidence, items: cap(decisions) },
      humanOverrides: cap(overrides),
      failovers: { count: failovers.length, items: cap(failovers) },
      toolErrors: { count: toolErrors.length, items: cap(toolErrors) },
    };
    if (baseline?.p95DurationMs && duration !== null)
      summary.durationVsP95 = Number((duration / baseline.p95DurationMs).toFixed(2));
    if (baseline?.p95CostUsd)
      summary.costVsP95 = Number((run.costUsd / baseline.p95CostUsd).toFixed(2));
    return summary;
  }

  /** Reviews one terminal run. */
  async review(
    input: TraceReviewInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<TraceReview> {
    const { run } = input;
    if (!TERMINAL_RUN_STATUSES.has(run.status))
      throw new BadRequestError(`Run ${run.id} is ${run.status}; only finished runs are reviewed`);
    const summary = this.summarize(input);
    const reviewedAt = this.now().toISOString();

    const rule = this.shortCircuit(input);
    if (rule) {
      return {
        runId: run.id,
        ...rule,
        likelyWrongOutcome: null,
        source: "rule",
        alert: ALERT_VERDICTS.has(rule.verdict),
        confidence: null,
        provider: null,
        model: null,
        costUsd: 0,
        summary,
        reviewedAt,
      };
    }

    const provider = this.options.provider;
    const ctx = {
      signal,
      runId: run.id,
      nodeRunId: run.id,
      idempotencyKey: `trace-review:${run.id}`,
    };
    let verdict: ChoiceDecision;
    let wrong: BooleanDecision;
    if (provider.capabilities.batch && provider.capabilities.maxQuestions >= 2) {
      const result = await provider.batch(
        summary,
        { verdict: VERDICT_QUESTION, wrong: WRONG_OUTCOME_QUESTION },
        ctx,
      );
      const v = result.answers.verdict;
      const w = result.answers.wrong;
      if (v?.kind !== "choice" || w?.kind !== "boolean")
        throw new BadRequestError(
          `Provider ${provider.id} answered the review with the wrong kinds`,
        );
      verdict = v;
      wrong = w;
    } else {
      [verdict, wrong] = await Promise.all([
        provider.decideChoice(summary, VERDICT_QUESTION, ctx),
        provider.decideBoolean(summary, WRONG_OUTCOME_QUESTION, ctx),
      ]);
    }

    const value = (REVIEW_VERDICTS as readonly string[]).includes(verdict.value)
      ? (verdict.value as ReviewVerdict)
      : "REVIEW";
    return {
      runId: run.id,
      verdict: value,
      likelyWrongOutcome: wrong.value,
      source: "provider",
      reason:
        value === verdict.value
          ? `Judged ${value} at confidence ${verdict.confidence.toFixed(2)}.`
          : `The provider answered '${verdict.value}', which is not a verdict; defaulted to REVIEW.`,
      alert: ALERT_VERDICTS.has(value),
      confidence: verdict.confidence,
      provider: verdict.provider,
      model: verdict.model,
      costUsd: verdict.costUsd + wrong.costUsd,
      summary,
      reviewedAt,
    };
  }
}
