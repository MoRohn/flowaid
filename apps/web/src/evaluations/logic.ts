/**
 * Guidance for evaluations (`/v1/evaluations/*`, packages/evaluation): the new-set draft and its
 * review, how well a set's cases cover the workflow, and how to read a finished report. Pure, so
 * each rule is tested against what the scorer actually checks.
 */
import type { CaseResultRow, EvaluationCase, EvaluationSummary } from "~/admin/types";

export interface Note {
  id: string;
  state: "ok" | "blocker" | "warning" | "info" | "optional";
  message: string;
}

/** "Any workflow" in the set's workflow choice. */
export const ANY_WORKFLOW = "__any";

export interface SetDraft {
  name: string;
  description: string;
  /** a workflow id, or ANY_WORKFLOW */
  workflowId: string;
}

export const emptySetDraft = (): SetDraft => ({
  name: "",
  description: "",
  workflowId: ANY_WORKFLOW,
});

/** The `POST /v1/evaluations/sets` body. */
export function setBody(d: SetDraft): Record<string, unknown> {
  return {
    name: d.name.trim(),
    description: d.description,
    ...(d.workflowId !== ANY_WORKFLOW ? { workflowId: d.workflowId } : {}),
  };
}

/** What the review of a new set says; set names are unique in a workspace (the API answers 409). */
export function setReviewNotes(
  d: SetDraft,
  ctx: { existingNames: readonly string[]; workflowName: string | null },
): Note[] {
  const notes: Note[] = [];
  const name = d.name.trim();
  if (!name) notes.push({ id: "name", state: "blocker", message: "Give the set a name" });
  else if (ctx.existingNames.includes(name))
    notes.push({
      id: "name-taken",
      state: "blocker",
      message: `A set named ${name} already exists: choose another name.`,
    });
  if (d.workflowId === ANY_WORKFLOW)
    notes.push({
      id: "any-workflow",
      state: "info",
      message:
        "Not tied to a workflow: Add to evaluation offers it on the runs of every workflow, cases are written as JSON rather than a workflow's input form, and every run of the set asks which workflow to test.",
    });
  else
    notes.push({
      id: "workflow",
      state: "ok",
      message: `Tests ${ctx.workflowName ?? "the chosen workflow"}: its runs can be added as cases, and new cases use its input form.`,
    });
  if (!d.description.trim())
    notes.push({
      id: "no-description",
      state: "optional",
      message:
        "No description: a line on what the set protects helps when it fails months from now.",
    });
  return notes;
}

/** A description as a sentence of a longer line: trimmed, ending in a full stop ("" stays ""). */
export function sentence(text: string): string {
  const t = text.trim();
  return !t || /[.!?…:]$/.test(t) ? t : `${t}.`;
}

/** What deleting a set does, naming the workflows that use it as their publish gate. */
export function deleteSetText(gateOf: readonly { name: string }[]): string {
  const base =
    "Its cases and evaluation reports are deleted. Workflow runs made by evaluations are kept.";
  if (!gateOf.length) return base;
  const names = gateOf.map((w) => w.name).join(", ");
  return `${base} It is the publish gate of ${names}: ${gateOf.length === 1 ? "that workflow publishes" : "those workflows publish"} without an evaluation check until another set is linked under Settings → Evaluation.`;
}

// ── cases ─────────────────────────────────────────────────────────────────────────────────────

const has = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.length > 0
    : v !== null && typeof v === "object" && Object.keys(v).length > 0;

/**
 * The case checks nothing beyond the run finishing: no output, decision, branch, node, tool,
 * outcome, human, latency or cost expectation. The scorer then only checks `status`, so the
 * case passes whenever the run completes, whatever it answered.
 */
export function checksOnlyCompletion(expected: Record<string, unknown>): boolean {
  return !(
    has(expected.output) ||
    has(expected.decisions) ||
    has(expected.branches) ||
    has(expected.requiredNodes) ||
    has(expected.forbiddenNodes) ||
    has(expected.requiredTools) ||
    has(expected.forbiddenTools) ||
    typeof expected.outcome === "string" ||
    typeof expected.humanExpected === "boolean" ||
    typeof expected.maxLatencyMs === "number" ||
    typeof expected.maxCostUsd === "number"
  );
}

/** The case asks a judge model to grade an output. */
export function usesJudge(expected: Record<string, unknown>): boolean {
  return (
    Array.isArray(expected.output) &&
    expected.output.some(
      (o) =>
        o !== null &&
        typeof o === "object" &&
        (o as { matcher?: { type?: unknown } }).matcher?.type === "judge",
    )
  );
}

const ESCALATION_TAG = /escalat|human|review|handoff|hand-off/i;

/** The judge message the scorer writes when the workspace has no model to judge with. */
export const NO_JUDGE = "no judge model available: add an OpenAI, Anthropic or Ollama key";

/** A judge check that could not run (also the wording of results scored by older releases). */
export const judgeCouldNotRun = (message: string | undefined): boolean =>
  message?.startsWith("no judge model available") === true ||
  message === "no judge provider is configured";

