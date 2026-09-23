/**
 * `RuleDecisionProvider` (ARCHITECTURE.md §6.5): deterministic, zero-cost decisions from FlowExpr
 * rules over the state. First matching rule wins; otherwise the default applies. The
 * distribution is one-hot scaled by the rule's confidence with the remainder spread evenly over
 * the other outcomes. `provider = 'rule'`, `model = 'rule:v1'`.
 *
 * Rules read the state as `$state` (and `$state.field`); it is evaluated as `$scope.item`, so
 * the compiler type-checks rules like branch cases.
 */
import {
  ExpressionError,
  ProviderError,
  createEvalScope,
  evaluateExpression,
  parseExpression,
  type BooleanQuestion,
  type ChoiceQuestion,
  type DecisionCallContext,
  type DecisionKind,
  type DecisionProvider,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
  type ExprAst,
  type JsonValue,
  type ScoreQuestion,
} from "@flowaid/workflow-core";
import { booleanDecision, choiceDecision, scoreDecision, type ResultMeta } from "./decisionMath.js";

export interface DecisionRule {
  when: string;
  value: boolean | string | number;
  confidence?: number;
}

export interface DecisionRuleSet {
  kind: DecisionKind;
  rules: DecisionRule[];
  default: { value: boolean | string | number; confidence: number };
}

const DEFAULT_RULE_CONFIDENCE = 1;

/** `$state` → `$scope.item`, so rules parse with the standard FlowExpr grammar. */
export function compileRule(source: string): ExprAst {
  const parsed = parseExpression(source.replace(/\$state\b/g, "$scope.item"));
  if (!parsed.ok)
    throw new ProviderError(`Invalid decision rule '${source}': ${parsed.message}`, false, "rule");
  return parsed.ast;
}

/** Runs `fn` and reports a throw as a rejected promise, like every other provider method. */
function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function spread(
  outcomes: readonly string[],
  chosen: string,
  confidence: number,
): Record<string, number> {
  const rest = outcomes.length > 1 ? (1 - confidence) / (outcomes.length - 1) : 0;
  return Object.fromEntries(outcomes.map((o) => [o, o === chosen ? confidence : rest]));
}

export class RuleDecisionProvider implements DecisionProvider {
  readonly id = "rule";
  readonly model = "rule:v1";
  readonly capabilities: DecisionProvider["capabilities"];
  private readonly compiled: { ast: ExprAst; rule: DecisionRule }[];

  constructor(private readonly ruleSet: DecisionRuleSet) {
    this.capabilities = {
      batch: false,
      maxQuestions: 1,
      maxStateTokens: Number.MAX_SAFE_INTEGER,
      kinds: [ruleSet.kind],
      text: true,
      images: false,
    };
    this.compiled = ruleSet.rules.map((rule) => ({ ast: compileRule(rule.when), rule }));
  }

  private pick(state: DecisionState): {
    value: boolean | string | number;
    confidence: number;
    matched: number | null;
  } {
    const scope = createEvalScope({ scope: { item: state as JsonValue } });
    for (const [index, { ast, rule }] of this.compiled.entries()) {
      let hit: JsonValue;
      try {
        hit = evaluateExpression(ast, scope);
      } catch (error) {
        if (error instanceof ExpressionError)
          throw new ProviderError(`Decision rule ${index} failed: ${error.message}`, false, "rule");
        throw error;
      }
      if (hit === true)
        return {
          value: rule.value,
          confidence: rule.confidence ?? DEFAULT_RULE_CONFIDENCE,
          matched: index,
        };
    }
    return { ...this.ruleSet.default, matched: null };
  }

  private meta(matched: number | null): ResultMeta {
    return {
      provider: this.id,
      model: this.model,
      latencyMs: 0,
      costUsd: 0,
      raw: { matchedRule: matched },
    };
  }

  private expect(kind: DecisionKind): void {
    if (this.ruleSet.kind !== kind) {
      throw new ProviderError(
        `These rules answer ${this.ruleSet.kind} questions, not ${kind}`,
        false,
        "rule",
      );
    }
  }

  decideBoolean(state: DecisionState, _question: BooleanQuestion, ctx: DecisionCallContext) {
    return settle(() => {
      this.expect("boolean");
      const { value, confidence, matched } = this.pick(state);
      const pYes = value === true ? confidence : 1 - confidence;
      return booleanDecision(pYes, this.meta(matched), ctx.booleanThreshold);
    });
  }

  decideChoice(state: DecisionState, question: ChoiceQuestion, _ctx?: DecisionCallContext) {
    return settle(() => {
      this.expect("choice");
      const { value, confidence, matched } = this.pick(state);
      const keys = Object.keys(question.options);
      const chosen = String(value);
      if (!keys.includes(chosen))
        throw new ProviderError(
          `Rule value '${chosen}' is not an option (${keys.join(", ")})`,
          false,
          "rule",
        );
      return choiceDecision(spread(keys, chosen, confidence), this.meta(matched), {
        value: chosen,
      });
    });
  }

  decideScore(state: DecisionState, question: ScoreQuestion, _ctx?: DecisionCallContext) {
    return settle(() => {
      this.expect("score");
      const { value, confidence, matched } = this.pick(state);
      const level = Number(value);
      const n = question.levels.length;
      if (!Number.isInteger(level) || level < 0 || level >= n) {
        throw new ProviderError(
          `Rule value ${String(value)} is not a level index 0…${n - 1}`,
          false,
          "rule",
        );
      }
      const keys = question.levels.map((_, i) => String(i));
      const distribution = spread(keys, String(level), confidence);
      return scoreDecision(
        keys.map((k) => distribution[k] ?? 0),
        question.levels,
        this.meta(matched),
      );
    });
  }

  async batch(
    state: DecisionState,
    questions: Record<string, DecisionQuestion>,
    ctx: DecisionCallContext,
  ) {
    const answers: Record<string, DecisionResult> = {};
    for (const [id, question] of Object.entries(questions)) {
      answers[id] =
        question.kind === "boolean"
          ? await this.decideBoolean(state, question, ctx)
          : question.kind === "choice"
            ? await this.decideChoice(state, question)
            : await this.decideScore(state, question);
    }
    return {
      answers,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.model,
      requestId: null,
      latencyMs: 0,
    };
  }

  health() {
    return {
      status: "healthy" as const,
      errorRate1m: 0,
      p95LatencyMs: 0,
      consecutiveFailures: 0,
      checkedAt: new Date(0).toISOString(),
    };
  }
}
