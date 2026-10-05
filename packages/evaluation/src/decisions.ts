/**
 * A batch decision step (`flowaid.decision.batch`) answers several questions, and the run records
 * one DECISION_COMPLETED per question with `batchId` `<nodeRunId>:batch` and `question` the
 * question id (workflow-runtime `providers.ts`; the executor does the same for answers a person
 * gave). `node_runs.decision` keeps only one of them, so evaluations read the answers from these
 * events and name them `<step>.<question>`.
 */
import type { DecisionResult, JsonValue } from "@flowaid/workflow-core";

/** As much of a DECISION_COMPLETED event as the readers need. */
export interface DecisionEventLike {
  nodeRunId?: string;
  batchId: string;
  question: string;
  decision: DecisionResult;
}

/** The `batchId` of a batch step's per-question answers. */
export const batchIdOf = (nodeRunId: string): string => `${nodeRunId}:batch`;

/** A batch step's answers by question id, per node run (a later event for a question wins). */
export function answersByNodeRun(
  events: Iterable<DecisionEventLike>,
): Map<string, Record<string, DecisionResult>> {
  const out = new Map<string, Record<string, DecisionResult>>();
  for (const e of events) {
    if (!e.nodeRunId || e.batchId !== batchIdOf(e.nodeRunId)) continue;
    const answers = out.get(e.nodeRunId) ?? {};
    answers[e.question] = e.decision;
    out.set(e.nodeRunId, answers);
  }
  return out;
}

/** Whether a decision of this shape could answer `v` (a choice option, yes/no, a level). */
export function couldAnswer(d: DecisionResult, v: JsonValue): boolean {
  if (d.kind === "choice") return typeof v === "string" && Object.hasOwn(d.probabilities, v);
  if (d.kind === "boolean") return typeof v === "boolean" || v === "yes" || v === "no";
  return typeof v === "number" || (typeof v === "string" && d.levels.includes(v));
}

export type ResolvedDecision =
  { ok: true; key: string; decision: DecisionResult } | { ok: false; message: string };

/**
 * The decision an expectation key names. `<step>.<question>` is one answer of a batch step. A
 * step id alone is that step's decision, or, on a batch step, its only question or else the one
 * question whose answers can take the expected value(s) (so a case written before answers were
 * recorded per question keeps its meaning); anything else asks for the question to be named.
 */
export function resolveDecision(
  key: string,
  expected: { value?: JsonValue | undefined; valueIn?: JsonValue[] | undefined },
  node:
    | { decision?: DecisionResult | null; answers?: Record<string, DecisionResult> | null }
    | undefined,
): ResolvedDecision {
  const dot = key.indexOf(".");
  const step = dot < 0 ? key : key.slice(0, dot);
  const answers = node?.answers && Object.keys(node.answers).length ? node.answers : null;
  if (dot >= 0) {
    const question = key.slice(dot + 1);
    const d = answers?.[question];
    if (d) return { ok: true, key, decision: d };
    if (answers)
      return {
        ok: false,
        message: `${step} has no question ${question} (it asks ${Object.keys(answers).join(", ")})`,
      };
    return {
      ok: false,
      message: node?.decision
        ? `${step} is not a batch step: expect "${step}" without a question`
        : `${step} made no decision`,
    };
  }
  if (!answers) {
    if (node?.decision) return { ok: true, key, decision: node.decision };
    return { ok: false, message: `${step} made no decision` };
  }
  const ids = Object.keys(answers);
  if (ids.length === 1) {
    const only = ids[0] as string;
    return { ok: true, key: `${step}.${only}`, decision: answers[only] as DecisionResult };
  }
  const values = [
    ...(expected.value !== undefined ? [expected.value] : []),
    ...(expected.valueIn ?? []),
  ];
  const fits = values.length
    ? ids.filter((q) => values.every((v) => couldAnswer(answers[q] as DecisionResult, v)))
    : [];
  if (fits.length === 1) {
    const q = fits[0] as string;
    return { ok: true, key: `${step}.${q}`, decision: answers[q] as DecisionResult };
  }
  return {
    ok: false,
    message: `${step} answers ${ids.length} questions (${ids.join(", ")}): name one, as "${step}.${ids[0]}"`,
  };
}
