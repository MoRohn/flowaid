/**
 * The report of one evaluation run, from its results and the set's cases. Pure, so each reading
 * is tested against what the scorer (`packages/evaluation`) writes.
 */
import type { EvaluationFailedCheck, EvaluationGate } from "@flowaid/ui/builder";
import type { ConfusionPair } from "@flowaid/ui/decision";
import type { CaseResultRow, EvaluationCase } from "~/admin/types";

const label = (v: unknown): string =>
  v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v);

const expectedValue = (v: unknown): unknown =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as { value?: unknown }).value
    : undefined;

/**
 * Expected against actual decision values, per decision a check read: a step, or one question of
 * a batch step (`triage.topic`), so a batch step's answers are never mixed in one matrix. Checks
 * carry what they expected; results scored by older releases fall back to the case.
 */
export function confusionByDecision(
  results: readonly CaseResultRow[],
  cases: readonly EvaluationCase[],
): Record<string, ConfusionPair[]> {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const out: Record<string, ConfusionPair[]> = {};
  for (const r of results) {
    const fromCase = (byId.get(r.caseId)?.expected.decisions ?? {}) as Record<string, unknown>;
    for (const check of r.checks) {
      if (check.kind !== "decision") continue;
      const key = check.id.slice("decision:".length);
      const expected =
        check.expected !== undefined ? expectedValue(check.expected) : expectedValue(fromCase[key]);
      if (expected === undefined) continue;
      (out[key] ??= []).push({
        expected: label(expected),
        actual: label(expectedValue(check.actual)),
      });
    }
  }
  return out;
}

type Check = CaseResultRow["checks"][number];

/** What a check looked at, in words ("Decision triage.topic", "Output /reply contains"). */
function checkLabel(c: Check): string {
  const [kind = "", ...rest] = c.id.split(":");
  const subject = rest.join(":");
  switch (kind) {
    case "output": {
      const cut = subject.lastIndexOf(":");
      const path = cut < 0 ? subject : subject.slice(0, cut);
      const matcher = cut < 0 ? "" : subject.slice(cut + 1);
      return `Output ${path === "/" || path === "" ? "(all of it)" : path}${matcher ? ` ${matcher}` : ""}`;
    }
    case "decision":
      return `Decision ${subject}`;
    case "branch":
      return `Branch ${subject}`;
    case "node": {
      const [step, rule] = subject.split(":");
      return rule === "forbidden" ? `Step ${step} must not run` : `Step ${step} must run`;
    }
    case "tool": {
      const [tool, rule] = subject.split(":");
      return rule === "forbidden"
        ? `Tool ${tool} must not be called`
        : `Tool ${tool} must be called`;
    }
    case "status":
      return "How the run ended";
    case "outcome":
      return "Outcome";
    case "latency":
      return "Latency";
    case "cost":
      return "Cost";
    case "human":
      return "Asking a person";
    case "run":
      return "The run";
    default:
      return c.id;
  }
}

/** Why a check failed: the scorer's message, else what it expected against what it got. */
function checkMessage(c: Check): string | undefined {
  if (c.message) return c.message;
  if (c.kind === "latency")
    return `took ${label(c.actual)} ms, the limit is ${label(c.expected)} ms`;
  if (c.kind === "cost") return `cost $${label(c.actual)}, the limit is $${label(c.expected)}`;
  if (c.kind === "human")
    return c.expected === true
      ? "expected the run to ask a person; it did not"
      : "the run asked a person; the case expects it not to";
  if (c.expected !== undefined || c.actual !== undefined)
    return `expected ${label(c.expected)}, got ${c.actual === null ? "none" : label(c.actual)}`;
  return undefined;
}

/** The checks a case failed, in words, for the report's cases table. */
export function failedChecks(r: CaseResultRow): EvaluationFailedCheck[] {
  return r.checks
    .filter((c) => !c.passed)
    .map((c) => {
      const message = checkMessage(c);
      return { label: checkLabel(c), ...(message ? { message } : {}) };
    });
}

/** The report's gate: `none` unless the run was held to a minimum pass rate. */
export function reportGate(
  report: {
    verdict: "pass" | "fail";
    warnings: readonly unknown[];
    gate: { minPassRate: number } | null;
  } | null,
): EvaluationGate {
  if (!report?.gate) return "none";
  if (report.verdict === "fail") return "fail";
  return report.warnings.length > 0 ? "warn" : "pass";
}

/** Whether two runs scored the same cases, so their rates compare like with like. */
export function sameCases(
  a: readonly { caseId: string }[],
  b: readonly { caseId: string }[],
): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((r) => r.caseId));
  return b.every((r) => ids.has(r.caseId));
}
