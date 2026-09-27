/**
 * The `judge` matcher: a boolean decision over `{ input, expected?, actual }` through any
 * `DecisionProvider` (TypeSafe by default, an LLM decision provider otherwise). Passes when the
 * decision's value is true; `pYes` is kept on the check.
 */
import type {
  DecisionCallContext,
  DecisionProvider,
  JsonObject,
  JsonValue,
} from "@flowaid/workflow-core";

export interface JudgeVerdict {
  passed: boolean;
  pYes: number;
  message?: string;
}

export async function judge(
  provider: DecisionProvider,
  matcher: { instructions: string; criteria?: { true: string; false: string } },
  subject: { input: JsonValue; expected?: JsonValue; actual: JsonValue | undefined },
  ctx: DecisionCallContext,
): Promise<JudgeVerdict> {
  const state: JsonObject = {
    input: subject.input,
    actual: subject.actual ?? null,
    ...(subject.expected !== undefined ? { expected: subject.expected } : {}),
  };
  const d = await provider.decideBoolean(
    state,
    {
      kind: "boolean",
      instructions: matcher.instructions,
      ...(matcher.criteria ? { criteria: matcher.criteria } : {}),
    },
    ctx,
  );
  return {
    passed: d.value,
    pYes: d.pYes,
    ...(d.value ? {} : { message: `judge answered no (pYes ${d.pYes.toFixed(2)})` }),
  };
}
