/**
 * The report of one evaluation run, from its results and the set's cases. Pure, so each reading
 * is tested against what the scorer (`packages/evaluation`) writes.
 */
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