/** How well a set's cases cover the workflow, for the set's page. */
export function caseCoverage(cases: readonly EvaluationCase[]): Note[] {
  const n = cases.length;
  if (n === 0) return [];
  const notes: Note[] = [];
  const weak = cases.filter((c) => checksOnlyCompletion(c.expected)).length;
  notes.push(
    weak
      ? {
          id: "weak",
          state: "warning",
          message: `${weak} of ${n} case${n === 1 ? "" : "s"} only check${weak === 1 ? "s" : ""} that the run finishes, so ${weak === 1 ? "it passes" : "they pass"} even when the answer is wrong. Add an output, decision or branch expectation.`,
        }
      : {
          id: "weak",
          state: "ok",
          message: "Every case checks the answer, not only that the run finishes.",
        },
  );
  const fromRuns = cases.filter((c) => c.sourceRunId).length;
  notes.push(
    fromRuns
      ? {
          id: "from-runs",
          state: "ok",
          message: `${fromRuns} of ${n} taken from real runs.`,
        }
      : {
          id: "from-runs",
          state: "optional",
          message:
            "None taken from real runs yet: open a finished run of the workflow and choose Add to evaluation to capture a real input with its decisions and branches.",
        },
  );
  const tags = [...new Set(cases.flatMap((c) => c.tags))].sort();
  notes.push(
    tags.length
      ? { id: "tags", state: "ok", message: `Tagged: ${tags.join(", ")}.` }
      : {
          id: "tags",
          state: "optional",
          message:
            "No tags: tagging cases typical, edge or escalate shows at a glance which kind of request is failing.",
        },
  );
  const escalates = cases.some(
    (c) => c.expected.humanExpected === true || c.tags.some((t) => ESCALATION_TAG.test(t)),
  );
  if (!escalates)
    notes.push({
      id: "escalation",
      state: "optional",
      message:
        "No case expects the workflow to ask a person. If some requests must be escalated, add one with “humanExpected”: true.",
    });
  const judged = cases.filter((c) => usesJudge(c.expected)).length;
  if (judged)
    notes.push({
      id: "judge",
      state: "info",
      message: `${judged} case${judged === 1 ? " uses" : "s use"} a judge check: the AI builder's model (Settings, else the first OpenAI, Anthropic or Ollama key) grades the answer, and its calls are added to the evaluation's cost. Without such a key, judge checks fail.`,
    });
  return notes;
}

// ── reports ───────────────────────────────────────────────────────────────────────────────────

/**
 * How to read a finished report: runs that finished against cases that passed, and what else
 * limits what the pass rate says. `weakCases` are the ids of cases that only check completion.
 * `run` is the evaluation run (a cancelled or failed one scored only some of the set's cases);
 * `baseline` the run compared with, when its cases differ from this run's.
 */
export function reportReading(
  summary: EvaluationSummary,
  results: readonly CaseResultRow[],
  weakCases: ReadonlySet<string>,
  ctx: {
    run?: { status: string; total: number };
    baseline?: { sameCases: boolean; cases: number } | null;
  } = {},
): Note[] {
  const n = summary.cases;
  const total = Math.max(n, ctx.run?.total ?? n);
  if (n === 0 && total === 0) return [];
  const notes: Note[] = [];
  if (n < total)
    notes.push({
      id: "partial",
      state: "warning",
      message: `Only ${n} of ${total} cases ran: the evaluation ${ctx.run?.status === "failed" ? "failed" : ctx.run?.status === "cancelled" ? "was cancelled" : "stopped"} first. Every figure here covers those ${n} only, so it says nothing about the other ${total - n}.`,
    });
  if (n === 0) return notes;
  const finished = Math.round(summary.completionRate * n);
  notes.push(
    finished === n
      ? {
          id: "finished",
          state: "ok",
          message:
            n < total ? `The ${n} runs that started all finished.` : `All ${n} runs finished.`,
        }
      : {
          id: "finished",
          state: "warning",
          message: `${finished} of ${n} runs finished; the others failed, timed out, were cancelled or could not start, and fail their status check. Open one to see its error before reading anything else.`,
        },
  );
  if (ctx.baseline && !ctx.baseline.sameCases)
    notes.push({
      id: "baseline-cases",
      state: "warning",
      message: `The baseline scored different cases (${ctx.baseline.cases} there, ${n} here), so its rates are not shown as differences: they would not compare like with like. Regressions are still listed per case.`,
    });
  notes.push({
    id: "passed",
    state: summary.passed === n ? "ok" : "info",
    message: `${summary.passed} of ${n} cases met every expectation. A finished run with a wrong answer counts as a failure.`,
  });
  const weakPasses = results.filter((r) => r.passed && weakCases.has(r.caseId)).length;
  if (weakPasses)
    notes.push({
      id: "weak",
      state: "warning",
      message: `${weakPasses} of the passing cases only check that the run finishes: their pass says nothing about the answer.`,
    });
  const judgeless = results.filter((r) => r.checks.some((c) => judgeCouldNotRun(c.message))).length;
  if (judgeless)
    notes.push({
      id: "judge",
      state: "warning",
      message: `${judgeless} case${judgeless === 1 ? " has" : "s have"} judge checks that could not run (no judge model: add an OpenAI, Anthropic or Ollama key in Credentials), so ${judgeless === 1 ? "it fails" : "they fail"} whatever the answer.`,
    });
  const judgeCost = summary.costUsd.judge ?? 0;
  if (judgeCost > 0)
    notes.push({
      id: "judge-cost",
      state: "info",
      message: `Judge checks cost $${judgeCost.toFixed(4)}: counted in the evaluation's total, not in cost per case, which is the workflow's own.`,
    });
  const escalated = results.filter((r) => r.metrics?.humanRequested).length;
  if (escalated)
    notes.push({
      id: "human",
      state: "info",
      message: `${escalated} run${escalated === 1 ? "" : "s"} asked a person; the evaluation answered from the case (approve unless the case says otherwise), so no one was actually asked.`,
    });
  return notes;
}
